FROM python:3.13-slim

# ffmpeg joins video + audio for saved (offline) videos.
# Deno lets yt-dlp solve YouTube's player challenges.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=denoland/deno:bin /deno /usr/local/bin/deno

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY *.py admin.html docker-entrypoint.sh ./

ENV KIDVIEW_DATA=/data \
    KIDVIEW_INSTALL=docker \
    KIDVIEW_HOST=0.0.0.0 \
    KIDVIEW_PORT=8765 \
    PYTHONUNBUFFERED=1
EXPOSE 8765
VOLUME /data

HEALTHCHECK --interval=60s --timeout=5s --start-period=30s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/parent/api/status', timeout=4)"

ENTRYPOINT ["sh", "/app/docker-entrypoint.sh"]
