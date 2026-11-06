"""KidView home server.

Kids' devices talk only to this server. It searches YouTube with yt-dlp, removes anything
your rules don't allow, and streams the videos through itself.

Parents manage it from the dashboard at http://localhost:8765/admin (on this computer only)
or from the KidView Parent app (signed in with a parent name and PIN).
"""
from __future__ import annotations

import asyncio
import hashlib
import io
import json
import os
import re
import shutil
import socket
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode

import httpx
import segno
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, HTMLResponse, Response, StreamingResponse

import filters
import library
import recommend
import schedule
import store
import version
import webapp
import youtube

HERE = Path(__file__).parent
PORT = int(os.environ.get("KIDVIEW_PORT", "8765"))
HOST = os.environ.get("KIDVIEW_HOST", "0.0.0.0")
THUMBS = store.DATA / "thumbs"
THUMBS.mkdir(exist_ok=True)
CHUNK = 8 * 1024 * 1024  # YouTube slows down big single requests, so fetch in pieces

app = FastAPI(title="KidView", docs_url=None, redoc_url=None)
http = httpx.AsyncClient(timeout=httpx.Timeout(20.0, read=60.0), follow_redirects=True)


# ---------------------------------------------------------------- access checks

def _is_local(request: Request) -> bool:
    return (request.client.host if request.client else "") in ("127.0.0.1", "::1", "localhost")


def _token(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    return auth.removeprefix("Bearer ").strip() if auth.startswith("Bearer ") else request.query_params.get("t")


def kid(request: Request) -> dict:
    dev = store.device(_token(request))
    if not dev:
        raise HTTPException(401, "This device isn't set up yet")
    return dev


def signed_in_parent(request: Request) -> dict:
    p = store.parent_session(_token(request))
    if not p:
        raise HTTPException(401, "Please sign in again")
    return p


def parent(request: Request) -> str:
    """Allows the dashboard on this computer or a signed-in parent app. Returns who it is, for the log."""
    if p := store.parent_session(_token(request)):
        return p["name"]
    if _is_local(request):
        if request.method == "POST" and request.headers.get("x-kidview-admin") != "1":
            raise HTTPException(403, "Missing admin header")
        return "PC dashboard"
    raise HTTPException(401, "Please sign in")


def anyone(request: Request) -> None:
    if not (_is_local(request) or store.device(_token(request)) or store.parent_session(_token(request))):
        raise HTTPException(401)


def _card(v: dict) -> dict:
    return {"id": v["id"], "title": v.get("title", ""), "channel": v.get("channel", ""), "duration": v.get("duration")}


def _watching(r: dict) -> dict:
    """What the kids' devices need to know about watching time, including for offline use."""
    now = datetime.now()
    st = schedule.status(r, now)
    periods, until = schedule.off_periods(r, now)
    return {"paused": not st["on"], "back_at": None if st["on"] else st["until"],
            "off_periods": periods, "periods_until": until, "rules_rev": rules_rev(r)}


def rules_rev(r: dict) -> str:
    """Changes whenever the rules change, so apps and the dashboard know to refresh what they show."""
    return hashlib.sha1(json.dumps(r, sort_keys=True, default=str).encode()).hexdigest()[:12]


def _changed(actor: str, text: str) -> None:
    store.log("change", actor, reason=text)


# ---------------------------------------------------------------- kids' app API

@app.get("/", response_class=HTMLResponse)
def root():
    return "<h2>KidView server is running.</h2><p>Parent dashboard: open <a href='/admin'>/admin</a> on this computer.</p>"


@app.post("/api/pair")
async def api_pair(request: Request):
    body = await request.json()
    token = store.pair(str(body.get("code", "")), str(body.get("name", "")))
    if not token:
        raise HTTPException(403, "That code isn't right. Check the parent dashboard.")
    return {"token": token}


@app.get("/api/home")
def api_home(dev: dict = Depends(kid)):
    r = store.rules_for(dev["id"])
    w = _watching(r)
    return {**w, "search_enabled": r["search_enabled"],
            "picks": [] if w["paused"] else [_card(v) for v in r["approved_videos"]]}


@app.get("/api/search")
def api_search(q: str = "", dev: dict = Depends(kid)):
    r = store.rules_for(dev["id"])
    if not schedule.effective(r):
        return {"paused": True, "results": []}
    q = " ".join(q.split())[:100]
    if not q:
        return {"results": []}
    if reason := filters.check_search(q, r):
        store.log("blocked_search", dev["name"], device_id=dev["id"], query=q, reason=reason)
        return {"blocked": True, "results": []}
    try:
        items = youtube.search(q)
    except Exception as e:  # network trouble, YouTube changes, etc.
        print("search failed:", e)
        raise HTTPException(502, "Search isn't working right now")
    ok = [_card(v) for v in items if not filters.check_video(v, r)]
    store.log("search", dev["name"], device_id=dev["id"], query=q, results=len(ok))
    return {"results": ok[:30]}


@app.get("/api/play/{vid}")
def api_play(vid: str, dev: dict = Depends(kid)):
    r = store.rules_for(dev["id"])
    if not schedule.effective(r):
        return {"allowed": False, "paused": True}
    if not youtube.is_video_id(vid):
        raise HTTPException(404)
    try:
        info = youtube.video(vid, r["max_quality"])
    except Exception as e:
        print("video lookup failed:", e)
        return {"allowed": False}
    if reason := filters.check_video(info, r):
        store.log("blocked_watch", dev["name"], device_id=dev["id"], video_id=vid, title=info["title"], channel=info["channel"],
                  channel_id=info["channel_id"], reason=reason)
        return {"allowed": False}
    if not info["streams"]:
        return {"allowed": False}
    store.log("watch", dev["name"], device_id=dev["id"], video_id=vid, title=info["title"], channel=info["channel"], channel_id=info["channel_id"])
    if wait := youtube.seconds_until_ready(info):
        time.sleep(min(wait, 60))
    return {
        "allowed": True,
        "title": info["title"],
        "channel": info["channel"],
        "streams": {kind: f"/media/{vid}/{kind}" for kind in info["streams"]},
    }


def _parse_range(header: str | None) -> tuple[int, int | None, bool]:
    m = re.match(r"bytes=(\d+)-(\d*)", header or "")
    if not m:
        return 0, None, False
    return int(m.group(1)), (int(m.group(2)) if m.group(2) else None), True


async def _open(stream: dict, start: int, end: int | None) -> httpx.Response:
    stop = start + CHUNK - 1 if end is None else min(end, start + CHUNK - 1)
    req = http.build_request("GET", stream["url"], headers={**stream["headers"], "Range": f"bytes={start}-{stop}"})
    return await http.send(req, stream=True)


@app.get("/media/{vid}/{kind}")
async def media(vid: str, kind: str, request: Request, dev: dict = Depends(kid)):
    """Streams the video through this computer, with seeking support.

    The rules and schedules are checked again on every request, so blocking a video or
    watching time ending stops a video that's already playing.
    """
    if kind not in ("video", "audio", "combined") or not youtube.is_video_id(vid):
        raise HTTPException(404)
    r = store.rules_for(dev["id"])
    start, end, ranged = _parse_range(request.headers.get("range"))

    for attempt in (0, 1):
        info = await run_in_threadpool(youtube.video, vid, r["max_quality"], attempt == 1)
        if not schedule.effective(r) or filters.check_video(info, r):
            raise HTTPException(403)
        stream = info["streams"].get(kind)
        if not stream:
            raise HTTPException(404)
        if wait := youtube.seconds_until_ready(info):
            await asyncio.sleep(min(wait, 60))
        up = await _open(stream, start, end)
        if up.status_code in (200, 206):
            break
        await up.aclose()
        youtube.forget(vid)  # link probably expired, get a fresh one
    else:
        raise HTTPException(502, "Couldn't reach the video")

    total = None
    if cr := up.headers.get("content-range"):
        total = int(cr.rsplit("/", 1)[1]) if not cr.endswith("/*") else None
    elif up.status_code == 200:
        total = int(up.headers.get("content-length", 0)) or None
    if total is None:
        total = stream.get("size")
    last = (min(end, total - 1) if end is not None else total - 1) if total else None

    async def body():
        nonlocal up
        pos = start
        try:
            while True:
                async for chunk in up.aiter_bytes(65536):
                    pos += len(chunk)
                    yield chunk
                await up.aclose()
                if last is None or pos > last:
                    break
                up = await _open(stream, pos, last)
                if up.status_code not in (200, 206):
                    break
        finally:
            await up.aclose()

    headers = {"Accept-Ranges": "bytes", "Content-Type": stream["mime"], "Cache-Control": "no-store"}
    if last is not None:
        headers["Content-Length"] = str(last - start + 1)
    if ranged and total:
        headers["Content-Range"] = f"bytes {start}-{last}/{total}"
    return StreamingResponse(body(), status_code=206 if ranged else 200, headers=headers)


@app.get("/api/library")
def api_library(dev: dict = Depends(kid)):
    """What each device should have saved for offline watching, plus watching times for offline use."""
    r = store.rules_for(dev["id"])
    return {**_watching(r), "items": [i for i in library.ready_items() if _device_allows(i["id"], dev["id"])]}


@app.get("/library/{vid}")
def library_file(vid: str, dev: dict = Depends(kid)):
    if not youtube.is_video_id(vid) or vid not in {i["id"] for i in library.ready_items()}:
        raise HTTPException(404)
    return FileResponse(library.path(vid), media_type="video/mp4")


@app.post("/api/watched")
async def api_watched(request: Request, dev: dict = Depends(kid)):
    """Devices report videos they watched from their saved library (often while offline)."""
    body = await request.json()
    for e in (body.get("events") or [])[:500]:
        vid = str(e.get("id", ""))
        if youtube.is_video_id(vid):
            ts = float(e.get("ts") or time.time())
            store.log("watch_saved", dev["name"], ts=min(ts, time.time()), device_id=dev["id"], video_id=vid,
                      title=str(e.get("title", ""))[:300], channel=str(e.get("channel", ""))[:200], channel_id="")
    return {"ok": True}


@app.get("/api/recommended")
def api_recommended(dev: dict = Depends(kid)):
    """Home-screen recommendations for this kid: a funny + educational mix at first, then personal."""
    r = store.rules_for(dev["id"])
    if not schedule.effective(r):
        return {"personal": False, "sections": []}
    return recommend.for_device(dev["id"], r)


def _device_allows(video_id: str, device_id: str) -> bool:
    """Whether a saved (offline library) video passes this device's own extra restrictions."""
    lim = store.device_limits(device_id)
    meta = library._meta.get(video_id) or {}
    if video_id in {v["id"] for v in lim["blocked_videos"]}:
        return False
    if meta.get("channel_id") and meta["channel_id"] in {c["id"] for c in lim["blocked_channels"]}:
        return False
    text = " ".join([meta.get("title", ""), meta.get("channel", ""), meta.get("description", ""), " ".join(meta.get("tags") or [])])
    if lim["blocked_words"] and filters.find_word(text, lim["blocked_words"]):
        return False
    if lim["max_minutes"] and meta.get("duration") and meta["duration"] > lim["max_minutes"] * 60:
        return False
    return True


@app.get("/thumb/{vid}", dependencies=[Depends(anyone)])
async def thumb(vid: str):
    if not youtube.is_video_id(vid):
        raise HTTPException(404)
    path = THUMBS / f"{vid}.jpg"
    if not path.exists():
        res = await http.get(f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg")
        if res.status_code != 200:
            raise HTTPException(404)
        path.write_bytes(res.content)
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "max-age=604800"})


# ---------------------------------------------------------------- parent app sign-in

@app.post("/parent/api/login")
async def parent_login(request: Request):
    body = await request.json()
    try:
        token = store.parent_login(str(body.get("name", "")), str(body.get("pin", "")), str(body.get("device", "")))
    except PermissionError as e:
        raise HTTPException(403, str(e))
    p = store.parent_session(token)
    _changed(p["name"], f"Signed in on {p['device']}")
    return {"token": token, "parent": p}


@app.get("/parent/api/status")
def parent_status():
    """Tells the sign-in screen whether the first parent account still needs to be created.
    The version lets the dashboard notice when KidView is back after an update."""
    return {"needs_setup": store.setup_code() is not None, "version": version.VERSION}


@app.post("/parent/api/setup")
async def parent_setup(request: Request):
    """Creates the first parent account, using the one-time setup code from the server log."""
    body = await request.json()
    try:
        store.create_first_parent(str(body.get("code", "")), str(body.get("name", "")), str(body.get("pin", "")))
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    token = store.parent_login(str(body.get("name", "")), str(body.get("pin", "")), str(body.get("device", "")) or "Browser")
    p = store.parent_session(token)
    _changed(p["name"], "Created the first parent account")
    return {"token": token, "parent": p}


@app.get("/parent/api/me")
def parent_me(p: dict = Depends(signed_in_parent)):
    return p


@app.post("/parent/api/logout")
def parent_logout(request: Request, p: dict = Depends(signed_in_parent)):
    store.parent_logout(_token(request))
    _changed(p["name"], f"Signed out on {p['device']}")
    return {"ok": True}


@app.post("/parent/api/pin")
async def parent_pin(request: Request, p: dict = Depends(signed_in_parent)):
    body = await request.json()
    try:
        store.change_pin(p["id"], str(body.get("old", "")), str(body.get("new", "")))
    except ValueError as e:
        raise HTTPException(400, str(e))
    _changed(p["name"], "Changed their PIN")
    return {"ok": True}


# ---------------------------------------------------------------- dashboard / parent app API

def _is_tailscale(addr: str) -> bool:
    try:
        a, b = (int(x) for x in addr.split(":")[0].split(".")[:2])
        return a == 100 and 64 <= b <= 127
    except ValueError:
        return False


def _labelled_addresses(seen_as: str = "") -> list[dict]:
    """Addresses the apps can use to reach this server, best first.

    seen_as is the address a parent opened the dashboard (or parent app) with. If it isn't
    localhost it plainly works from their network, so it's offered first.
    """
    # In Docker the server can't see the host's addresses, so they can be given like
    # KIDVIEW_ADDRESSES="192.168.1.20:8765=Home Wi-Fi, 100.101.102.103:8765=Tailscale"
    if given := os.environ.get("KIDVIEW_ADDRESSES"):
        return [{"addr": a.split("=", 1)[0].strip(), "label": (a.split("=", 1) + [""])[1].strip()}
                for a in given.split(",") if a.strip()]
    # Inside Docker the detected addresses are the container's own, which no tablet can reach.
    found = [] if version.INSTALL == "docker" else _addresses()
    seen_as = seen_as.strip().lower()
    if seen_as and not seen_as.startswith(("localhost", "127.", "[::1]", "0.0.0.0")) and seen_as not in found:
        found.insert(0, seen_as)
    out, home = [], False
    for a in found:
        if _is_tailscale(a):
            label = "Tailscale (works away from home)"
        else:
            label, home = ("Other network" if home else "Home Wi-Fi"), True
        out.append({"addr": a, "label": label})
    return out


def _addresses() -> list[str]:
    found: list[str] = []
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # picks the main network card; nothing is sent
            found.append(s.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip not in found and not ip.startswith(("127.", "169.254.")):
                found.append(ip)
    except OSError:
        pass
    return [f"{ip}:{PORT}" for ip in found]


@app.get("/admin/manifest.webmanifest")
def admin_manifest():
    """Lets phones install the dashboard as an app (iPhone: Share → Add to Home Screen)."""
    return Response(json.dumps(webapp.MANIFEST), media_type="application/manifest+json")


@app.get("/admin/icon-{size}.png")
def admin_icon(size: int):
    if size not in webapp.ICONS:
        raise HTTPException(404)
    return Response(webapp.ICONS[size], media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})


@app.get("/admin")
def admin_page():
    # Open on the server computer itself without signing in; from anywhere else, the page asks
    # for a parent name and PIN before it can load anything.
    return FileResponse(HERE / "admin.html", headers={"Cache-Control": "no-store"})


@app.get("/admin/api/state")
def admin_state(request: Request, actor: str = Depends(parent)):
    r = store.rules()
    return {
        "rules": r,
        # Family-wide status: only schedules that apply to every device. Each device page shows its own.
        "watching": schedule.status(store.family_rules()),
        "family_code": store.family_code(),
        "devices": store.devices(),
        "parents": store.parents(),
        "addresses": _labelled_addresses(request.headers.get("host", "")),
        "js_runtime": bool(shutil.which("deno") or shutil.which("node")),
        "topics": store.TOPICS,
        "me": actor,
        "rules_rev": rules_rev(r),
        "version": version.VERSION,
        "update": version.update(),
        "updating": version.installing,
    }


UNREACHABLE = "Couldn't reach the KidView website. Check the internet connection and try again."


@app.post("/admin/api/update/check")
def admin_update_check(actor: str = Depends(parent)):
    """Settings → Check for updates: asks the KidView website right now."""
    try:
        up = version.check_now()
    except Exception:
        raise HTTPException(502, UNREACHABLE)
    return {"version": version.VERSION, "update": up}


@app.post("/admin/api/update/install")
def admin_update_install(actor: str = Depends(parent)):
    """"Update now": installs the newest published server version and restarts KidView."""
    try:
        new = version.start_install()
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    except Exception:
        raise HTTPException(502, UNREACHABLE)
    _changed(actor, f"Started updating KidView to {new}")
    return {"ok": True, "version": new}


def pair_link(kind: str, addr: str) -> str:
    """What the QR codes hold. The kids' app reads its link (or opens it from the camera). The parent
    code is the dashboard's own address: a phone's camera opens it, ready to add to the Home Screen,
    and the Android parent app's Scan code reads the server address from it."""
    if kind == "parent":
        return f"http://{addr}/admin"
    return "kidview://pair?" + urlencode({"server": addr, "code": store.family_code()})


@app.get("/admin/api/pair-qr", dependencies=[Depends(parent)])
def admin_pair_qr(kind: str = "kid", addr: str = ""):
    """QR code to set up a kid's device (server + family code) or the parent app (server only)."""
    if kind not in ("kid", "parent"):
        raise HTTPException(400)
    addr = addr or next(iter(a["addr"] for a in _labelled_addresses()), f"localhost:{PORT}")
    # A full SVG document (with its xmlns), so browsers draw it as an <img>.
    buf = io.BytesIO()
    segno.make(pair_link(kind, addr), error="m").save(buf, kind="svg", scale=6, border=2, dark="#1d2330",
                                                      light="#ffffff", xmldecl=False)
    return Response(buf.getvalue(), media_type="image/svg+xml", headers={"Cache-Control": "no-store"})


RULE_LABELS = {
    "search_enabled": lambda v: "Turned searching " + ("on" if v else "off"),
    "mode": lambda v: "Switched to " + ("Approved (only allowed channels)" if v == "allowlist" else "Filtered (anything not blocked)"),
    "block_shorts": lambda v: "Shorts " + ("hidden" if v else "allowed"),
    "check_descriptions": lambda v: ("Started" if v else "Stopped") + " checking descriptions and tags",
    "max_minutes": lambda v: f"Longest video set to {v} min" if v else "Removed the video length limit",
    "max_quality": lambda v: f"Video quality set to {v}p",
    "activity_days": lambda v: f"Activity is now kept for {v} days",
}


@app.post("/admin/api/rules")
async def admin_rules(request: Request, actor: str = Depends(parent)):
    changes = {k: v for k, v in (await request.json()).items() if k in RULE_LABELS}
    if "activity_days" in changes and changes["activity_days"] not in (7, 14, 30, 90):
        raise HTTPException(400, "Choose 7, 14, 30 or 90 days")
    before = store.rules()
    r = store.update_rules(changes)
    for k, v in changes.items():
        if before.get(k) != v:
            _changed(actor, RULE_LABELS[k](v))
    if "activity_days" in changes:
        store.prune(force=True)
    library.wake()
    return r


LISTS = {
    # key: (added, removed, field that names the item)
    "blocked_words": ('Blocked the word "{}"', 'Unblocked the word "{}"', "word"),
    "blocked_channels": ("Blocked channel {}", "Unblocked channel {}", "name"),
    "allowed_channels": ("Allowed channel {}", "Removed allowed channel {}", "name"),
    "blocked_videos": ("Blocked video {}", "Unblocked video {}", "title"),
    "approved_videos": ("Added to Picks: {}", "Removed from Picks: {}", "title"),
    "library_videos": ("Saved offline: {}", "Removed from offline library: {}", "title"),
    "library_channels": ("Added channel to offline library: {}", "Removed channel from offline library: {}", "name"),
}


def _device_or_404(device_id: str) -> dict:
    d = store.device_info(device_id)
    if not d:
        raise HTTPException(404, "That device isn't set up any more")
    return d


@app.post("/admin/api/list/add")
async def admin_list_add(request: Request, actor: str = Depends(parent)):
    """Adds to a family list, or with "device": id, to just that child's restrictions."""
    body = await request.json()
    key, item, device_id = body.get("key"), body.get("item") or {}, body.get("device")
    if key not in LISTS or (device_id and key not in store.LIMIT_LISTS):
        raise HTTPException(400)
    label = LISTS[key][0].format(item.get(LISTS[key][2]) or item.get("id"))
    try:
        if device_id:
            d = _device_or_404(device_id)
            store.device_list_add(device_id, key, item)
            _changed(actor, f"{label} for {d['name']}")
            return {"limits": store.device_limits(device_id)}
        r = store.add_to_list(key, item)
    except ValueError:
        raise HTTPException(400, "That item is missing its YouTube ID")
    _changed(actor, label)
    library.wake()
    return r


@app.post("/admin/api/list/remove")
async def admin_list_remove(request: Request, actor: str = Depends(parent)):
    body = await request.json()
    key, item_id, device_id = body.get("key"), str(body.get("id")), body.get("device")
    if key not in LISTS or (device_id and key not in store.LIMIT_LISTS):
        raise HTTPException(400)
    source = store.device_limits(device_id)[key] if device_id else store.rules()[key]
    if key == "blocked_words":
        label = item_id
    else:
        old = next((i for i in source if i["id"] == item_id), {})
        label = old.get(LISTS[key][2]) or item_id
    if device_id:
        d = _device_or_404(device_id)
        store.device_list_remove(device_id, key, item_id)
        _changed(actor, LISTS[key][1].format(label) + f" for {d['name']}")
        return {"limits": store.device_limits(device_id)}
    r = store.remove_from_list(key, item_id)
    _changed(actor, LISTS[key][1].format(label))
    library.wake()
    return r


@app.post("/admin/api/topic")
async def admin_topic(request: Request, actor: str = Depends(parent)):
    body = await request.json()
    if body.get("name") not in store.TOPICS:
        raise HTTPException(400)
    r = store.set_topic(body["name"], bool(body.get("block")))
    _changed(actor, ("Blocked" if body.get("block") else "Allowed") + f" the topic {body['name']}")
    library.wake()
    return r


# ---- watching and schedules

def _when(ts: float | None) -> str:
    if not ts:
        return ""
    dt = datetime.fromtimestamp(ts)
    day = "" if dt.date() == datetime.now().date() else dt.strftime("%a ")
    return day + dt.strftime("%I:%M %p").lstrip("0")


@app.post("/admin/api/watching")
async def admin_watching(request: Request, actor: str = Depends(parent)):
    """The Watching switch. With schedules, it lasts until the schedule next changes (or for N minutes)."""
    body = await request.json()
    on = bool(body.get("on"))
    minutes = int(body["minutes"]) if body.get("minutes") else None
    override = schedule.override_for(store.family_rules(), on, minutes)
    store.update_rules({"override": override})
    st = schedule.status(store.family_rules())
    text = "Turned watching " + ("on" if on else "off")
    if override and override.get("until"):
        text += f" until {_when(override['until'])}"
    elif not override and st["has_schedules"]:
        text = "Went back to the schedule"
    _changed(actor, text)
    return admin_state(actor)


@app.post("/admin/api/watching/resume")
def admin_watching_resume(actor: str = Depends(parent)):
    store.update_rules({"override": None})
    _changed(actor, "Went back to the schedule")
    return admin_state(actor)


@app.post("/admin/api/schedules/save")
async def admin_schedule_save(request: Request, actor: str = Depends(parent)):
    try:
        s = schedule.clean((await request.json()).get("schedule") or {})
    except ValueError as e:
        raise HTTPException(400, str(e))
    known = {d["id"] for d in store.devices()}
    s["devices"] = [x for x in s["devices"] if x in known]
    current = store.rules()["schedules"]
    old = next((x for x in current if x["id"] == s["id"]), None)
    if old is None:
        current.append(s)
        text = f"Added schedule {s['name']}" + ("" if s["enabled"] else " (switched off)")
    else:
        current = [s if x["id"] == s["id"] else x for x in current]
        if old["enabled"] != s["enabled"] and {**old, "enabled": s["enabled"]} == s:
            text = ("Turned on" if s["enabled"] else "Turned off") + f" schedule {s['name']}"
        else:
            text = f"Changed schedule {s['name']}"
    store.update_rules({"schedules": current})
    _changed(actor, text)
    return admin_state(actor)


@app.post("/admin/api/schedules/delete")
async def admin_schedule_delete(request: Request, actor: str = Depends(parent)):
    sid = str((await request.json()).get("id"))
    current = store.rules()["schedules"]
    gone = next((x for x in current if x["id"] == sid), None)
    store.update_rules({"schedules": [x for x in current if x["id"] != sid]})
    if gone:
        _changed(actor, f"Deleted schedule {gone['name']}")
    return admin_state(actor)


# ---- library, lookups, preview, activity

@app.get("/admin/api/library", dependencies=[Depends(parent)])
def admin_library():
    return library.overview()


@app.post("/admin/api/library/sync", dependencies=[Depends(parent)])
def admin_library_sync():
    library.wake()
    return {"ok": True}


@app.post("/admin/api/lookup/channel", dependencies=[Depends(parent)])
async def admin_lookup_channel(request: Request):
    text = str((await request.json()).get("text", ""))
    try:
        return await run_in_threadpool(youtube.channel_from_url, text)
    except Exception as e:
        raise HTTPException(400, f"Couldn't find that channel ({e})")


@app.post("/admin/api/lookup/video", dependencies=[Depends(parent)])
async def admin_lookup_video(request: Request):
    vid = youtube.video_id_from_text(str((await request.json()).get("text", "")))
    if not vid:
        raise HTTPException(400, "That doesn't look like a YouTube video link")
    try:
        info = await run_in_threadpool(youtube.video, vid, store.rules()["max_quality"])
    except Exception as e:
        raise HTTPException(400, f"Couldn't load that video ({e})")
    return {**_card(info), "channel_id": info["channel_id"], "reason": filters.check_video(info, store.rules())}


@app.get("/admin/api/preview", dependencies=[Depends(parent)])
def admin_preview(q: str):
    r = store.rules()
    q = " ".join(q.split())[:100]
    query_reason = filters.check_search(q, r)
    try:
        items = youtube.search(q)
    except Exception as e:
        print("preview search failed:", e)
        raise HTTPException(502, "Search isn't working right now")
    return {
        "query_reason": query_reason,
        "results": [{**_card(v), "channel_id": v["channel_id"], "reason": filters.check_video(v, r)} for v in items],
    }


@app.get("/admin/api/activity", dependencies=[Depends(parent)])
def admin_activity(limit: int = 300, device: str = "", who: str = "", kind: str = "",
                   since: float | None = None, until: float | None = None, q: str = ""):
    """Activity, newest first. Defaults to the past week.

    device: a kid's device id. who: a parent's name (or "PC dashboard") for changes.
    kind: watch, search, blocked, saved, change (comma-separated for several).
    since/until: epoch seconds. q: words in the title, channel, search or change.
    """
    store.prune()
    if since is None:
        since = time.time() - 7 * 86400
    return store.activity(min(limit, 2000), device_id=device or None, who=who or None,
                          kinds=[k for k in kind.split(",") if k], since=since, until=until, text=q.strip() or None)


# ---- kids' devices and parent accounts

@app.post("/admin/api/devices/remove")
async def admin_remove_device(request: Request, actor: str = Depends(parent)):
    device_id = str((await request.json()).get("id"))
    d = _device_or_404(device_id)
    store.remove_device(device_id)
    _changed(actor, f"Removed device {d['name']}")
    return {"ok": True}


@app.post("/admin/api/devices/rename")
async def admin_rename_device(request: Request, actor: str = Depends(parent)):
    body = await request.json()
    try:
        old = store.rename_device(str(body.get("id")), str(body.get("name", "")))
    except ValueError as e:
        raise HTTPException(400, str(e))
    if old is None:
        raise HTTPException(404, "That device isn't set up any more")
    new = str(body.get("name", "")).strip()[:40]
    if old != new:
        _changed(actor, f"Renamed device {old} to {new}")
    return {"devices": store.devices()}


LIMIT_LABELS = {
    "watching": lambda v: "Watching " + ("allowed" if v else "turned off"),
    "search_enabled": lambda v: "Searching uses the family setting" if v is None else "Searching " + ("on" if v else "off"),
    "mode": lambda v: "What can they find? uses the family setting" if v is None
        else "What can they find? set to " + ("Approved" if v == "allowlist" else "Filtered"),
    "max_minutes": lambda v: "Longest video uses the family setting" if v is None
        else (f"Longest video set to {v} min" if v else "No video length limit"),
    "block_shorts": lambda v: "Shorts use the family setting" if v is None else "Shorts " + ("hidden" if v else "allowed"),
}


@app.get("/admin/api/devices/{device_id}", dependencies=[Depends(parent)])
def admin_device(device_id: str):
    """Everything about one kid's device: status, restrictions, stats and activity."""
    d = _device_or_404(device_id)
    r = store.rules_for(device_id)
    stats = store.device_stats(device_id)
    stats.pop("watched_ids", None)
    return {
        "device": {k: d.get(k) for k in ("id", "name", "added", "last_seen")},
        "watching": schedule.status(r),
        "limits": store.device_limits(device_id),
        "family": {k: store.rules()[k] for k in ("search_enabled", "mode", "max_minutes", "block_shorts")},
        "schedules": r["schedules"],
        "stats": stats,
    }


@app.get("/admin/api/devices/{device_id}/recommended", dependencies=[Depends(parent)])
def admin_device_recommended(device_id: str):
    _device_or_404(device_id)
    return recommend.for_device(device_id, store.rules_for(device_id))


@app.post("/admin/api/devices/{device_id}/limits")
async def admin_device_limits(device_id: str, request: Request, actor: str = Depends(parent)):
    d = _device_or_404(device_id)
    changes = {k: v for k, v in (await request.json()).items() if k in LIMIT_LABELS}
    before = store.device_limits(device_id)
    after = store.set_device_limits(device_id, changes)
    for k in changes:
        if before.get(k) != after.get(k):
            _changed(actor, f"{d['name']}: {LIMIT_LABELS[k](after[k])}")
    return {"limits": after}


@app.post("/admin/api/code/new")
def admin_new_code(actor: str = Depends(parent)):
    code = store.new_family_code()
    _changed(actor, "Made a new family code")
    return {"family_code": code}


@app.post("/admin/api/parents/add")
async def admin_parent_add(request: Request, actor: str = Depends(parent)):
    body = await request.json()
    try:
        p = store.add_parent(str(body.get("name", "")), str(body.get("pin", "")))
    except ValueError as e:
        raise HTTPException(400, str(e))
    _changed(actor, f"Added parent account {p['name']}")
    return {"parents": store.parents()}


@app.post("/admin/api/parents/remove")
async def admin_parent_remove(request: Request, actor: str = Depends(parent)):
    pid = str((await request.json()).get("id"))
    name = next((p["name"] for p in store.parents() if p["id"] == pid), None)
    if name is None:
        raise HTTPException(404)
    store.remove_parent(pid)
    _changed(actor, f"Removed parent account {name}")
    return {"parents": store.parents()}


if __name__ == "__main__":
    import uvicorn

    if not (shutil.which("deno") or shutil.which("node")):
        print("WARNING: yt-dlp needs Deno or Node.js installed to play YouTube videos.")
    print(f"KidView server on port {PORT}")
    print(f"  Parent dashboard: http://localhost:{PORT}/admin")
    for a in _labelled_addresses():
        print(f"  Server address for the apps: {a['addr']}  ({a['label']})")
    if not _labelled_addresses():
        print("  Open the dashboard from a phone or PC at http://<this server's address>:"
              f"{PORT}/admin and it will show the setup QR code (or set KIDVIEW_ADDRESSES).")
    print(f"  Family code (kids' devices): {store.family_code()}")
    if code := store.setup_code():
        print("  No parent accounts yet. Open the dashboard from any device and create one")
        print(f"  with this one-time SETUP CODE: {code}")
    if not library.has_ffmpeg():
        print("NOTE: ffmpeg isn't installed, so saved videos will be 360p. Install ffmpeg for 720p.")
    library.start()
    recommend.prewarm()
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
