# OnCall Schedule

Mobile on-call schedule for surgical services: who is on call tonight with
tap-to-call numbers, on-call check-in, and shift hand-offs (offer up, trade,
pick up) that route through co-worker confirmation and management approval.
Multi-organization — each tenant has its own roster, roles, call template,
branding, and data.

Live: https://enachealex.github.io/MyApps/oncall/

## Run locally

```bash
cd oncall
npm install
npm run dev -- --host      # --host lets you open it from your phone
```

Vite prints a Network URL like `http://192.168.1.20:5173`. Open that on a
phone connected to the same Wi-Fi to test tap-to-call, which does not work in
a desktop browser or inside an embedded preview.

## Deploy

Pushing to `main` with changes under `oncall/` triggers
`.github/workflows/deploy-oncall.yml`, which builds and publishes to the
`gh-pages` branch under `/oncall`.

One-time setup: **Settings → Pages → Source: Deploy from a branch →
`gh-pages` / root**. The first workflow run creates that branch.

## Sign in

Pick an organization, then sign in with a username. Any password works in this
build. Demo accounts are listed on the sign-in screen; at Saint Aurelia:

| Username | Role |
| --- | --- |
| `dpark` | Admin — approvals, schedule, people |
| `grios` | House supervisor — roster and phone list |
| `mboyd` | Staff — my shifts, trades, check-in |

## Layout

```
src/
  OnCallApp.jsx   entire app: tenants, auth, views, state machine
  storage.js      window.storage shim backed by localStorage
  main.jsx        entry
  index.css       Tailwind + base styles
```

## Wiring up a real backend

Everything is currently seeded in the browser. Two seams to replace:

- **Persistence.** `src/storage.js` is the only place that touches storage.
  Swap the four functions for API calls. The app writes one session key and
  one key per org (`oncall_db_<orgId>_v2`) holding `{ people, shifts, requests }`.
- **Identity.** `SignIn` in `OnCallApp.jsx` resolves a username against the
  org roster and accepts any password. Replace `attempt()` with a real auth
  call; permissions already come from each person's `kind`
  (`staff` / `supervisor` / `manager`).

Add an organization by appending one entry to the `ORGS` array — name, code,
domain, brand colors, roles, call template, departments, roster.


## Native apps (Android APK / iOS)

The web build is wrapped with [Capacitor](https://capacitorjs.com), so the same
`src/` runs inside a native shell. `npm run build:app` sets `CAP_BUILD=1`, which
switches Vite to relative asset paths — native builds load from the device
filesystem, not a URL.

### Android

No local setup needed: **Actions → Build Android APK** produces
`oncall-debug-apk` as a downloadable artifact on every push. Sideload it by
allowing "install unknown apps" for your browser or file manager.

Locally, with Android Studio installed:

```bash
cd oncall
npm run android        # builds, syncs, opens Android Studio
```

For Play Store distribution you need a signed release build (`./gradlew
bundleRelease`), a keystore, and a $25 one-time Google Play developer account.

### iOS

Requires a Mac with Xcode. There is no way around this — Apple does not permit
iOS builds on other platforms.

```bash
cd oncall
sudo gem install cocoapods   # once
npm run ios                  # builds, syncs, opens Xcode
```

In Xcode: select your team under Signing & Capabilities, pick a device, Run.

| Distribution | Cost | Notes |
| --- | --- | --- |
| Free Apple ID | free | Your own device only, app expires after 7 days |
| TestFlight | $99/yr | Up to 10,000 testers by email, builds expire after 90 days |
| App Store | $99/yr | Public listing, App Review, needs a demo account for reviewers |
| Custom app via Apple Business Manager | $99/yr | Private distribution to your organization |
| Hospital MDM (Intune, Workspace ONE) | — | Push to managed devices; ask IT if this exists |

TestFlight is usually the right answer for staff testing. For a hospital-wide
rollout, talk to IT about MDM before paying for anything.

### Before you ship a native build

- Icons and splash screens: `npx @capacitor/assets generate` from a 1024×1024
  source image, otherwise you ship the Capacitor default.
- `tel:` links: confirm they still open the dialer inside the native WebView on
  a real device.
- Storage: `src/storage.js` uses localStorage, which a WebView can evict under
  storage pressure. Swap it for `@capacitor/preferences` or a real backend
  before anyone relies on it.

## Notes

- Phone numbers on Today and Schedule are `tel:` buttons. Embedded frames
  block that scheme, so when the app detects it is framed it copies the
  number and says so instead of failing silently.
- Staff and phone numbers are placeholder data. Replace before any demo with
  real names.
