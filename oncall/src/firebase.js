/**
 * Firebase wiring. With no config the module reports itself disabled and the
 * app runs entirely on localStorage, exactly as it did before — nothing here
 * throws on a missing config, so a build without one is a working demo.
 *
 * The config is the object Firebase shows when you register a web app. It
 * arrives as one JSON blob in VITE_FIREBASE_CONFIG rather than six separate
 * variables: it is copied out of the console in one piece, so splitting it up
 * only creates six chances to paste the wrong value into the wrong box.
 *
 * This is NOT a secret in the security sense. A Firebase web config is
 * published in every client bundle by design and anyone can read it out of the
 * JavaScript. What actually protects the data is firestore.rules plus App
 * Check. Keeping it out of the source tree is tidiness, not security.
 *
 * The SDK is reached through dynamic import rather than a top-level one.
 * Imported statically it lands in the main bundle whether or not it is ever
 * called — about half a megabyte a demo build downloads and never runs.
 */
const RAW = (import.meta.env || {}).VITE_FIREBASE_CONFIG;

const REQUIRED = ["apiKey", "authDomain", "projectId", "appId"];

function parseConfig(raw) {
  if (!raw || typeof raw !== "string" || !raw.trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    /* Loud, because the alternative is a build that looks fine and silently
       serves the demo. */
    console.error("VITE_FIREBASE_CONFIG is not valid JSON — running in local mode.", e);
    return null;
  }
  const missing = REQUIRED.filter((k) => !parsed || !parsed[k]);
  if (missing.length) {
    console.error(`VITE_FIREBASE_CONFIG is missing ${missing.join(", ")} — running in local mode.`);
    return null;
  }
  return parsed;
}

const config = parseConfig(RAW);

export const isCloudEnabled = config != null;

let bundle = null;
let loading = null;

/**
 * Resolves to { app, auth, db, sdk } once, or null when the build has no
 * config. Callers await this instead of reaching for a module-level instance.
 */
export function ensureCloud() {
  if (!config) return Promise.resolve(null);
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
      /* A blocked network or bad project must not take the whole app down. */
      console.warn("Firebase failed to initialize; running in local mode.", e);
      loading = null;
      return null;
    }
  })();

  return loading;
}
