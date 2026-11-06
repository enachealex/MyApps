"""Decides whether a search or a video is OK for the kids, based on the parent's rules."""
from __future__ import annotations

import re
import unicodedata
from functools import lru_cache

# Leetspeak and look-alike letters people use to dodge filters.
_LOOKALIKE = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i"})


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c)).lower()
    text = re.sub(r"[^a-z0-9@$!]+", " ", text)
    return " ".join(text.split())


def _deleet(text: str) -> str:
    return " ".join(w.translate(_LOOKALIKE) for w in text.split())


@lru_cache(maxsize=4096)
def _pattern(word: str) -> re.Pattern | None:
    w = normalize(word)
    if not w:
        return None
    body = re.escape(w).replace(r"\ ", " +")
    if len(w.replace(" ", "")) <= 5:
        # Short words only match as whole words (plus plurals), so "kill" doesn't hit "skills".
        return re.compile(rf"(?<![a-z0-9]){body}(?:s|es)?(?![a-z0-9])")
    # Longer words match anywhere, which also catches hashtags like #skibiditoilet.
    return re.compile(body)


def find_word(text: str, words: list[str]) -> str | None:
    norm = normalize(text)
    variants = {norm, _deleet(norm)}
    for word in words:
        p = _pattern(word)
        if p and any(p.search(v) for v in variants):
            return word
    return None


def _ids(items: list) -> set[str]:
    return {i["id"] if isinstance(i, dict) else str(i) for i in items or []}


def check_search(query: str, rules: dict) -> str | None:
    if not rules.get("search_enabled", True):
        return "Searching is turned off"
    if word := find_word(query, rules.get("blocked_words", [])):
        return f'Search contains "{word}"'
    return None


def check_video(v: dict, rules: dict) -> str | None:
    """Returns None when the video is OK, otherwise a short reason for the parent."""
    vid, cid = v.get("id"), v.get("channel_id")
    if vid in _ids(rules.get("approved_videos")):
        return None
    if vid in _ids(rules.get("blocked_videos")):
        return "Video is blocked"
    if cid and cid in _ids(rules.get("blocked_channels")):
        return f"Channel is blocked ({v.get('channel')})"
    if v.get("age_limit", 0) > 0:
        return "YouTube marks it age-restricted"
    if v.get("live"):
        return "Live streams aren't supported"
    if rules.get("mode") == "allowlist" and cid not in _ids(rules.get("allowed_channels")):
        return "Channel isn't on the allowed list"

    words = rules.get("blocked_words", [])
    for label, text in (("title", v.get("title")), ("channel name", v.get("channel"))):
        if word := find_word(text or "", words):
            return f'"{word}" in {label}'
    if rules.get("check_descriptions", True):
        if word := find_word(v.get("description") or "", words):
            return f'"{word}" in description'
        if word := find_word(" , ".join(v.get("tags") or []), words):
            return f'"{word}" in tags'

    if rules.get("block_shorts", True) and v.get("short"):
        return "Shorts are turned off"
    max_min = int(rules.get("max_minutes") or 0)
    if max_min and v.get("duration") and v["duration"] > max_min * 60:
        return f"Longer than {max_min} min"
    return None
