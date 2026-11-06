"""Recommended videos for each kid's Home screen.

A new device gets a starter mix of funny and educational videos. Once a kid has watched a few
videos, Home shows newer videos from the channels they watch most and from their favourite
searches, plus a row of educational videos. Everything goes through that kid's rules first.
"""
from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor

import filters
import library
import store
import youtube

FUNNY = [
    "funny animals for kids", "funny cartoons for kids", "silly songs for kids",
    "funny pets compilation for kids", "kids comedy cartoon episodes",
]
LEARN = [
    "science experiments for kids", "animal facts for kids", "how things are made for kids",
    "space facts for kids", "learn to draw for kids", "math songs for kids", "dinosaurs for kids",
]
PERSONAL_AFTER = 3          # watches before Home becomes personal
STARTER_TTL = 6 * 3600
PERSONAL_TTL = 20 * 60

_pool = ThreadPoolExecutor(4)
_cache: dict[str, tuple[float, list]] = {}
_lock = threading.Lock()


def _safe(fn, *args) -> list:
    try:
        return fn(*args)
    except Exception as e:
        print("recommendations: lookup failed:", e)
        return []


def _cached(key: str, ttl: int, make) -> list:
    with _lock:
        hit = _cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    value = make()
    with _lock:
        _cache[key] = (time.time(), value)
    return value


def _mix(lists: list[list[dict]]) -> list[dict]:
    """Take turns from each list so no single channel or search fills the screen."""
    out, seen = [], set()
    for i in range(max((len(x) for x in lists), default=0)):
        for lst in lists:
            if i < len(lst) and lst[i]["id"] not in seen:
                seen.add(lst[i]["id"])
                out.append(lst[i])
    return out


def _starter(kind: str) -> list[dict]:
    queries = FUNNY if kind == "funny" else LEARN
    return _cached(kind, STARTER_TTL, lambda: _mix(list(_pool.map(lambda q: _safe(youtube.search, q, 20), queries))))


def _personal(device_id: str, stats: dict) -> list[dict]:
    def make():
        channels = [c["channel_id"] for c in stats["top_channels"][:5]]
        searches = [s["query"] for s in stats["top_searches"][:3]]
        lists = list(_pool.map(lambda c: _safe(library._channel_latest, c, 10), channels))
        lists += list(_pool.map(lambda q: _safe(youtube.search, q, 20), searches))
        return _mix(lists)
    return _cached(f"device:{device_id}", PERSONAL_TTL, make)


def _allowed(videos: list[dict], rules: dict, skip: set[str], limit: int) -> list[dict]:
    out = []
    for v in videos:
        if v["id"] in skip or filters.check_video(v, rules):
            continue
        out.append({"id": v["id"], "title": v.get("title", ""), "channel": v.get("channel", ""),
                    "channel_id": v.get("channel_id", ""), "duration": v.get("duration")})
        if len(out) >= limit:
            break
    return out


def for_device(device_id: str, rules: dict) -> dict:
    stats = store.device_stats(device_id)
    watched = set(stats["watched_ids"])
    if stats["watches_total"] < PERSONAL_AFTER or not (stats["top_channels"] or stats["top_searches"]):
        return {
            "personal": False,
            "sections": [
                {"title": "Funny videos 😂", "videos": _allowed(_starter("funny"), rules, watched, 16)},
                {"title": "Learn something new 🧠", "videos": _allowed(_starter("learn"), rules, watched, 16)},
            ],
        }
    rec = _allowed(_personal(device_id, stats), rules, watched, 24)
    if len(rec) < 12:  # not much yet: top up with the starter mix
        rec += _allowed(_starter("funny"), rules, watched | {v["id"] for v in rec}, 12 - len(rec))
    learn = _allowed(_starter("learn"), rules, watched | {v["id"] for v in rec}, 8)
    return {
        "personal": True,
        "based_on": [c["channel"] for c in stats["top_channels"][:3]],
        "sections": [
            {"title": "Recommended for you ⭐", "videos": rec},
            {"title": "Learn something new 🧠", "videos": learn},
        ],
    }


def prewarm() -> None:
    """Fetch the starter mix in the background so the first kid doesn't wait."""
    threading.Thread(target=lambda: (_starter("funny"), _starter("learn")), daemon=True).start()
