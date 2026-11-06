#!/bin/sh
# Starts KidView in Docker.
#
# Updates installed from the dashboard ("Update now") are saved in /data/app so they survive restarts.
# They're used while they're newer than the copy built into the image; rebuilding the image with a
# newer version (the install command) takes over again.
APP=/app
if [ -f /data/app/app.py ] && python - <<'EOF'
import re, sys
def version(path):
    m = re.search(r'^VERSION = "([^"]+)"', open(path, encoding="utf-8").read(), re.M)
    return tuple(int(x) for x in m.group(1).split(".")) if m else (0,)
sys.exit(0 if version("/data/app/version.py") > version("/app/version.py") else 1)
EOF
then
    APP=/data/app
    pip install --no-cache-dir --quiet --disable-pip-version-check --root-user-action=ignore -r /data/app/requirements.txt \
        || echo "Couldn't install the update's Python packages; trying anyway."
fi

# YouTube changes often and yt-dlp keeps up, so get the newest yt-dlp every time KidView starts.
pip install --no-cache-dir --quiet --disable-pip-version-check --root-user-action=ignore -U "yt-dlp[default]" \
    || echo "Couldn't update yt-dlp right now; using the installed version."

cd "$APP"
exec python -u -X utf8 app.py
