# My Tasks — agent notes

A Microsoft To Do–style checklist app (React Native + Expo SDK 57, TypeScript, strict mode).
See README.md for features and user-facing setup.

- Expo SDK 57 / RN 0.86 / React 19 — check https://docs.expo.dev/versions/v57.0.0/ before
  using Expo APIs from memory; things change between SDK versions. Notably `@expo/vector-icons`
  is a separate install (already in package.json), and prefer `boxShadow` over `shadow*` styles.
- Two data backends behind one `DataService` interface (`src/data/service.ts`):
  `localService` (AsyncStorage, default) and `firebaseService` (Firestore realtime + sharing).
  `src/data/api.ts` picks one based on whether `firebase.config.ts` exports a config (null = local).
  Repeat-on-complete logic lives in `api.ts` (`toggleTaskCompleted`), not in the services.
- State: single Zustand store (`src/data/store.ts`); services push into it with `setState`.
  Screens never talk to Firestore/AsyncStorage directly — always go through `api`.
- Responsive layout: `App.tsx` switches on `useWindowDimensions().width >= 768`.
  Wide → `src/screens/DesktopLayout.tsx` (MS To Do style: Sidebar | ListPane | TaskDetailPane,
  selection is plain state, no navigator). Narrow → React Navigation native-stack where the
  screens in `src/screens/` are thin SafeArea wrappers around the same three pane components
  (`src/components/Sidebar.tsx`, `ListPane.tsx`, `TaskDetailPane.tsx`). Put UI changes in the
  pane components, not the screens. Back/dismiss buttons live in the BOTTOM bar (back sits left
  of "Add a task"; detail dismiss is bottom-left of its footer) — a deliberate UX choice.
  Sheets/pickers are RN `Modal`s (`src/components/Sheet.tsx`), not navigation routes.
- Theming: NO module-level `StyleSheet.create` with colors. Every themed component defines
  `const createStyles = (colors: ThemeColors) => StyleSheet.create({...})` at module level and
  calls `const { colors, styles } = useThemedStyles(createStyles)` inside the component
  (`src/theme.ts`; results are cached per theme). Palettes: `lightColors` / `darkColors`.
  User preference (system/light/dark) is picked in the AccountSheet (tap the profile), stored
  via `setThemePref` under AsyncStorage key `my-tasks/theme-pref`. Smart-list accents have
  per-theme variants — use `smartColor(meta, colors.dark)` from `src/constants.ts`, never
  `meta.color` directly. List colors (`listColors`) are stored in data and theme-independent.
- Backgrounds: bundled gradient JPGs in `assets/backgrounds/`, registered in
  `src/backgrounds.ts`. A LIST's background is data (`TaskList.background`, syncs);
  a SMART list's background is a device pref (`smartBackgrounds` in `src/theme.ts`).
  Picker is `BackgroundSheet` (palette icon on smart lists, list menu otherwise). When a
  background is active, ListPane overlays a theme-aware scrim and switches header/section
  text to the `textOnPhoto`/`dimTextOnPhoto` styles.
- Completion feedback lives in `src/feedback.ts` (haptics native, vibrate on Android web),
  called from `toggleTaskCompleted`; the checkbox pop/fade animation is in TaskItem. Sound
  files are not wired yet — the hook point is documented in feedback.ts.
- Sections & ordering: `TaskList.sections` (id/name/order) group tasks via `Task.sectionId`
  (dangling ids render as unsectioned — deleting a section never touches tasks). Manual sort
  uses `Task.order` ascending with `effectiveOrder()` falling back to `-createdAt`; drags
  write fractional midpoints. DnD lives in ListPane (PanResponder on the row drag handle,
  rows measured with measureInWindow at drag start). The Kanban board (`KanbanBoard.tsx`,
  toggled per list per device via `listViewModes` in theme.ts) renders sections as columns
  over the same data.
- Blockers & lockstep: `Task.blockedBy` (same-list prerequisite; UI guards completion and
  shows a lock) and `Task.stepsInOrder` (steps must be completed top-to-bottom). Both are
  enforced in UI handlers, not in the data layer.
- Repeat rules are encoded strings (see `Repeat` in types.ts): five basics plus `after:N`
  (from completion day) and `monthweekday:W:D`. Always use `repeatLabel()`/`nextOccurrence()`
  from utils/dates.ts; never switch on the raw string elsewhere.
- Dates are local-timezone `YYYY-MM-DD` strings (`src/utils/dates.ts`); "My Day" membership is
  `myDayDate === todayStr()` so it naturally resets each day.
- Web quirks handled already: `Alert.alert` doesn't work on web (use `src/utils/ui.ts` helpers),
  the date picker has a `.web.tsx` variant, and TextInputs that submit need `blurOnSubmit={false}`
  alongside `submitBehavior="submit"` because react-native-web ignores the latter.
- PWA: `public/` (manifest.webmanifest, sw.js, icons) is copied verbatim into `dist/` by
  `npm run build:web` (`expo export -p web`). `src/pwa.ts` injects the manifest link + install
  meta tags at runtime and registers the service worker in production builds only (never in
  dev — it would cache stale Metro bundles). Bump `CACHE` in `public/sw.js` when changing
  caching behavior. The AccountSheet shows an "Install app" button via `beforeinstallprompt`.
- Hosting: deployed at https://myapps.thejumpvault.com/my-tasks/ by the repo's
  `.github/workflows/pages.yml` on every push to main. The subpath is why
  `experiments.baseUrl` is "/my-tasks" in app.json and why every manifest/service-worker/meta
  URL is RELATIVE — never reintroduce absolute `/...` paths there. The landing-page tile list
  is the `APPS` array in the repo's top-level index.html.
- Verify with `npx tsc --noEmit` and `npm run web` (Metro on :8081). To test the PWA:
  `npm run build:web`, serve `dist/` statically, reload twice, then kill the server —
  the app must still load from the service worker cache.
