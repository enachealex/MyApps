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
2. **Build → Authentication → Get started → Email/Password → Enable**.
3. **Build → Firestore Database → Create database** (production mode, any region).
4. In Firestore, open the **Rules** tab and paste the contents of [`firestore.rules`](firestore.rules),
   then **Publish**.
5. **Project settings (gear icon) → Your apps → Web app (`</>`)** — register an app and copy the
   `firebaseConfig` object it shows you.
6. Paste that object into [`firebase.config.ts`](firebase.config.ts), replacing `null`.
7. Restart the app. You'll see a sign-in screen — create an account, and you're in cloud mode.

### Sharing a list with a friend

1. Open a list → tap the **person-add icon** (or ⋯ → Share list) → **Create invite code**.
2. Send the 6-character code to your friend however you like.
3. Your friend taps the **person-add icon on the Home screen**, enters the code, and the list
   appears for them. Everyone sees changes live, and tasks can be assigned to any member.

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
