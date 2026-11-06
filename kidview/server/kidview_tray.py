"""KidView for Windows: runs the server in the background, with an icon by the clock.

Right-click the icon to open the dashboard, install an update (only when a new version
has been published), or quit. Installed and started by "Install KidView.cmd".

    pythonw kidview_tray.py              normal use (no console window)
    python  kidview_tray.py --headless   just the server, no icon (for testing)
"""
from __future__ import annotations

import io
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
LOCAL = Path(os.environ.get("LOCALAPPDATA") or HERE)
os.environ.setdefault("KIDVIEW_DATA", str(LOCAL / "KidView" / "data"))
os.environ.setdefault("KIDVIEW_INSTALL", "windows")
NO_WINDOW = 0x08000000  # CREATE_NO_WINDOW: helper programs don't flash a console


def _refresh_path() -> None:
    """Deno and ffmpeg may have been installed after Windows started; pick up their PATH entries."""
    try:
        import winreg
        parts = []
        for root, key in ((winreg.HKEY_CURRENT_USER, r"Environment"),
                          (winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment")):
            with winreg.OpenKey(root, key) as k:
                parts.append(os.path.expandvars(winreg.QueryValueEx(k, "Path")[0]))
        os.environ["PATH"] = os.pathsep.join(parts + [os.environ.get("PATH", "")])
    except OSError:
        pass


def update_ytdlp() -> None:
    """YouTube changes often; yt-dlp keeps up. Get the newest one at every start."""
    try:
        subprocess.run([sys.executable.replace("pythonw.exe", "python.exe"), "-m", "pip", "install", "-q",
                        "--disable-pip-version-check", "-U", "yt-dlp[default]"],
                       creationflags=NO_WINDOW, timeout=240, capture_output=True)
    except Exception:
        pass


def icon_image(size: int = 64):
    from PIL import Image, ImageDraw
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=size // 5, fill=(108, 75, 244, 255))
    s = size / 64
    d.polygon([(24 * s, 18 * s), (48 * s, 32 * s), (24 * s, 46 * s)], fill=(255, 255, 255, 255))
    return img


def save_icon(path: str) -> None:
    """Writes kidview.ico for the Start menu shortcut."""
    icon_image(256).save(path, sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])


def start_server():
    sys.path.insert(0, str(HERE))
    os.chdir(HERE)
    import uvicorn
    import app
    import library
    import recommend
    library.start()
    recommend.prewarm()
    server = uvicorn.Server(uvicorn.Config(app.app, host=app.HOST, port=app.PORT, log_level="warning"))
    threading.Thread(target=server.run, name="kidview-server", daemon=True).start()
    return app


def install_update(rel: dict, notify) -> None:
    """Installs a published Windows release (see version.start_install) and restarts KidView on it.
    Raises if something goes wrong; the dashboard shows the error and nothing is changed."""
    import version
    notify(f"Updating KidView to {rel['version']}…")
    data = version.download(rel, "windows")
    with tempfile.TemporaryDirectory() as tmp, zipfile.ZipFile(io.BytesIO(data)) as z:
        z.extractall(tmp)
        src = Path(tmp) / "server"
        if not (src / "app.py").exists():
            raise ValueError("the download didn't contain KidView")
        for f in src.iterdir():
            if f.is_file():
                shutil.copy2(f, HERE / f.name)
    python = sys.executable.replace("pythonw.exe", "python.exe")
    subprocess.run([python, "-m", "pip", "install", "-q", "--disable-pip-version-check", "-r", str(HERE / "requirements.txt")],
                   creationflags=NO_WINDOW, timeout=600, capture_output=True)
    args = [sys.executable, str(HERE / "kidview_tray.py"), "--updated"] + (["--headless"] if "--headless" in sys.argv else [])
    subprocess.Popen(args, creationflags=NO_WINDOW)
    time.sleep(1)   # let the dashboard's "Updating…" reply go out
    os._exit(0)


def main() -> None:
    headless = "--headless" in sys.argv
    _refresh_path()
    first_run = not (Path(os.environ["KIDVIEW_DATA"]) / "settings.json").exists()
    update_ytdlp()
    app = start_server()
    dashboard = f"http://localhost:{app.PORT}/admin"

    import version
    notify = {"fn": print}   # becomes a Windows notification once the tray icon is up
    # "Update now" on the dashboard and in the parent app installs through this.
    version.windows_installer = lambda rel: install_update(rel, lambda m: notify["fn"](m))

    if headless:
        print(f"KidView running at {dashboard}")
        while True:
            time.sleep(3600)

    import pystray

    def open_dashboard(*_):
        webbrowser.open(dashboard)

    def update_label(_item):
        up = version.update()
        return f"Install update ({up['version']})" if up else "No updates right now"

    def do_update(*_):
        try:
            version.start_install(log=lambda m: icon.notify(m, "KidView"))
        except Exception as e:  # noqa: BLE001 - offline, or already up to date
            icon.notify(str(e), "KidView")

    def quit_app(*_):
        icon.stop()
        os._exit(0)

    icon = pystray.Icon("KidView", icon_image(), "KidView is running", menu=pystray.Menu(
        pystray.MenuItem("Open KidView dashboard", open_dashboard, default=True),
        pystray.MenuItem(update_label, do_update, enabled=lambda _i: bool(version.update())),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Quit KidView", quit_app),
    ))

    def on_ready(ic):
        ic.visible = True
        notify["fn"] = lambda m: ic.notify(m, "KidView")
        if first_run:
            time.sleep(2)
            ic.notify("KidView is running. Set it up in the dashboard that just opened.", "KidView")
            open_dashboard()
        elif "--updated" in sys.argv:
            ic.notify(f"KidView was updated to {version.VERSION}.", "KidView")
        # Mention a newly published version once a day; installing is up to the parent.
        while True:
            time.sleep(60)
            if up := version.update():
                ic.notify(f"KidView {up['version']} is available. Install it from the dashboard, or right-click the KidView icon.", "KidView")
                time.sleep(24 * 3600)

    icon.run(setup=on_ready)


if __name__ == "__main__":
    main()
