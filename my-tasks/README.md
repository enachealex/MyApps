# My Tasks

A checklist / to-do app for you and your friends, built with React Native (Expo). It's modeled
closely on **Microsoft To Do**: smart lists (My Day, Important, Planned, Assigned to me), custom
color-themed lists, steps, due dates, repeating tasks, notes — plus shared lists so friends can
work on the same checklist together in real time.

## Features

- **My Day** — hand-pick what you want to focus on today; it resets every day.
- **Important** — star any task to pin it here.
- **Planned** — every task with a due date, grouped by Overdue / Today / Tomorrow / Later.
- **Assigned to me** — tasks friends assigned to you in shared lists (cloud mode).
- **Tasks** — the built-in default list, just like Microsoft To Do.
- **Custom lists** with 8 theme colors; rename, recolor, delete.
- **Tasks** with steps (subtasks), due date, repeat (daily/weekdays/weekly/monthly/yearly),
  notes, star, and a collapsible Completed section. Completing a repeating task automatically
  creates the next occurrence.
- **Sharing between friends** — share a list to get a 6-character invite code; a friend enters
  it on their Home screen and the list syncs live between everyone via Firestore. Tasks can be
  assigned to any member.
- **Friends** (cloud mode) — send a friend request by email (the address is hashed for lookup,
  never stored), accept/decline requests, and invite friends straight into a list without codes.
- **List chat** (cloud mode) — every shared list has a live group chat for its members.
- **Sign in with email or Google** (cloud mode) — the Google button gives the familiar
  account-chooser experience on the web app.

## Privacy & account security

- **Passwords are never stored by this app** — Firebase Authentication receives them over TLS
  and keeps only a salted hash (scrypt). Neither the app nor its database ever sees a stored
  password.
- **The database stores no email addresses.** Accounts are identified by an opaque ID; the only
  email-derived data stored is a one-way SHA-256 hash used so friends can find each other by
  typing an email. The sign-in provider (Firebase Auth) necessarily knows your email — it *is*
  the login credential — but it is never exposed to other users or copied into the database.
- **Bot protection** — Firebase App Check with invisible reCAPTCHA v3 (setup below): Firestore
  rejects requests that don't come from the real app, with no puzzle for real users.

## Two modes

| | Local mode (default) | Cloud mode |
|---|---|---|
| Setup needed | none | Firebase project (~5 min, free) |
| Storage | on-device (AsyncStorage) | Firestore, realtime sync |
| Accounts | none | email + password |
| Sharing between friends | ✗ | ✓ |

The app runs in **local mode** out of the box. To unlock sharing, do the Firebase setup below.

## Running the app (development)

```bash
npm install
npm start          # scan the QR code with the Expo Go app (Android/iOS)
npm run web        # or run it in the browser
```

## Installing it like a real app (PWA)

My Tasks ships as an installable Progressive Web App: users add it to their phone's home
screen / app list (no app store needed), and desktop Chrome/Edge can install it too. Once
installed it opens in its own window, works offline, and syncs when back online.

1. Build the production web app:

   ```bash
   npm run build:web
   ```

2. Deploy the `dist/` folder to any **HTTPS** host (required for install + offline).
   Firebase Hosting is the natural choice since you already need Firebase for sharing:

   ```bash
   npm install -g firebase-tools
   firebase login
   firebase init hosting   # public directory: dist, single-page app: Yes
   firebase deploy --only hosting
   ```

3. Install it from the deployed URL:
   - **Android (Chrome):** open your profile in the app → "Install app on this device",
     or Chrome menu → *Add to Home screen*.
   - **iPhone/iPad (Safari):** Share button → *Add to Home Screen*.
   - **Desktop (Chrome/Edge):** the install icon in the address bar, or the in-app
     "Install app on this device" button in the profile sheet.

### Offline behavior

- The app shell is cached by a service worker after the first visit, so the installed
  app opens with no connection.
- **Local mode:** everything already lives on the device — fully offline.
- **Cloud mode (web/PWA):** Firestore's persistent cache keeps your lists readable and
  editable offline; changes upload and shared lists re-sync when the connection returns.

## Firebase setup (enables sharing)

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and **Add project**
   (any name, Analytics optional).
2. **Build → Authentication → Get started → Email/Password → Enable**. While you're there,
   also enable the **Google** provider (Sign-in method → Add new provider → Google) to light up
   the "Continue with Google" button.
3. Under **Authentication → Settings → Authorized domains**, add `myapps.thejumpvault.com`
   so sign-in works on the hosted app.
4. **Build → Firestore Database → Create database** (production mode, any region).
5. In Firestore, open the **Rules** tab and paste the contents of [`firestore.rules`](firestore.rules),
   then **Publish**.
6. **Project settings (gear icon) → Your apps → Web app (`</>`)** — register an app and copy the
   `firebaseConfig` object it shows you.
7. Paste that object into [`firebase.config.ts`](firebase.config.ts), replacing `null`.
8. Restart the app. You'll see a sign-in screen — create an account, and you're in cloud mode.

### Bot protection (recommended)

Stops bots and scripts from hammering sign-up or the database, with no captcha puzzle for
real users:

1. Create a **reCAPTCHA v3** key for your domain at
   [google.com/recaptcha/admin](https://www.google.com/recaptcha/admin) (v3, domains:
   `myapps.thejumpvault.com` and `localhost`).
2. In the Firebase console: **App Check → Apps → your web app → Register** with the reCAPTCHA
   v3 **secret** key.
3. Put the **site** key into `recaptchaV3SiteKey` in [`firebase.config.ts`](firebase.config.ts).
4. Back in App Check, set **Firestore** (and Authentication, if shown) to **Enforced** once
   you've confirmed the app still works.

A note on captchas: a captcha widget alone, verified only in the browser, does not stop bots —
they simply skip the page and call the backend directly. App Check closes that hole because
Firebase's servers reject any request without a valid token.

### Sharing a list with a friend

1. Open a list → tap the **person-add icon** (or ⋯ → Share list) → **Create invite code**.
2. Send the 6-character code to your friend however you like.
3. Your friend taps the **person-add icon on the Home screen**, enters the code, and the list
   appears for them. Everyone sees changes live, and tasks can be assigned to any member.

Or skip the codes entirely: tap the **people icon** on the Home screen to add friends by
email; once accepted, the Share sheet offers one-tap **Invite** for each friend, and every
shared list gets a **chat** (chat-bubbles icon at the top of the list).

## Project structure

```
App.tsx                     entry: init, splash, auth gate, navigation
firebase.config.ts          your Firebase config (null = local mode)
firestore.rules             Firestore security rules to deploy
src/
  types.ts                  Task / TaskList / UserProfile models
  theme.ts, constants.ts    colors + smart list metadata
  data/
    store.ts                Zustand store + selectors
    service.ts              DataService interface shared by both backends
    localService.ts         AsyncStorage backend (local mode)
    firebase.ts             Firebase init (only if configured)
    firebaseService.ts      Firestore backend: realtime subscriptions, sharing
    api.ts                  picks the active backend; repeat-on-complete logic
  screens/                  Home, List (smart + custom), TaskDetail, Auth
  components/               TaskItem, sheets/modals, checkbox, avatar, …
```

## Ideas for next steps

- Reminders via `expo-notifications` (local scheduled notifications).
- Search across tasks.
- Drag-to-reorder tasks and lists.
- "Flagged email" style integrations, attachments, and My Day suggestions.
