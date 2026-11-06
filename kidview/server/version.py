"""KidView's version, the silent check for a newer published version, and installing it.

Releases live on the KidView website (SITE). `latest.json` there only changes when a new version is
published with scripts/publish.ps1, so families are only told about versions you've chosen to ship.
Checking is silent; installing happens only when a parent presses "Update now".
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import tarfile
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

VERSION = "1.0.0"
SITE = "https://myapps.thejumpvault.com/kidview/"   # set from scripts/site.json by scripts/release.ps1
LATEST = SITE + "latest.json"

# How this copy was installed decides how it updates. Set by the Dockerfile and the Windows tray.
INSTALL = os.environ.get("KIDVIEW_INSTALL", "source")
HOW = {
    "windows": "On the KidView PC, right-click the KidView icon by the clock and choose Install update.",
    "docker": f"On the KidView server, run the install command again: curl -fsSL {SITE}install.sh | sh",
    "source": "Download the new version from the KidView website and replace the server folder (your data folder stays).",
}

_latest: dict = {"checked": 0.0, "release": None}
_lock = threading.Lock()
# The Windows tray registers how it installs updates (download, swap files, restart itself).
windows_installer = None
installing: dict = {"version": None, "error": None}


def configured() -> bool:
    return "YOUR-SITE" not in SITE


def _parse(v: str) -> tuple[int, ...]:
    return tuple(int(x) for x in v.lstrip("v").split(".") if x.isdigit())


def is_newer(latest: str, current: str | None = None) -> bool:
    return _parse(latest) > _parse(current or VERSION)


def fetch_latest(timeout: float = 10) -> dict:
    """The published release manifest (latest.json). Raises if the site can't be reached."""
    req = urllib.request.Request(LATEST, headers={"User-Agent": f"KidView/{VERSION}", "Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.load(res)


def can_update_itself() -> bool:
    return (INSTALL == "windows" and windows_installer is not None) or INSTALL == "docker"


def update() -> dict | None:
    """{"version", "url", "how", "notes", "auto"} if a newer version is published, else None.
    Checks quietly in the background, twice a day."""
    if not configured():
        return None
    with _lock:
        if time.time() - _latest["checked"] > 12 * 3600:
            _latest["checked"] = time.time()
            threading.Thread(target=_check, daemon=True).start()
        rel = _latest["release"]
    if rel and is_newer(rel.get("version", "0")):
        return {"version": rel["version"], "url": SITE, "how": HOW.get(INSTALL, HOW["source"]),
                "notes": rel.get("notes", ""), "auto": can_update_itself()}
    return None


def check_now() -> dict | None:
    """Checks right away (Check for updates). Raises if the website can't be reached."""
    if not configured():
        return None
    rel = fetch_latest()
    with _lock:
        _latest["release"], _latest["checked"] = rel, time.time()
    return update()


def _check() -> None:
    try:
        rel = fetch_latest()
        with _lock:
            _latest["release"] = rel
    except Exception:
        pass  # offline, or nothing published yet: try again later


def download(rel: dict, key: str) -> bytes:
    """Downloads one file of a release (e.g. "windows", "server") and checks it isn't damaged."""
    path = rel[key]
    req = urllib.request.Request(urllib.parse.urljoin(LATEST, path), headers={"User-Agent": f"KidView/{VERSION}"})
    with urllib.request.urlopen(req, timeout=300) as res:
        data = res.read()
    if (want := rel.get("sha256", {}).get(path)) and hashlib.sha256(data).hexdigest() != want:
        raise ValueError("the download was damaged")
    return data


def start_install(log=print) -> str:
    """Starts installing the newest published version in the background. KidView restarts when done."""
    if not can_update_itself():
        raise RuntimeError("This KidView can't update itself. " + HOW.get(INSTALL, HOW["source"]))
    rel = fetch_latest(timeout=15)
    if not is_newer(rel.get("version", "0")):
        raise RuntimeError("KidView is already up to date.")
    installing.update(version=rel["version"], error=None)

    def run():
        try:
            if INSTALL == "windows":
                windows_installer(rel)
            else:
                _install_docker(rel)
        except Exception as e:  # noqa: BLE001 - shown to the parent on the dashboard
            installing.update(version=None, error=str(e))
            log(f"Updating KidView failed: {e}")

    threading.Thread(target=run, name="kidview-update", daemon=True).start()
    return rel["version"]


def _install_docker(rel: dict) -> None:
    """Docker: put the new server in /data/app (it survives restarts) and restart the container.
    docker-entrypoint.sh runs /data/app when it's newer than the image's own copy."""
    data_dir = Path(os.environ.get("KIDVIEW_DATA", "/data"))
    blob = download(rel, "server")
    new = data_dir / "app.new"
    shutil.rmtree(new, ignore_errors=True)
    new.mkdir(parents=True)
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tar:
        tar.extractall(new, filter="data")
    if not (new / "app.py").exists():
        raise ValueError("the download didn't contain KidView")
    shutil.rmtree(data_dir / "app", ignore_errors=True)
    new.rename(data_dir / "app")
    time.sleep(1)   # let the dashboard's "Updating…" reply go out
    os._exit(0)     # restart: unless-stopped brings KidView back on the new version
