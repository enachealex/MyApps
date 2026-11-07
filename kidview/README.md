# KidView

A YouTube player for kids' Android tablets and phones that parents control, from a dashboard in
any browser or the KidView Parent app. Each family runs the KidView server on a computer in their
own home. Your website only hands out the downloads and announces new versions. It never sees
any family's rules, activity or videos.

```
 Kids' tablets / phones          A computer at each family's home          YouTube
 ┌──────────────────┐  Wi-Fi   ┌──────────────────────────────┐          ┌─────────┐
 │  KidView app     │ ───────▶ │  KidView server              │ ───────▶ │         │
 │                  │ ◀─────── │  applies the rules, streams   │ ◀─────── │         │
 └──────────────────┘          │  video, keeps the library     │          └─────────┘
 ┌──────────────────┐          │  dashboard in the browser     │
 │  KidView Parent  │ ───────▶ │                               │      Your website
 │  (parent phone)  │ ◀─────── └──────────────────────────────┘      ┌──────────────┐
 └──────────────────┘   apps and servers check latest.json ───────▶ │ downloads +  │
                                                                     │ latest.json  │
                                                                     └──────────────┘
```

## What's here

| Folder | What it is |
|---|---|
| `server/` | The server (Python, FastAPI, yt-dlp) and the dashboard (`admin.html`). `kidview_tray.py` is the Windows tray app. |
| `android/` | Both apps (Kotlin, Jetpack Compose): `app` is the kids' app, `parent` is KidView Parent. |
| `windows/` | The Windows installer (`Install KidView.cmd`) and uninstaller. |
| `docker/install.sh` | The Docker installer and updater families run on a home server, NAS or Raspberry Pi. |
| `site/index.html` | The download page and setup guide for families, filled in when you publish. |
| `downloads/` | What families download, published at https://myapps.thejumpvault.com/kidview/ by the MyApps site. Only the release scripts change it. |
| `scripts/` | `release.ps1` and `publish.ps1`, and `site.json` (the downloads address and how to publish). |
| `deploy/` | Notes for your own home server. Private: it's in `.gitignore`. |

## Running it while you work on it

- Server: double-click **Start KidView Server.bat** (Windows), or `python app.py` in `server/`.
  Dashboard at http://localhost:8765/admin.
- Apps: open `android/` in Android Studio, or `gradlew assembleRelease` there.

## Shipping a new version

See [RELEASING.md](RELEASING.md). In short: `.\scripts\release.ps1 1.1.0` builds everything and puts a
draft on your website that nobody is told about. Try it, then `.\scripts\publish.ps1 1.1.0` sends it to
every family, who each choose when to install it.

## What KidView does

- **Watching** on/off, with "allow for 30 minutes / 1 hour / 2 hours / until the schedule ends" during a schedule.
- **Schedules** when watching is off or only allowed, for every device or just some, enforced even offline.
- **Rules**: blocked topics (Roblox, scary games, brainrot memes, pranks), blocked words (tricks like
  "sk1bidi" are caught), **Filtered** (anything not blocked) or **Approved** (only allowed channels and
  Picks), allowed and blocked channels, blocked videos.
- **Per child**: Recommended (funny and educational at first, then what they like) and extra Restrictions.
- **Activity** for 7 days by default (older is deleted), filterable by device, type, date and text.
- **Offline library**: channels and videos downloaded by the server and copied to devices on home Wi-Fi
  (the kids' **Offline** tab).
- **Kids' app**: Home, Saved and Offline tabs. Kids save videos with the heart in the player; Saved also
  has their **History**. Anything blocked since it was saved or watched drops out of both.
- **Parent accounts** with PINs, and a log of who changed what.
- **Setup by QR code**, live refresh when rules change, and update prompts that the parent accepts.
- **On iPhone**, the dashboard installs as an app from Safari (Add to Home Screen), with tabs along the
  bottom like the Android parent app. It's served by each family's own server, so it updates with it.

## Good to know

- KidView reaches YouTube with [yt-dlp](https://github.com/yt-dlp/yt-dlp), which isn't an official YouTube
  API, so it's meant for personal, at-home use. The server updates yt-dlp every time it starts.
- The signing key in `android/signing/` must be backed up and kept private (see RELEASING.md).
