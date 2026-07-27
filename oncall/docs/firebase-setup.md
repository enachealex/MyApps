# Turning on real authentication

OnCall ships in **local mode**: no backend, everything in `localStorage`, and
`attempt()` accepts any password. This is the demo. Everything below switches it
to Firebase Auth. Until it is done, **do not put real staff names or numbers on
the public URL**.

The app decides which mode it is in at build time: with all six
`VITE_FIREBASE_*` variables present it uses Firebase, otherwise it stays local.
There is no runtime switch and nothing to toggle.

## What is already built

| Piece | Where | State |
| --- | --- | --- |
| SDK loading | `src/firebase.js` | Done — dynamic import, so a demo build never downloads it |
| Sign in / out, password change, reset | `src/auth.js` | Done — one interface, local and cloud behind it |
| Forced password change screen | `ChangePassword` in `OnCallApp.jsx` | Done |
| Security rules | `firestore.rules` | Written, **not yet deployed or tested** |
| Build-time config | `.github/workflows/pages.yml` | Done — reads repo secrets |
| Account provisioning + credential email | Cloud Function | **Not built** — see below |
| Firestore data layer | would replace `src/storage.js` | **Not built** — still localStorage |

So: sign-in is code-complete, storage is not. With Firebase configured, people
authenticate for real but the schedule still lives in each browser.

## 1. Create the project

1. <https://console.firebase.google.com> → **Add project**.
2. **Build → Authentication → Get started → Email/Password → Enable.**
   Leave "Email link (passwordless sign-in)" off.
3. **Build → Firestore Database → Create database → Production mode.**
4. **Project settings → General → Your apps → Web (`</>`)** and register the
   app. Copy the config values it shows.

## 2. Add the config as repo secrets

**Settings → Secrets and variables → Actions → New repository secret**, one each:

| Secret | From the Firebase config |
| --- | --- |
| `VITE_FIREBASE_API_KEY` | `apiKey` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `authDomain` |
| `VITE_FIREBASE_PROJECT_ID` | `projectId` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `storageBucket` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `VITE_FIREBASE_APP_ID` | `appId` |

A missing or blank one drops the build back to local mode silently, which is the
safe failure but an easy thing to miss — check the sign-in screen after
deploying.

**These are not secrets in the security sense.** A Firebase web config is
published in every client bundle by design; anyone can read it out of the
JavaScript. Keeping it in Actions secrets keeps it out of the source tree and
nothing more. What actually protects the data is the rules in step 3 and App
Check in step 5.

## 3. Deploy the security rules

`firestore.rules` is the entire security model — anything a browser can reach it
can reach directly, without going through the app.

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules --project <your-project-id>
```

The rules read `orgId`, `role` and `mustChangePassword` from custom claims, not
from documents, so a client cannot edit itself into a promotion. Nothing sets
those claims yet — that is step 4.

## 4. Account provisioning (not built)

The remaining piece, and the one that needs a server. A Cloud Function that:

- creates the Firebase Auth user,
- sets `orgId`, `role` and `mustChangePassword: true` as custom claims,
- generates a random temp password,
- emails the username and that password to the person.

Worth raising before it is built: **emailing a password is a weak pattern**, and
Firebase has a better one already. `sendPasswordResetEmail` (wired up in
`auth.js` as `sendReset`) mails a single-use link that expires. The account gets
created, the person gets a link, they choose their own password, and no password
ever travels through a mailbox. The requirement as written asks for a temp
password by email; this is the moment to decide whether to keep that or take the
link instead.

## 5. Before real staff data goes in

- **App Check** (Firebase console → App Check → reCAPTCHA v3) so only the real
  app can talk to Firestore. My Tasks already does this.
- Move the seeded roster in `ORGS` into Firestore and replace `src/storage.js`.
  Until then the schedule is per-browser and the roster is in the bundle.
- Decide who provisions the owner account `admin_aenache`.
