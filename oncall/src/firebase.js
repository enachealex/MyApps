/**
 * Firebase wiring, following the same shape as the My Tasks app in this repo:
 * with no config the module reports itself disabled and the app runs entirely
 * on localStorage, exactly as it did before. Nothing here throws on a missing
 * config, so a build without secrets still produces a working demo.
 *
 * The SDK is loaded through dynamic import rather than a top-level one. Imported
 * statically it lands in the main bundle whether or not it is ever called —
 * about half a megabyte that a demo build downloads and never uses. This way
 * Vite emits it as its own chunk and only a configured build fetches it.
 *
 * The config arrives through Vite env vars, injected at build time from repo
 * secrets. Note this is NOT a secret in the security sense — a Firebase web
 * config is published in every client bundle by design. What actually protects
 * the data is firestore.rules plus App Check. Keeping it in secrets only keeps
 * it out of the source tree.
 */
const env = import.meta.env || {};

const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

/* Every field or none. A half-filled config fails at the first call with a
   worse message than "cloud is off". */
export const isCloudEnabled = Object.values(config).every((v) => typeof v === "string" && v.length > 0);

let bundle = null;
let loading = null;

/**
 * Resolves to { app, auth, db, sdk } once, or null when the build has no
 * config. Callers await this instead of reaching for a module-level instance.
 */
export function ensureCloud() {
  if (!isCloudEnabled) return Promise.resolve(null);
  if (bundle) return Promise.resolve(bundle);
  if (loading) return loading;

  loading = (async () => {
    try {
      const [{ initializeApp, getApp, getApps }, authSdk, { getFirestore }] = await Promise.all([
        import("firebase/app"),
        import("firebase/auth"),
        import("firebase/firestore"),
      ]);
      const app = getApps().length ? getApp() : initializeApp(config);
      bundle = { app, auth: authSdk.getAuth(app), db: getFirestore(app), sdk: authSdk };
      return bundle;
    } catch (e) {
      /* A malformed config or a blocked network must not take the whole app
         down — fall back to the local build and say so once. */
      console.warn("Firebase failed to initialize; running in local mode.", e);
      loading = null;
      return null;
    }
  })();

  return loading;
}
