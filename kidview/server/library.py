"""Offline library.

The server downloads the videos you choose (and the newest videos from channels you choose)
into data/library. Kids' devices copy them over Wi-Fi so they can watch with no connection.
The library is rebuilt every few hours and whenever you change your rules, so blocked videos
are deleted here and then from the devices on their next sync.
"""
from __future__ import annotations

import json
import shutil
import threading
import time
import traceback

import yt_dlp

import filters
import store
import youtube

LIB = store.DATA / "library"
LIB.mkdir(exist_ok=True)
INDEX = LIB / "index.json"
REFRESH_EVERY = 4 * 3600
CHANNEL_TTL = 3600

_lock = threading.RLock()
_wake = threading.Event()
_items: dict[str, dict] = {}       # id -> details + state ("waiting" | "downloading" | "ready" | "failed")
_status = {"current": None, "last_run": 0.0, "error": None}
_channel_cache: dict[str, tuple[float, list[dict]]] = {}
# Full details of every video we've looked at, so rejected ones aren't picked again.
META_FILE = LIB / "meta.json"
_meta: dict[str, dict] = {}

if INDEX.exists():
    try:
        _items.update(json.loads(INDEX.read_text("utf-8")))
    except ValueError:
        pass
if META_FILE.exists():
    try:
        _meta.update(json.loads(META_FILE.read_text("utf-8")))
    except ValueError:
        pass
for _v in _items.values():
    if _v.get("state") == "downloading":
        _v["state"] = "waiting"


def _save() -> None:
    with _lock:
        for file, data in ((INDEX, _items), (META_FILE, _meta)):
            tmp = file.with_suffix(".tmp")
            tmp.write_text(json.dumps(data, ensure_ascii=False), "utf-8")
            tmp.replace(file)


def path(video_id: str):
    return LIB / f"{video_id}.mp4"


def has_ffmpeg() -> bool:
    return bool(shutil.which("ffmpeg"))


def wake() -> None:
    """Ask the worker to rebuild the library soon (after a rules change, or 'Sync now')."""
    _wake.set()


def _channel_latest(channel_id: str, count: int) -> list[dict]:
    hit = _channel_cache.get(channel_id)
    if hit and time.time() - hit[0] < CHANNEL_TTL and len(hit[1]) >= count:
        return hit[1]
    opts = {**youtube._BASE_OPTS, "extract_flat": "in_playlist", "playlist_items": f"1-{count * 3}"}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/channel/{channel_id}/videos", download=False)
    out = []
    for e in info.get("entries") or []:
        v = youtube._flat_entry(e or {})
        if v:
            v["channel_id"] = v["channel_id"] or channel_id
            v["channel"] = v["channel"] or info.get("channel") or info.get("uploader") or ""
            out.append(v)
    _channel_cache[channel_id] = (time.time(), out)
    return out


def _allowed(meta: dict, rules: dict, hand_picked: bool) -> bool:
    if hand_picked:
        # You added it yourself, so only an explicit block removes it.
        blocked_ids = {v["id"] for v in rules["blocked_videos"]} | {c["id"] for c in rules["blocked_channels"]}
        return meta.get("id") not in blocked_ids and meta.get("channel_id") not in blocked_ids
    return filters.check_video(meta, rules) is None


def _wanted(rules: dict) -> dict[str, dict]:
    want: dict[str, dict] = {}
    for v in rules["library_videos"]:
        meta = _meta.get(v["id"]) or {**v, "channel_id": v.get("channel_id", "")}
        if _allowed(meta, rules, hand_picked=True):
            want[v["id"]] = {"title": v.get("title", ""), "channel": v.get("channel", ""), "source": "Added by you"}
    for ch in rules["library_channels"]:
        count = max(1, min(int(ch.get("count") or 5), 30))
        try:
            latest = _channel_latest(ch["id"], count)
        except Exception as e:
            print(f"library: couldn't list channel {ch.get('name')}: {e}")
            # Keep what we already have from this channel rather than deleting it on a network blip.
            for vid, item in _items.items():
                if item.get("source") == ch.get("name") and item.get("state") == "ready":
                    want.setdefault(vid, {k: item[k] for k in ("title", "channel", "source")})
            continue
        picked = 0
        for v in latest:
            meta = _meta.get(v["id"]) or v
            if v.get("short") or not _allowed(meta, rules, hand_picked=False):
                continue
            want.setdefault(v["id"], {"title": v["title"], "channel": v["channel"], "source": ch.get("name", "")})
            picked += 1
            if picked >= count:
                break
    return want


def _download(vid: str, rules: dict) -> None:
    item = _items[vid]
    hand_picked = item.get("source") == "Added by you"
    info = youtube.video(vid, rules["max_quality"])      # full details for a final check
    meta = {k: info[k] for k in ("id", "title", "channel", "channel_id", "duration", "live", "short",
                                 "description", "tags", "age_limit")}
    with _lock:
        _meta[vid] = meta
        if len(_meta) > 3000:
            for old in list(_meta)[:500]:
                del _meta[old]
        item.update(title=info["title"], channel=info["channel"], duration=info["duration"])
    if not _allowed(meta, rules, hand_picked):
        with _lock:
            item.update(state="skipped", error=filters.check_video(meta, rules))
        _wake.set()  # pick the next-newest video from that channel instead
        return

    h = int(rules["max_quality"])
    fmt = (f"bv*[vcodec^=avc1][height<={h}]+ba[ext=m4a]/b[vcodec^=avc1][acodec!=none][height<={h}]/18"
           if has_ffmpeg() else "18/b[vcodec^=avc1][acodec!=none]")
    opts = {
        **youtube._BASE_OPTS,
        "skip_download": False,
        "format": fmt,
        "merge_output_format": "mp4",
        "outtmpl": str(LIB / f"{vid}.tmp.%(ext)s"),
        "noprogress": True,
        "postprocessor_args": {"merger": ["-movflags", "+faststart"]},
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([f"https://www.youtube.com/watch?v={vid}"])
    produced = next((p for p in LIB.glob(f"{vid}.tmp.*") if p.suffix == ".mp4"), None)
    if not produced:
        raise RuntimeError("download finished but no mp4 was made")
    produced.replace(path(vid))
    for leftover in LIB.glob(f"{vid}.tmp.*"):
        leftover.unlink(missing_ok=True)
    with _lock:
        item.update(state="ready", size=path(vid).stat().st_size, ready_at=time.time(), error=None)


def run_once() -> None:
    rules = store.rules()
    want = _wanted(rules)
    with _lock:
        for vid in [v for v in _items if v not in want]:
            path(vid).unlink(missing_ok=True)
            del _items[vid]
        for vid, w in want.items():
            item = _items.setdefault(vid, {"state": "waiting", "added": time.time()})
            item.update(id=vid, title=item.get("title") or w["title"], channel=item.get("channel") or w["channel"],
                        source=w["source"])
            if item["state"] == "ready" and not path(vid).exists():
                item["state"] = "waiting"
            if item["state"] in ("failed", "skipped"):
                item["state"] = "waiting"
        _save()
        todo = [v for v, i in _items.items() if i["state"] == "waiting"]

    for vid in todo:
        if _wake.is_set():
            return  # rules changed (or something was skipped); start over
        with _lock:
            _items[vid]["state"] = "downloading"
            _status["current"] = _items[vid].get("title")
        try:
            _download(vid, rules)
        except Exception as e:
            with _lock:
                _items[vid].update(state="failed", error=str(e)[:200])
            print(f"library: {vid} failed: {e}")
        finally:
            with _lock:
                _status["current"] = None
            _save()


def _worker() -> None:
    while True:
        _wake.clear()
        try:
            run_once()
            _status["error"] = None
        except Exception as e:
            traceback.print_exc()
            _status["error"] = str(e)[:200]
        _status["last_run"] = time.time()
        _wake.wait(REFRESH_EVERY)
        time.sleep(2)  # let a burst of rule changes settle


def start() -> None:
    threading.Thread(target=_worker, name="library", daemon=True).start()


def ready_items() -> list[dict]:
    with _lock:
        return [
            {"id": vid, "title": i.get("title", ""), "channel": i.get("channel", ""),
             "duration": i.get("duration"), "size": i.get("size", 0)}
            for vid, i in sorted(_items.items(), key=lambda kv: -kv[1].get("ready_at", 0))
            if i.get("state") == "ready" and path(vid).exists()
        ]


def overview() -> dict:
    with _lock:
        items = [{**i, "id": vid} for vid, i in _items.items()]
    items.sort(key=lambda i: (i.get("state") != "downloading", i.get("state") != "waiting", -i.get("ready_at", 0)))
    return {
        "items": items,
        "total_size": sum(i.get("size", 0) for i in items if i.get("state") == "ready"),
        "current": _status["current"],
        "last_run": _status["last_run"],
        "error": _status["error"],
        "ffmpeg": has_ffmpeg(),
    }
