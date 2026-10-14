# Surveil — build plan

A self-hosted camera app: see your cameras live, look back at recordings, and
get a push alert on your phone when something moves. Starts with your
Alarm.com cameras, then grows to take ordinary RTSP/ONVIF cameras through the
same UI.

Runs on one always-on machine at home. The web UI installs as a PWA and is
reachable from anywhere through a Cloudflare Tunnel behind a login.

## What Alarm.com cameras actually let us do

Alarm.com cameras (ADC-V515, V522IR, V622, V722W, V724, V730, VDB doorbells,
etc.) are cloud-managed. They stream to Alarm.com, not to your LAN, and there
is no official public API. What exists, verified from the maintained Home
Assistant integration that does exactly this today:

| Capability | How | Confidence |
| --- | --- | --- |
| List cameras | `GET www.alarm.com/web/api/video/devices/cameras` after a scraped web login | High, used in production by HA users |
| Still snapshot | `GET .../video/devices/cameras/{id}/snapshot` | High |
| Live video | `GET .../video/videoSources/liveVideoHighestResSources/{id}` returns a Janus WebRTC gateway URL + short-lived token + TURN servers. Browser opens a WebSocket to Janus (`janus-protocol`) and negotiates WebRTC | High. Tokens rotate every ~20–30 s; must re-fetch every 30 min |
| Real-time events | Alarm.com pushes a WebSocket feed. Event codes include `VideoEventTriggered` (76), `VideoCameraTriggered` (71, person/package), `VideoAnalytics2Detection` (302, motion) | High for delivery; which codes your cameras emit depends on your video plan |
| Cloud-saved clips | Alarm.com keeps clips it recorded ("Saved Video"). The endpoint isn't in the HA library; must be captured from browser dev tools | Medium. Needs Phase 0 discovery |
| Local RTSP | Older ADC-V520IR/V720W exposed RTSP on port 1026. Current models do not, and the dealer can't enable it | Low. Cheap to test once, don't count on it |
| Local recorder | If you own an Alarm.com SVR (ADC-SVR122), 24/7 footage lives on it but is only viewable through Alarm.com | Not usable by us |

Two consequences:

1. **Login is a scrape** of the ASP.NET login page, with two-factor handled by
   a one-time code the first time and a trusted-device cookie
   (`twoFactorAuthenticationId`) after that. This is unofficial. Alarm.com can
   change it any time, and hammering it can lock the account. We keep one
   session, refresh gently, and store the cookie so 2FA is a one-time event.
2. **Recording is the hard part.** The camera won't give us a file. Options,
   in order of effort:
   - **Use Alarm.com's own clips** (they already record on motion under your
     plan). We index and play them in our UI. Cheapest, Phase 3.
   - **Record from the WebRTC stream on the server.** A Node WebRTC client
     (`werift`) speaks Janus, receives RTP, pipes it into ffmpeg, and writes
     MP4 segments. Gives us real local recording, on-demand or continuous.
     Phase 4.

## Assumptions (confirm)

- Your Alarm.com plan includes video (you can view live and saved clips in the
  Alarm.com app today).
- The host is your OpenEye OE-MEX16 recorder, reinstalled with plain Debian.
  It is an x86 Intel appliance with an SSD for the OS, up to 24 TB of data
  storage, two gigabit NICs and a built-in 16-port PoE switch. Setup is in
  `docs/mex16-host-setup.md`. Fallback if it won't boot: this PC.
- You're OK with the app logging into Alarm.com with your credentials via
  unofficial endpoints, stored only on that machine.

## Architecture

```
Surveil/
  server/                 Node 22+, Fastify, SQLite, ffmpeg (later)
    adapters/
      alarmcom/           login, 2FA, camera list, snapshot, live tokens, event socket, clips
      rtsp/               (later) ffmpeg-based: HLS live, MP4 recording, motion
    core/                 camera registry, events, alerts, retention, API
  web/                    Vite + React + Tailwind + lucide (same stack as oncall)
    players/
      JanusWebRtcPlayer   for Alarm.com cameras
      HlsPlayer           for RTSP cameras (later)
  PLAN.md  README.md
```

**Adapter contract** (every camera source implements this; the UI never
knows which kind it's talking to):

```ts
interface CameraAdapter {
  listCameras(): Camera[]
  getSnapshot(id): Promise<Buffer>
  getLiveSource(id): Promise<{ kind: 'janus', gatewayUrl, token, streamId, iceServers }
                            | { kind: 'hls', url }>
  onEvent(cb: (e: { cameraId, type, at, snapshot? }) => void): void
  listRecordings?(id, from, to): Promise<Recording[]>   // optional
}
```

```
 Alarm.com cloud ◄──login/tokens/events──┐
      │ WebRTC (Janus)                   │
      ▼                                  │
  browser <video>                 Fastify server  ── SQLite (cameras, events, clips, segments)
      ▲                              │   │   └── alerts → ntfy push (snapshot + deep link)
      │ HLS (later, RTSP cams)       │   └── ffmpeg (later: RTSP cams, WebRTC recording)
  web/dist ◄─────────────────────────┘
      ▲
  Cloudflare Tunnel + Access ── phone anywhere
```

**Key choices**

| Concern | Choice | Why |
| --- | --- | --- |
| Alarm.com client | Port the login, camera, and WebSocket bits of `pyalarmdotcomajax` to TypeScript | It's the only working reference; the flows are small (a few hundred lines) |
| Live view (Alarm.com) | Browser talks to Alarm.com's Janus directly; server only hands out tokens | Sub-second latency, no video passes through our server |
| Live view (RTSP, later) | ffmpeg → HLS via hls.js, `-c copy` | Works everywhere incl. iOS, no re-encoding |
| Alerts | ntfy (free app, no account) | Push in ~1 s with snapshot attached. Web Push later |
| Database | SQLite via better-sqlite3 | Single file, zero setup |
| Remote access | Cloudflare Tunnel + Access | No port forwarding, TLS free, login handled by Cloudflare on your domain |
| UI | Vite + React 18 + Tailwind | Same as OnCall; reuse its layout and PWA setup |

## Phases

### Phase 0 — Discovery (one evening, no app code)

- List your cameras: models, and whether you have an SVR.
- Confirm your Alarm.com login works from a browser and note the 2FA method
  (app, SMS, email).
- In the Alarm.com website with browser dev tools open, view live video and
  open Saved Video. Capture the request URLs for: camera list, live source,
  saved clips list, clip download. This gives us the clips endpoint the HA
  library lacks.
- Cheap RTSP test: the camera list returns each camera's private IP. Try
  `rtsp://<ip>:1026/live.sdp` in VLC once. If it works, that camera can go
  straight to the RTSP adapter later.
- Install ffmpeg: `winget install Gyan.FFmpeg`.

Deliverable: `server/docs/alarmcom-endpoints.md` with the captured URLs.

### Phase 1 — Login and live view (1–2 weekends)

- `server/adapters/alarmcom`: login scrape, 2FA prompt-once flow with cookie
  persistence, `afg` cookie → `Ajaxrequestuniquekey` header, session
  keep-alive, camera list, snapshot, live-source token fetch with 30-min
  refresh.
- CLI: `npm run adc:login` walks you through first login + 2FA and stores the
  trusted-device cookie in `server/data/`.
- API: `GET /api/cameras`, `GET /api/cameras/:id/snapshot`,
  `GET /api/cameras/:id/live` (returns fresh Janus config).
- `web/`: camera grid of snapshot thumbnails refreshing every 10 s; tap a
  camera to open the Janus WebRTC player full screen (port the HA card's
  Janus handshake: create session → attach streaming plugin → watch → answer
  SDP → trickle ICE → keepalive). Online/offline/malfunction badges from the
  camera attributes.

Deliverable: open the UI on your phone, see live video from every camera.

### Phase 2 — Events and alerts (1 weekend)

- Connect to Alarm.com's WebSocket event feed; map codes 71/76/210/302 to
  events. Grab a snapshot the moment an event lands and store it.
- SQLite `events` table; `GET /api/events?camera&from&to`.
- Alerts via ntfy with snapshot and deep link into the app. Per-camera
  on/off, quiet hours, 60 s cooldown.
- UI **Events** tab: snapshot cards, tap to open live view (until Phase 3
  gives us clips).

Deliverable: phone buzzes on motion with a picture, before Alarm.com's own
app does or without it.

### Phase 3 — Recordings from Alarm.com clips (1 weekend)

- Implement `listRecordings` against the clips endpoint captured in Phase 0.
  Poll every few minutes, index clips in SQLite, cache downloaded MP4s
  locally so they outlive Alarm.com's retention.
- UI **Recordings** tab: pick camera + day, list clips on a 24 h timeline,
  play in-app, download. Event markers on the same timeline.

Deliverable: watch last night's footage in our app.

### Phase 4 — Local recording from the WebRTC stream (2 weekends, optional)

- Server-side WebRTC client with `werift` performing the same Janus handshake
  the browser does, forwarding RTP into ffmpeg, writing 10-min MP4 segments
  with `-c copy`.
- Modes per camera: off / on-event (start 10 s pre-roll from a rolling
  buffer, stop 30 s after) / continuous.
- Retention sweeper by days or GB. Segments show on the same timeline as
  clips.

Deliverable: real local recording that doesn't depend on Alarm.com storage.
Watch for: Alarm.com may cap concurrent live streams per account.

### Phase 5 — Remote access, login, install (one evening)

- `cloudflared` tunnel → `cams.thejumpvault.com`; Cloudflare Access policy
  for your email; server verifies the `Cf-Access-Jwt-Assertion` header.
- PWA manifest, icons, tile on the MyApps landing page pointing at the
  tunnel hostname (it can't live in `_site` since it needs the server).
- Run as a `systemd` service on the MEX16 so it survives reboots (unit file
  in `docs/mex16-host-setup.md`).

### Phase 6 — The RTSP adapter ("other cameras")

- New cameras plug straight into the MEX16's PoE ports. Its CAMERA NIC runs
  an isolated 10.10.0.x network with DHCP, so cameras are powered, addressed,
  and unreachable from the internet without any extra hardware.
- `server/adapters/rtsp`: ONVIF discovery on that network, ffmpeg per camera
  → HLS live + segmented MP4 recording + scene-change motion, exactly as a
  normal NVR.
- UI already handles it: `HlsPlayer` for `kind: 'hls'`, same grid, same
  timeline, same alerts.
- Because the adapter contract is the same, mixing an Alarm.com doorbell with
  a Reolink in the driveway just works.

### Later

Person/vehicle filtering with YOLOv8n on event snapshots, Web Push from the
PWA, PTZ, two-way audio, Docker Compose for a NAS.

## Data model (SQLite)

```sql
cameras     (id, adapter, external_id, name, enabled, alerts_enabled, quiet_from, quiet_to)
events      (id, camera_id, type, at, snapshot_path, notified_at)
clips       (id, camera_id, external_id, start_ts, end_ts, url, local_path)     -- Phase 3
segments    (id, camera_id, start_ts, end_ts, path, bytes)                     -- Phase 4
settings    (key, value)
```

## Config (server/config.json, git-ignored)

```json
{
  "alarmcom": { "username": "you@example.com", "password": "..." },
  "alerts":   { "ntfy": "https://ntfy.sh/your-secret-topic", "cooldownSec": 60 },
  "storage":  { "root": "D:/surveil", "maxGb": 500 },
  "rtspCameras": []
}
```

## Risks

- **Unofficial API.** Alarm.com can change endpoints or block scripted logins.
  Mitigation: one long-lived session, polite refresh intervals, the HA
  integration as a canary (if it breaks, we'll know what changed). Some
  accounts have been locked by repeated failed logins, so the login CLI fails
  fast and never retries in a loop.
- **2FA.** Handled once via the trusted-device cookie. If Alarm.com invalidates
  it, the server pauses and pings you on ntfy to re-run the login CLI.
- **Concurrent stream limits.** Alarm.com may allow only a few simultaneous
  live streams. Grid shows snapshots; live opens one camera at a time.
- **Clips endpoint unknown.** Phase 0 captures it. If it turns out to be
  unusable, Phase 4 (local WebRTC recording) becomes the recording path.
- **Exposing cameras to the internet.** Nothing is port-forwarded. Only the
  tunnel is reachable, and only after Cloudflare Access login.

## First steps

1. Phase 0 dev-tools capture: `docs/phase0-capture.md`, fill in
   `docs/alarmcom-endpoints.md`.
2. Boot the MEX16 with a monitor, note CPU/RAM/drives, install Debian:
   `docs/mex16-host-setup.md`. This can happen in parallel with everything
   below; Phase 1 develops fine on this PC and moves over in Phase 5.
3. I scaffold `server/` and `web/`, port the Alarm.com login + camera list,
   and get one camera live on your phone.

## Sources

- https://github.com/ibasebcast/ha-alarmdotcom (maintained HA integration:
  WebRTC live + snapshot, vendored `pyalarmdotcomajax`, Janus card)
- https://github.com/pyalarmdotcom/pyalarmdotcomajax
- https://www.ispyconnect.com/camera/alarm.com (crowdsourced RTSP URLs, old
  models only)
- https://answers.alarm.com/Partner/Installation_and_Troubleshooting/Video_Devices/Third-Party_Camera_Integration/Which_third-party_cameras_are_compatible
- https://answers.alarm.com/Partner/Installation_and_Troubleshooting/Video_Devices/Stream_Video_Recorder_(SVR)/Stream_Video_Recorder_(ADC-SVR122)/Stream_Video_Recorder_(ADC-SVR122)_-_Data_Sheet
