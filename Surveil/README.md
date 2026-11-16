# Surveil

Self-hosted camera app: live view, events with snapshots, phone alerts, and
(soon) recordings. Starts with Alarm.com cameras; RTSP/ONVIF cameras and
Z-Wave devices come later. See [PLAN.md](PLAN.md) for the roadmap.

```
server/   Node 22+ (TypeScript, Fastify, node:sqlite). Talks to cameras, stores events, sends alerts, serves the UI.
web/      Vite + React + Tailwind. The UI, installable as a PWA.
docs/     Phase 0 capture guide, MEX16 host setup, Z-Wave notes.
```

## Run it locally

Two terminals:

```bash
cd server
npm install
npm run dev          # http://localhost:8080, API under /api
```

```bash
cd web
npm install
npm run dev          # http://localhost:5173, proxies /api to :8080
```

With no `server/config.json` the server starts with three demo cameras that
produce a fake motion event every 45 seconds, so the whole UI works before
any real camera is connected.

## Connect Alarm.com

1. `cp server/config.example.json server/config.json` and fill in
   `adapters.alarmcom` (username, password, `enabled: true`). The file is
   git-ignored. Set `adapters.demo.enabled` to false once real cameras show up.
2. From `server/`, run the one-time login. It asks for your two-factor code
   and registers this machine as a trusted device, then lists your cameras:

   ```bash
   npm run adc:login
   ```

   The session and trusted-device cookie are stored in
   `server/data/alarmcom-session.json` (git-ignored).
3. Start the server. Cameras appear in the grid; tap one for live WebRTC video.

Alarm.com has no public API. This uses the same unofficial endpoints as the
Home Assistant integration, so it can break when Alarm.com changes its site.
The server keeps one session alive and never retries a failed login in a
loop, to avoid locking the account.

## Alerts

Install the free **ntfy** app on your phone, subscribe to a long random topic
name, and put its URL in `alerts.ntfy` (for example
`https://ntfy.sh/surveil-7f3k9q2x`). Events then arrive as push notifications
with the snapshot attached. Per-camera alerts and quiet hours are on the
Status tab and in `PATCH /api/cameras/:id`.

## Production

```bash
cd web && npm run build          # the server serves web/dist automatically
cd ../server && npm run build && npm start
```

Set `PUBLIC_URL` to the address you open the app at, so notification taps
deep-link correctly. Service setup for the host is in
[docs/mex16-host-setup.md](docs/mex16-host-setup.md).

## API

| Method | Path | |
| --- | --- | --- |
| GET | `/api/cameras` | Cameras from every adapter, with alert prefs |
| PATCH | `/api/cameras/:id` | `{ alertsEnabled, quietFrom, quietTo }` |
| GET | `/api/cameras/:id/snapshot` | Current still image |
| GET | `/api/cameras/:id/live` | Live source: Janus or signalling WebRTC config, HLS URL, or none |
| GET | `/api/events` | `?camera=&from=&to=&limit=` |
| GET | `/api/events/:id/snapshot` | Snapshot saved with the event |
| GET | `/api/events/stream` | Server-sent events for new camera events |
| GET | `/api/status` | Uptime and per-adapter health |

## Status

Phase 1 scaffold. Working and tested with the demo adapter: camera grid,
snapshot refresh, live view, events list with live updates, event snapshots,
ntfy alerts, status page. The Alarm.com adapter and WebRTC player are written
against the Home Assistant integration's flows but have not yet run against a
real account; the first `npm run adc:login` is the test.
