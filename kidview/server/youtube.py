"""Everything that talks to YouTube goes through yt-dlp here."""
from __future__ import annotations

import re
import threading
import time

import yt_dlp

VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")

_BASE_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "skip_download": True,
    "noplaylist": True,
    # yt-dlp needs a JavaScript runtime for YouTube. Deno is preferred; Node works too.
    "js_runtimes": {"deno": {}, "node": {}},
}

# How long resolved stream links are reused. YouTube links expire after ~6 hours.
_STREAM_TTL = 60 * 60
_SEARCH_TTL = 10 * 60

_lock = threading.Lock()
_search_cache: dict[str, tuple[float, list[dict]]] = {}
_video_cache: dict[str, tuple[float, dict]] = {}


def is_video_id(value: str) -> bool:
    return bool(VIDEO_ID.match(value or ""))


def _flat_entry(e: dict) -> dict | None:
    vid = e.get("id")
    if not is_video_id(vid or ""):
        return None
    url = e.get("url") or ""
    return {
        "id": vid,
        "title": e.get("title") or "",
        "channel": e.get("channel") or e.get("uploader") or "",
        "channel_id": e.get("channel_id") or "",
        "duration": int(e["duration"]) if e.get("duration") else None,
        "live": e.get("live_status") in ("is_live", "is_upcoming", "post_live"),
        "short": "/shorts/" in url,
        "description": e.get("description") or "",
        "tags": [],
        "age_limit": 0,
    }


def search(query: str, count: int = 40) -> list[dict]:
    key = f"{count}:{query.strip().lower()}"
    now = time.time()
    with _lock:
        hit = _search_cache.get(key)
        if hit and now - hit[0] < _SEARCH_TTL:
            return hit[1]
    with yt_dlp.YoutubeDL({**_BASE_OPTS, "extract_flat": "in_playlist"}) as ydl:
        info = ydl.extract_info(f"ytsearch{count}:{query}", download=False)
    results = [r for r in (_flat_entry(e) for e in info.get("entries") or [] if e) if r]
    with _lock:
        _search_cache[key] = (now, results)
    return results


def _format_selector(max_height: int) -> str:
    h = int(max_height)
    # 1) H.264 video + AAC audio as two plain HTTPS files (best quality, plays everywhere)
    # 2) a single file that already has both     3) the classic 360p combined file
    return (
        f"bv*[vcodec^=avc1][height<={h}][protocol=https]+ba[ext=m4a][protocol=https]"
        f"/b[vcodec^=avc1][acodec!=none][height<={h}][protocol=https]"
        "/18"
    )


def _stream(fmt: dict) -> dict:
    return {
        "url": fmt["url"],
        "headers": dict(fmt.get("http_headers") or {}),
        "size": fmt.get("filesize") or fmt.get("filesize_approx"),
        "mime": "audio/mp4" if fmt.get("vcodec") in (None, "none") else "video/mp4",
        # YouTube refuses the stream until the length of the ad it wanted to show has passed.
        "available_at": float(fmt.get("available_at") or 0),
    }


def seconds_until_ready(info: dict) -> float:
    ready = max((s.get("available_at", 0) for s in info.get("streams", {}).values()), default=0)
    return max(0.0, ready - time.time())


def video(video_id: str, max_height: int = 720, fresh: bool = False) -> dict:
    """Full details for one video, including stream links. Cached for an hour."""
    if not is_video_id(video_id):
        raise ValueError("bad video id")
    key = f"{video_id}:{max_height}"
    now = time.time()
    with _lock:
        hit = _video_cache.get(key)
        if hit and not fresh and now - hit[0] < _STREAM_TTL:
            return hit[1]

    opts = {**_BASE_OPTS, "format": _format_selector(max_height)}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)

    streams: dict[str, dict] = {}
    live = info.get("is_live") or info.get("live_status") in ("is_live", "is_upcoming", "post_live")
    if not live:
        parts = info.get("requested_formats")
        if parts:
            for f in parts:
                streams["audio" if f.get("vcodec") in (None, "none") else "video"] = _stream(f)
        elif info.get("url"):
            streams["combined"] = _stream(info)

    data = {
        "id": video_id,
        "title": info.get("title") or "",
        "channel": info.get("channel") or info.get("uploader") or "",
        "channel_id": info.get("channel_id") or "",
        "duration": int(info["duration"]) if info.get("duration") else None,
        "live": bool(live),
        "short": False,
        "description": info.get("description") or "",
        "tags": list(info.get("tags") or []),
        "age_limit": int(info.get("age_limit") or 0),
        "streams": streams,
    }
    # A Shorts video is vertical and at most 3 minutes long.
    if data["duration"] and data["duration"] <= 180 and (info.get("height") or 0) > (info.get("width") or 0):
        data["short"] = True
    with _lock:
        _video_cache[key] = (now, data)
    return data


def cached(video_id: str) -> dict | None:
    """Details we already looked up for a video (at any quality), without asking YouTube again."""
    with _lock:
        return next((hit[1] for k, hit in _video_cache.items() if k.startswith(video_id + ":")), None)


def forget(video_id: str) -> None:
    with _lock:
        for k in [k for k in _video_cache if k.startswith(video_id + ":")]:
            del _video_cache[k]


def channel_from_url(text: str) -> dict:
    """Turn a channel link, @handle, or video link into {id, name}."""
    text = text.strip()
    if text.startswith("@"):
        text = f"https://www.youtube.com/{text}"
    elif is_video_id(text):
        text = f"https://www.youtube.com/watch?v={text}"
    elif not text.startswith("http"):
        text = f"https://www.youtube.com/@{text}"
    opts = {**_BASE_OPTS, "extract_flat": True, "playlist_items": "0"}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(text, download=False)
    cid = info.get("channel_id") or (info.get("id") if str(info.get("id", "")).startswith("UC") else None)
    name = info.get("channel") or info.get("uploader") or info.get("title") or ""
    if not cid:
        raise ValueError("Couldn't find a channel at that link")
    return {"id": cid, "name": name.removesuffix(" - Videos")}


def video_id_from_text(text: str) -> str | None:
    text = text.strip()
    if is_video_id(text):
        return text
    m = re.search(r"(?:v=|youtu\.be/|shorts/|embed/|live/)([A-Za-z0-9_-]{11})", text)
    return m.group(1) if m else None
