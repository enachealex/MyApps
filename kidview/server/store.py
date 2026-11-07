"""Saved settings (rules, paired devices) and the activity log."""
from __future__ import annotations

import hashlib
import json
import os
import secrets
import sqlite3
import threading
import time
from pathlib import Path

DATA = Path(os.environ.get("KIDVIEW_DATA") or Path(__file__).with_name("data"))
DATA.mkdir(parents=True, exist_ok=True)
SETTINGS_FILE = DATA / "settings.json"
DB_FILE = DATA / "activity.db"

GENERAL_WORDS = [
    # scary / horror
    "horror", "scary", "creepy", "jumpscare", "jump scare", "gore", "blood", "demon", "possessed",
    "haunted", "zombie",
    # violence
    "kill", "killer", "murder", "gunfight", "shooter", "fight compilation", "knife", "gta",
    "call of duty", "mortal kombat",
    # grown-up stuff
    "sex", "sexy", "nsfw", "porn", "nude", "naked", "onlyfans", "twerk", "pregnant", "injection",
    "drunk", "alcohol", "beer", "vape", "weed", "drugs", "cocaine",
    # bad words
    "fuck", "shit", "bitch", "damn", "wtf", "asshole",
]

# One-click topics in the dashboard. Each is just a group of blocked words.
TOPICS = {
    "Roblox": [
        "roblox", "robux", "rblx", "obby", "bloxburg", "brookhaven", "blox fruits", "rainbow friends",
        "dress to impress", "grow a garden", "steal a brainrot", "99 nights in the forest", "adopt me",
        "dandy's world",
    ],
    "Scary games": [
        "five nights at freddy", "fnaf", "poppy playtime", "huggy wuggy", "garten of banban",
        "smiling critters", "catnap", "siren head", "cartoon cat", "backrooms", "slenderman",
        "creepypasta", "momo", "sprunki",
    ],
    "Brainrot memes": [
        "skibidi", "brainrot", "tung tung", "tralalero", "sigma", "rizz", "gyatt", "fanum tax", "mewing",
    ],
    "Pranks & dares": ["prank", "gone wrong", "3am challenge", "do not watch", "dare challenge"],
}

STARTER_WORDS = GENERAL_WORDS + [w for words in TOPICS.values() for w in words]

DEFAULT_RULES = {
    "mode": "blocklist",          # "blocklist" or "allowlist" (only allowed channels)
    "schedules": [],              # see schedule.py
    "override": None,             # the parent's Watching switch: {watching, until}
    "search_enabled": True,
    "blocked_words": STARTER_WORDS,
    "blocked_channels": [],       # [{id, name}]
    "allowed_channels": [],       # [{id, name}]
    "blocked_videos": [],         # [{id, title}]
    "approved_videos": [],        # [{id, title, channel}] — shown as "Picks" and always allowed
    "library_videos": [],         # [{id, title, channel}] — downloaded for offline watching
    "library_channels": [],       # [{id, name, count}] — newest `count` videos auto-downloaded
    "max_minutes": 0,             # 0 = no limit
    "block_shorts": True,
    "check_descriptions": True,
    "max_quality": 720,
    "activity_days": 7,           # activity older than this is deleted
}

_lock = threading.RLock()


def _new_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _load() -> dict:
    if SETTINGS_FILE.exists():
        data = json.loads(SETTINGS_FILE.read_text("utf-8"))
    else:
        data = {}
    data.setdefault("family_code", _new_code())
    data.setdefault("devices", {})
    data.setdefault("parents", [])
    data.setdefault("parent_sessions", {})
    for d in data["devices"].values():  # older versions had no id or per-device limits
        d.setdefault("id", secrets.token_hex(4))
        d.setdefault("limits", {})
    rules = {**DEFAULT_RULES, **data.get("rules", {})}
    # Older versions had a plain on/off switch.
    if rules.pop("paused", False) and not rules.get("override"):
        rules["override"] = {"watching": False, "until": None}
    data["rules"] = rules
    return data


_settings = _load()


def _save() -> None:
    tmp = SETTINGS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(_settings, indent=2, ensure_ascii=False), "utf-8")
    tmp.replace(SETTINGS_FILE)


_save()


def rules() -> dict:
    with _lock:
        return json.loads(json.dumps(_settings["rules"]))


def update_rules(changes: dict) -> dict:
    with _lock:
        for key, value in changes.items():
            if key in DEFAULT_RULES:
                _settings["rules"][key] = value
        _save()
        return rules()


def add_to_list(key: str, item: dict) -> dict:
    """Add {id, ...} to a rules list (no duplicates). Also removes it from the opposite list."""
    opposite = {
        "blocked_channels": "allowed_channels", "allowed_channels": "blocked_channels",
        "blocked_videos": "approved_videos", "approved_videos": "blocked_videos",
    }
    with _lock:
        r = _settings["rules"]
        if key == "blocked_words":
            word = str(item.get("word", "")).strip().lower()
            if word and word not in r["blocked_words"]:
                r["blocked_words"].append(word)
        else:
            if not item.get("id"):
                raise ValueError("missing id")
            if not any(i["id"] == item["id"] for i in r[key]):
                r[key].insert(0, item)
            if key in opposite:
                r[opposite[key]] = [i for i in r[opposite[key]] if i["id"] != item["id"]]
        _save()
        return rules()


def set_topic(name: str, block: bool) -> dict:
    words = TOPICS.get(name, [])
    with _lock:
        r = _settings["rules"]
        if block:
            r["blocked_words"] += [w for w in words if w not in r["blocked_words"]]
        else:
            r["blocked_words"] = [w for w in r["blocked_words"] if w not in words]
        _save()
        return rules()


def remove_from_list(key: str, item_id: str) -> dict:
    with _lock:
        r = _settings["rules"]
        if key == "blocked_words":
            r[key] = [w for w in r[key] if w != item_id]
        else:
            r[key] = [i for i in r[key] if i["id"] != item_id]
        _save()
        return rules()


# ---- family code and devices ----

def family_code() -> str:
    with _lock:
        return _settings["family_code"]


def new_family_code() -> str:
    with _lock:
        _settings["family_code"] = _new_code()
        _save()
        return _settings["family_code"]


def pair(code: str, name: str) -> str | None:
    with _lock:
        if not secrets.compare_digest(code.strip(), _settings["family_code"]):
            return None
        token = secrets.token_urlsafe(24)
        _settings["devices"][token] = {"id": secrets.token_hex(4), "name": name.strip()[:40] or "Kid's device",
                                       "added": time.time(), "last_seen": time.time(), "limits": {}}
        _save()
        return token


def device(token: str | None) -> dict | None:
    """The kid's device for a token (its secret), or None."""
    if not token:
        return None
    with _lock:
        d = _settings["devices"].get(token)
        if d and time.time() - d.get("last_seen", 0) > 60:
            d["last_seen"] = time.time()
            _save()
        return json.loads(json.dumps(d)) if d else None


def devices() -> list[dict]:
    """Kids' devices for the parent screens. Tokens stay on the server; devices are known by id."""
    with _lock:
        return [{"id": d["id"], "name": d["name"], "added": d["added"], "last_seen": d.get("last_seen", 0)}
                for d in _settings["devices"].values()]


def _by_id(device_id: str) -> dict | None:
    return next((d for d in _settings["devices"].values() if d["id"] == device_id), None)


def device_info(device_id: str) -> dict | None:
    with _lock:
        d = _by_id(device_id)
        return json.loads(json.dumps(d)) if d else None


def rename_device(device_id: str, name: str) -> str | None:
    """Returns the old name, or None if there's no such device."""
    name = name.strip()[:40]
    if not name:
        raise ValueError("Enter a name")
    with _lock:
        d = _by_id(device_id)
        if not d:
            return None
        old = d["name"]
        d["name"] = name
        _save()
        return old


def remove_device(device_id: str) -> None:
    with _lock:
        _settings["devices"] = {t: d for t, d in _settings["devices"].items() if d["id"] != device_id}
        for s in _settings["rules"]["schedules"]:
            if device_id in (s.get("devices") or []):
                s["devices"] = [x for x in s["devices"] if x != device_id]
        _save()


# ---- videos a kid saved (the heart in the player) and what they watched ----

SAVED_MAX = 500
# Kept with each saved video so it can be checked against the rules again later.
SAVED_FIELDS = ("id", "title", "channel", "channel_id", "duration", "short", "age_limit", "tags")


def saved_videos(device_id: str) -> list[dict]:
    """The videos this device saved, newest first."""
    with _lock:
        d = _by_id(device_id) or {}
        return json.loads(json.dumps(d.get("saved") or []))


def set_saved(device_id: str, video: dict, saved: bool) -> None:
    with _lock:
        d = _by_id(device_id)
        if not d:
            raise KeyError(device_id)
        rest = [v for v in d.get("saved") or [] if v["id"] != video["id"]]
        if saved:
            rest.insert(0, {**{k: video.get(k) for k in SAVED_FIELDS}, "saved_at": time.time()})
        d["saved"] = rest[:SAVED_MAX]
        _save()


def is_saved(device_id: str, video_id: str) -> bool:
    with _lock:
        d = _by_id(device_id) or {}
        return any(v["id"] == video_id for v in d.get("saved") or [])


# ---- per-child restrictions (on top of the family rules) ----

# None means "use the family setting".
LIMIT_SETTINGS = {
    "watching": (bool,),            # False = watching is off on this device
    "search_enabled": (bool, type(None)),
    "mode": (str, type(None)),
    "max_minutes": (int, type(None)),
    "block_shorts": (bool, type(None)),
}
LIMIT_LISTS = ("blocked_words", "blocked_channels", "blocked_videos", "allowed_channels")


def device_limits(device_id: str) -> dict:
    with _lock:
        d = _by_id(device_id) or {}
        lim = d.get("limits") or {}
        out = {"watching": lim.get("watching", True)}
        for k in LIMIT_SETTINGS:
            if k != "watching":
                out[k] = lim.get(k)
        for k in LIMIT_LISTS:
            out[k] = list(lim.get(k) or [])
        return out


def set_device_limits(device_id: str, changes: dict) -> dict:
    with _lock:
        d = _by_id(device_id)
        if not d:
            raise KeyError(device_id)
        lim = d.setdefault("limits", {})
        for k, v in changes.items():
            if k not in LIMIT_SETTINGS or not isinstance(v, LIMIT_SETTINGS[k]):
                continue
            if k == "mode" and v not in (None, "blocklist", "allowlist"):
                continue
            if k == "max_minutes" and v is not None and not 0 <= v <= 600:
                continue
            lim[k] = v
        _save()
    return device_limits(device_id)


def device_list_add(device_id: str, key: str, item: dict) -> dict:
    with _lock:
        d = _by_id(device_id)
        if not d or key not in LIMIT_LISTS:
            raise KeyError(device_id)
        lim = d.setdefault("limits", {})
        lst = lim.setdefault(key, [])
        if key == "blocked_words":
            word = str(item.get("word", "")).strip().lower()
            if word and word not in lst:
                lst.append(word)
        else:
            if not item.get("id"):
                raise ValueError("missing id")
            if not any(i["id"] == item["id"] for i in lst):
                lst.insert(0, item)
            opposite = {"blocked_channels": "allowed_channels", "allowed_channels": "blocked_channels"}.get(key)
            if opposite:
                lim[opposite] = [i for i in lim.get(opposite, []) if i["id"] != item["id"]]
        _save()
    return device_limits(device_id)


def device_list_remove(device_id: str, key: str, item_id: str) -> dict:
    with _lock:
        d = _by_id(device_id)
        if not d or key not in LIMIT_LISTS:
            raise KeyError(device_id)
        lim = d.setdefault("limits", {})
        if key == "blocked_words":
            lim[key] = [w for w in lim.get(key, []) if w != item_id]
        else:
            lim[key] = [i for i in lim.get(key, []) if i["id"] != item_id]
        _save()
    return device_limits(device_id)


def family_rules() -> dict:
    """Family rules, with only the schedules that apply to every device."""
    r = rules()
    r["schedules"] = [s for s in r["schedules"] if not s.get("devices")]
    return r


def rules_for(device_id: str) -> dict:
    """The rules a kid's device actually follows: the family rules plus that device's own restrictions."""
    r = rules()
    lim = device_limits(device_id)
    for k in ("search_enabled", "mode", "max_minutes", "block_shorts"):
        if lim[k] is not None:
            r[k] = lim[k]
    r["blocked_words"] = r["blocked_words"] + [w for w in lim["blocked_words"] if w not in r["blocked_words"]]
    for k in ("blocked_channels", "blocked_videos", "allowed_channels"):
        r[k] = r[k] + lim[k]
    blocked_here = {v["id"] for v in lim["blocked_videos"]}
    r["approved_videos"] = [v for v in r["approved_videos"] if v["id"] not in blocked_here]
    r["schedules"] = [s for s in r["schedules"] if not s.get("devices") or device_id in s["devices"]]
    if lim["watching"] is False:
        r["override"] = {"watching": False, "until": None, "device": True}
    return r


# ---- parent accounts (for the parent app) ----

_failed: dict[str, list[float]] = {}   # name -> recent failed PIN attempts


def _hash_pin(pin: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt), 200_000).hex()


def _valid_pin(pin: str) -> bool:
    return pin.isdigit() and 4 <= len(pin) <= 8


def parents() -> list[dict]:
    with _lock:
        return [{"id": p["id"], "name": p["name"], "created": p["created"]} for p in _settings["parents"]]


def add_parent(name: str, pin: str) -> dict:
    name = name.strip()[:30]
    if not name:
        raise ValueError("Enter a name")
    if not _valid_pin(pin):
        raise ValueError("The PIN needs 4 to 8 digits")
    with _lock:
        if any(p["name"].lower() == name.lower() for p in _settings["parents"]):
            raise ValueError("There's already a parent with that name")
        salt = secrets.token_hex(16)
        p = {"id": secrets.token_hex(4), "name": name, "salt": salt, "pin": _hash_pin(pin, salt), "created": time.time()}
        _settings["parents"].append(p)
        _save()
        return {"id": p["id"], "name": name}


def setup_code() -> str | None:
    """While there are no parent accounts, a one-time code (printed in the server log) is needed
    to create the first one from another device. Returns None once an account exists."""
    with _lock:
        if _settings["parents"]:
            _settings.pop("setup_code", None)
            return None
        if not _settings.get("setup_code"):
            _settings["setup_code"] = f"{secrets.randbelow(10**8):08d}"
            _save()
        return _settings["setup_code"]


def create_first_parent(code: str, name: str, pin: str) -> dict:
    now = time.time()
    recent = [t for t in _failed.get("__setup__", []) if now - t < 300]
    if len(recent) >= 5:
        raise PermissionError("Too many wrong setup codes. Try again in a few minutes.")
    with _lock:
        expected = setup_code()
        if expected is None:
            raise PermissionError("A parent account already exists. Sign in instead.")
        if not secrets.compare_digest(code.strip(), expected):
            _failed["__setup__"] = recent + [now]
            raise PermissionError("That setup code isn't right. It's in the server's log.")
        p = add_parent(name, pin)
        _settings.pop("setup_code", None)
        _save()
        return p


def remove_parent(parent_id: str) -> None:
    with _lock:
        _settings["parents"] = [p for p in _settings["parents"] if p["id"] != parent_id]
        _settings["parent_sessions"] = {t: s for t, s in _settings["parent_sessions"].items() if s["parent"] != parent_id}
        _save()


def change_pin(parent_id: str, old: str, new: str) -> None:
    if not _valid_pin(new):
        raise ValueError("The new PIN needs 4 to 8 digits")
    with _lock:
        p = next((p for p in _settings["parents"] if p["id"] == parent_id), None)
        if not p or not secrets.compare_digest(_hash_pin(old, p["salt"]), p["pin"]):
            raise ValueError("Your current PIN isn't right")
        p["salt"] = secrets.token_hex(16)
        p["pin"] = _hash_pin(new, p["salt"])
        _save()


def parent_login(name: str, pin: str, device_name: str) -> str:
    key = name.strip().lower()
    now = time.time()
    recent = [t for t in _failed.get(key, []) if now - t < 300]
    if len(recent) >= 5:
        raise PermissionError("Too many wrong PINs. Try again in a few minutes.")
    with _lock:
        p = next((p for p in _settings["parents"] if p["name"].lower() == key), None)
        if not p or not secrets.compare_digest(_hash_pin(pin, p["salt"]), p["pin"]):
            _failed[key] = recent + [now]
            raise PermissionError("That name or PIN isn't right")
        _failed.pop(key, None)
        token = secrets.token_urlsafe(32)
        _settings["parent_sessions"][token] = {"parent": p["id"], "device": device_name.strip()[:40] or "Phone",
                                               "created": now, "last_seen": now}
        _save()
        return token


def parent_session(token: str | None) -> dict | None:
    """The signed-in parent for a token: {id, name, device}."""
    if not token:
        return None
    with _lock:
        s = _settings["parent_sessions"].get(token)
        if not s:
            return None
        p = next((p for p in _settings["parents"] if p["id"] == s["parent"]), None)
        if not p:
            return None
        if time.time() - s.get("last_seen", 0) > 300:
            s["last_seen"] = time.time()
            _save()
        return {"id": p["id"], "name": p["name"], "device": s["device"]}


def parent_logout(token: str) -> None:
    with _lock:
        _settings["parent_sessions"].pop(token, None)
        _save()


# ---- activity log ----

def _db() -> sqlite3.Connection:
    con = sqlite3.connect(DB_FILE, timeout=10)
    con.row_factory = sqlite3.Row
    return con


with _db() as _con:
    _con.execute(
        """CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY, ts REAL, device TEXT, kind TEXT, query TEXT,
            video_id TEXT, title TEXT, channel TEXT, channel_id TEXT, reason TEXT, results INTEGER)"""
    )
    if "device_id" not in {r[1] for r in _con.execute("PRAGMA table_info(events)")}:
        _con.execute("ALTER TABLE events ADD COLUMN device_id TEXT")  # so renaming a device keeps its history
    _con.execute("CREATE INDEX IF NOT EXISTS events_ts ON events(ts)")

_last_prune = 0.0


def prune(force: bool = False) -> int:
    """Deletes activity older than the "keep activity for" setting (7 days unless changed)."""
    global _last_prune
    if not force and time.time() - _last_prune < 60:
        return 0
    _last_prune = time.time()
    days = int(rules().get("activity_days") or 7)
    with _lock, _db() as con:
        return con.execute("DELETE FROM events WHERE ts < ?", (time.time() - days * 86400,)).rowcount


prune(force=True)


def _cutoff() -> float:
    return time.time() - int(rules().get("activity_days") or 7) * 86400


def log(kind: str, device_name: str, ts: float | None = None, **fields) -> None:
    if ts and ts < _cutoff():
        return  # e.g. a device reporting offline watching from more than a week ago
    cols = ["ts", "device", "kind"] + list(fields)
    vals = [ts or time.time(), device_name, kind] + list(fields.values())
    with _lock, _db() as con:
        con.execute(f"INSERT INTO events ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})", vals)
    prune()


def _device_where(device_id: str) -> tuple[str, list]:
    """Matches a device's events, including ones logged before devices had ids."""
    d = device_info(device_id) or {}
    return "(device_id = ? OR (device_id IS NULL AND device = ?))", [device_id, d.get("name", "")]


KIND_GROUPS = {
    "watch": ("watch", "watch_saved"),
    "saved": ("watch_saved",),
    "search": ("search",),
    "blocked": ("blocked_search", "blocked_watch"),
    "change": ("change",),
}


def activity(limit: int = 300, device_id: str | None = None, who: str | None = None, kinds: list[str] | None = None,
             since: float | None = None, until: float | None = None, text: str | None = None) -> list[dict]:
    """Activity, newest first, narrowed down by any of the filters."""
    where, args = [], []
    if device_id:
        clause, extra = _device_where(device_id)
        where.append("kind != 'change' AND " + clause)
        args += extra
    if who:
        where.append("kind = 'change' AND device = ?")
        args.append(who)
    wanted = sorted({k for g in (kinds or []) for k in KIND_GROUPS.get(g, ())})
    if wanted:
        where.append(f"kind IN ({','.join('?' * len(wanted))})")
        args += wanted
    where.append("ts >= ?")  # never show anything past the "keep activity for" limit
    args.append(max(since or 0, _cutoff()))
    if until:
        where.append("ts <= ?")
        args.append(until)
    if text:
        like = f"%{text}%"
        where.append("(title LIKE ? OR channel LIKE ? OR query LIKE ? OR reason LIKE ?)")
        args += [like] * 4
    sql = "SELECT * FROM events" + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY ts DESC LIMIT ?"
    with _db() as con:
        rows = con.execute(sql, (*args, limit)).fetchall()
    return [dict(r) for r in rows]


def history(device_id: str, limit: int = 200) -> list[dict]:
    """Videos this device watched, each once, most recently watched first. Only as far back as the
    "keep activity for" setting, like the rest of the activity."""
    clause, args = _device_where(device_id)
    with _db() as con:
        rows = con.execute(
            f"""SELECT video_id AS id, MAX(ts) AS watched_at, title, channel, MAX(channel_id) AS channel_id
                FROM events WHERE {clause} AND kind IN ('watch', 'watch_saved') AND video_id != '' AND ts >= ?
                GROUP BY video_id ORDER BY watched_at DESC LIMIT ?""", (*args, _cutoff(), limit)).fetchall()
    return [dict(r) for r in rows]


def device_stats(device_id: str) -> dict:
    """What a kid watches most, for recommendations and the parent's device page."""
    clause, args = _device_where(device_id)
    now = time.time()
    with _db() as con:
        def one(sql, *extra):
            return con.execute(sql.format(w=clause), (*args, *extra)).fetchone()[0]
        watches_7d = one("SELECT COUNT(*) FROM events WHERE {w} AND kind IN ('watch','watch_saved') AND ts > ?", now - 7 * 86400)
        searches_7d = one("SELECT COUNT(*) FROM events WHERE {w} AND kind = 'search' AND ts > ?", now - 7 * 86400)
        watches_total = one("SELECT COUNT(*) FROM events WHERE {w} AND kind IN ('watch','watch_saved')")
        top_channels = [dict(r) for r in con.execute(
            f"""SELECT channel, channel_id, COUNT(*) AS count FROM events
                WHERE {clause} AND kind = 'watch' AND channel_id != '' AND ts > ?
                GROUP BY channel_id ORDER BY count DESC LIMIT 8""", (*args, now - 30 * 86400))]
        top_searches = [dict(r) for r in con.execute(
            f"""SELECT query, COUNT(*) AS count FROM events
                WHERE {clause} AND kind = 'search' AND results > 0 AND ts > ?
                GROUP BY lower(query) ORDER BY count DESC LIMIT 5""", (*args, now - 30 * 86400))]
        watched_ids = [r[0] for r in con.execute(
            f"SELECT DISTINCT video_id FROM events WHERE {clause} AND kind IN ('watch','watch_saved') AND ts > ?",
            (*args, now - 30 * 86400))]
    return {"watches_7d": watches_7d, "searches_7d": searches_7d, "watches_total": watches_total,
            "top_channels": top_channels, "top_searches": top_searches, "watched_ids": watched_ids}
