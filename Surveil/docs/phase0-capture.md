# Phase 0 — Capturing Alarm.com's endpoints

Goal: find out exactly which URLs the Alarm.com website uses for cameras, live
video, saved clips, and real-time events, so the server can call the same
ones. Takes 20–30 minutes in a normal browser. No code involved.

Fill in `docs/alarmcom-endpoints.md` as you go (template at the bottom).

## Before you start: what NOT to share

Network requests carry your session. When copying things out of dev tools,
copy the **URL** and the **response body**, never "Copy as cURL", "Copy as
fetch", or a HAR export — those include cookies that log in as you.

In any response you paste, replace the values of these keys with `REDACTED`:
`janusToken`, `cameraAuthToken`, `signallingServerToken`, `proxyUrl`, and
inside `iceServers` the `username` and `credential` fields. Tokens expire in
under a minute, but don't paste live ones anyway.

## Setup (2 min)

1. Open Chrome or Edge. Go to https://www.alarm.com and sign in. Note which
   2FA method it uses (authenticator app, SMS, or email) and whether it
   offered "trust this device".
2. Press **F12** to open dev tools. Click the **Network** tab.
3. Tick **Preserve log** (top of the Network panel) so navigation doesn't wipe
   the list.
4. In the filter box type `web/api` so only API calls show.

## 1. Camera list (2 min)

1. Click **Video** in the left menu.
2. In the Network list find a request whose URL contains
   `video/devices/cameras`. Click it, open the **Response** tab.
3. Record the full URL. For each camera in the response note `id`,
   `name`, the model or `deviceModelId`, and `privateIp` if present.

## 2. Live video (5 min)

1. Still under Video, click a camera to start live view. Watch it for
   30 seconds.
2. In Network look for a request containing `liveVideoHighestResSources`.
   Record the URL. Open Response, copy the JSON, redact as above.
3. In the response, note the `type` values that appear under `included`
   (expect `endToEndWebrtcConnectionInfo` and/or `proxyWebrtcConnectionInfo`)
   and the top-level `janusGatewayUrl`. This tells us whether your cameras
   do direct WebRTC or go through Alarm.com's proxy.
4. Change the Network filter to **WS** (click the WS button in the filter
   bar). You should see a WebSocket connection to the Janus gateway
   (`janus-protocol`). Record its URL host. No need to copy frames.
5. If there's a quality picker (SD/HD), switch it once and see if a new
   `liveVideoHighestResSources` or similar request appears. Record any
   differently named URL.

## 3. Saved clips (5 min)

This is the part no existing library documents, so it matters most.

1. Set the Network filter back to `web/api`. Clear the list (🚫 icon).
2. Click **Saved Video** (sometimes under Video → Saved, or the clock icon).
3. Record every request URL that appears. The list is probably fetched from
   something under `video/`; note the query parameters (dates, camera id,
   page size).
4. Click one clip to play it. Two more requests show up: one that returns
   the clip metadata and one that fetches the actual video (`.mp4`, `.m3u8`,
   or a signed URL on another host). Record both URLs. Note whether the video
   URL has a signature or expiry in it.
5. Use the date filter to pick a different day. Record the changed URL so
   we know how date ranges are expressed.
6. If there's a download button, click it and record that URL too.

## 4. Real-time events (5 min)

1. Change the Network filter to **WS**. Reload the page (Preserve log is on).
2. Find the WebSocket that is *not* Janus. Its URL likely contains
   `auth=` and a token. Record the host and path only, drop the token.
3. Click it and open the **Messages** tab. Walk in front of a camera (or
   have someone do it). Within a few seconds a message should arrive. Copy
   one or two of those frames. Look for a numeric `eventType` or similar; we
   expect 302 (motion), 71 or 76 (camera triggered), 210 (analytics).
4. Also record the first request after login whose URL contains
   `websocket` or `token` under `web/api` — that's how the socket is
   authorised.

## 5. Camera settings (2 min)

1. Open the settings for one camera (gear icon). Note the model, firmware,
   and whether there's any mention of local streaming, ONVIF, or RTSP.
2. Note the camera's IP on your LAN (from step 1, or from your router).

## 6. The cheap RTSP test (2 min)

Install VLC if you don't have it. Media → Open Network Stream, try:

```
rtsp://<camera-ip>:1026/live.sdp
rtsp://<camera-ip>:554/live.sdp
```

Almost certainly fails on current models. If one plays, write down which
camera and URL; that camera can bypass Alarm.com entirely.

## 7. Install ffmpeg

```bash
winget install Gyan.FFmpeg
```

Then close and reopen the terminal and check `ffmpeg -version`.

## About the recorder

You mentioned a recorder running Linux with no image on it. Before we decide
what to do with it I need:

- The model printed on it (ADC-SVR122, ADC-CSVR2008P, or something else) and
  what it does when powered on: any lights, any screen output over HDMI, does
  it get an IP from the router.
- Whether you can get a shell on it (SSH, serial, or a keyboard + HDMI).
- CPU architecture if you can find it (`uname -m` from a shell, or from the
  spec sheet): x86_64 or ARM.
- Drive size.

Two possible outcomes:

- **Repurpose it as the Surveil host.** If it's a normal x86 box that boots
  from USB, we install stock Debian on it and it becomes the always-on
  machine running the server, with its drive holding recordings. That's a
  good use of it and keeps this PC out of the loop.
- **Leave it.** If it's locked-down ARM hardware with no boot access, it
  isn't worth the fight; this PC or a small mini PC hosts instead.

Either way it cannot act as an Alarm.com SVR without Alarm.com's own
firmware and a dealer enrolment, so we're not going down that path.

---

## Template: docs/alarmcom-endpoints.md

Copy this into a new file and fill it in.

```markdown
# Alarm.com endpoints (captured YYYY-MM-DD)

## Account
- 2FA method:
- "Trust this device" offered: yes / no

## Cameras
| id | name | model | private IP | RTSP test |
| --- | --- | --- | --- | --- |
|    |      |       |            | fail / works at rtsp://... |

## Camera list
- URL:

## Live video
- URL:
- included types seen:
- janusGatewayUrl host:
- Response (redacted):
  ```json
  ```

## Saved clips
- List URL (with params):
- Date filter example URL:
- Clip metadata URL:
- Clip video URL (pattern, note any signature/expiry):
- Download URL:
- Sample list response (redacted):
  ```json
  ```

## Events websocket
- Token request URL:
- Socket host/path (token removed):
- Sample motion frame:
  ```json
  ```

## Recorder
- Model:
- Boots / lights / HDMI output:
- Shell access:
- Architecture:
- Drive size:
```
