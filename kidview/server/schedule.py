"""Watching schedules.

Each schedule has days, a start and end time, and a kind:
  "off"     - watching is off during that time (bedtime, school, dinner)
  "allowed" - on the chosen days, watching only works during that time

"off" wins over "allowed". A day with no "allowed" schedule is unrestricted.
If the end time is earlier than the start, the schedule runs overnight into the next day.
The same start and end time means all day.

The parent can also flip the Watching switch. That's an override that lasts until the
schedule would next change (or for a set number of minutes), so a forgotten override
can't switch bedtime off for good.
"""
from __future__ import annotations

import re
import secrets
from datetime import datetime, timedelta

HORIZON_DAYS = 7
TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _mins(hhmm: str) -> int:
    return int(hhmm[:2]) * 60 + int(hhmm[3:5])


def _active(s: dict, t: datetime) -> bool:
    start, end = _mins(s["start"]), _mins(s["end"])
    now = t.hour * 60 + t.minute
    day, prev = t.weekday(), (t.weekday() - 1) % 7
    days = set(s["days"])
    if start == end:
        return day in days
    if start < end:
        return day in days and start <= now < end
    return (day in days and now >= start) or (prev in days and now < end)


def enabled(rules: dict) -> list[dict]:
    return [s for s in rules.get("schedules") or [] if s.get("enabled") and s.get("days")]


def scheduled(rules: dict, t: datetime) -> tuple[bool, dict | None]:
    """What the schedules alone say: (watching on?, the schedule responsible)."""
    sch = enabled(rules)
    for s in sch:
        if s["kind"] == "off" and _active(s, t):
            return False, s
    allowed = [s for s in sch if s["kind"] == "allowed"]
    for s in allowed:
        if _active(s, t):
            return True, s
    today = [s for s in allowed if t.weekday() in s["days"]]
    if today:
        return False, today[0]
    return True, None


def _override(rules: dict, t: datetime) -> dict | None:
    ov = rules.get("override")
    if ov and (ov.get("until") is None or t.timestamp() < ov["until"]):
        return ov
    return None


def effective(rules: dict, t: datetime | None = None) -> bool:
    """Is watching on right now, taking the parent's override into account?"""
    t = t or datetime.now()
    ov = _override(rules, t)
    return ov["watching"] if ov else scheduled(rules, t)[0]


def _boundaries(rules: dict, now: datetime, days: int = HORIZON_DAYS + 1) -> list[datetime]:
    base = now.replace(hour=0, minute=0, second=0, microsecond=0)
    points = set()
    for offset in range(-1, days + 1):
        day = base + timedelta(days=offset)
        points.add(day)  # "allowed" schedules depend on the day, so midnight can matter
        for s in enabled(rules):
            points.add(day + timedelta(minutes=_mins(s["start"])))
            points.add(day + timedelta(minutes=_mins(s["end"])))
    ov = rules.get("override")
    if ov and ov.get("until"):
        points.add(datetime.fromtimestamp(ov["until"]))
    end = now + timedelta(days=days)
    return sorted(p for p in points if now < p <= end)


def next_change(rules: dict, now: datetime, with_override: bool = True) -> datetime | None:
    state = (lambda t: effective(rules, t)) if with_override else (lambda t: scheduled(rules, t)[0])
    current = state(now)
    for p in _boundaries(rules, now):
        if state(p) != current:
            return p
    return None


def off_periods(rules: dict, now: datetime | None = None) -> tuple[list[list[int]], int]:
    """Times watching is off over the next week, so devices can follow the schedule offline."""
    now = now or datetime.now()
    horizon = now + timedelta(days=HORIZON_DAYS)
    points = [now] + [p for p in _boundaries(rules, now) if p < horizon] + [horizon]
    out: list[list[int]] = []
    for a, b in zip(points, points[1:]):
        if not effective(rules, a):
            if out and out[-1][1] == int(a.timestamp()):
                out[-1][1] = int(b.timestamp())
            else:
                out.append([int(a.timestamp()), int(b.timestamp())])
    return out, int(horizon.timestamp())


def status(rules: dict, now: datetime | None = None) -> dict:
    now = now or datetime.now()
    ov = _override(rules, now)
    on = effective(rules, now)
    sched_on, s = scheduled(rules, now)
    nxt = next_change(rules, now)
    sched_nxt = next_change(rules, now, with_override=False)
    if ov and ov.get("device"):
        reason = "Turned off for this device"
    elif ov:
        reason = "Turned on by you" if on else "Turned off by you"
    elif s is not None and (s["kind"] == "off" or on):
        reason = s["name"]
    elif s is not None:
        reason = f"Outside allowed times ({s['name']})"
    else:
        reason = ""
    return {
        "on": on,
        "reason": reason,
        "until": nxt.timestamp() if nxt else None,
        "override": bool(ov),
        "has_schedules": bool(enabled(rules)),
        "scheduled_on": sched_on,
        "scheduled_reason": s["name"] if s else "",
        "scheduled_until": sched_nxt.timestamp() if sched_nxt else None,
        "now": now.timestamp(),
    }


def override_for(rules: dict, on: bool, minutes: int | None = None) -> dict | None:
    """What flipping the Watching switch should store."""
    now = datetime.now()
    if not enabled(rules):
        return None if on else {"watching": False, "until": None}
    if minutes:
        return {"watching": on, "until": (now + timedelta(minutes=minutes)).timestamp()}
    if on == scheduled(rules, now)[0]:
        return None  # that's what the schedule says anyway
    nxt = next_change(rules, now, with_override=False)
    return {"watching": on, "until": nxt.timestamp() if nxt else None}


def clean(d: dict) -> dict:
    """Validate a schedule coming from the dashboard."""
    days = sorted({int(x) for x in d.get("days") or [] if str(x).isdigit() and 0 <= int(x) <= 6})
    start, end = str(d.get("start", "")), str(d.get("end", ""))
    if not days:
        raise ValueError("Pick at least one day")
    if not (TIME.match(start) and TIME.match(end)):
        raise ValueError("Times need to look like 20:00")
    return {
        "id": str(d.get("id") or secrets.token_hex(4))[:16],
        "name": (str(d.get("name") or "").strip() or "Schedule")[:40],
        "kind": "allowed" if d.get("kind") == "allowed" else "off",
        "days": days,
        "start": start,
        "end": end,
        "enabled": bool(d.get("enabled", True)),
        # Which kids' devices it applies to (ids). Empty = every device.
        "devices": [str(x)[:16] for x in (d.get("devices") or [])][:50],
    }
