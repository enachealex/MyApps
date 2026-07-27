/**
 * One identity interface, two implementations behind it.
 *
 * `local` is the demo the app has always been: it resolves a username or email
 * against the seeded roster and accepts any password. It is honest about that
 * — `isRealAuth()` is false.
 *
 * `cloud` is Firebase Auth. Sign-in takes an email and a real password, first
 * sign-in with a provisioned password forces a change, and resets go out as
 * Firebase's own email rather than us mailing a password around.
 *
 * Everything above this module calls `signIn`, `signOutNow`, `changePassword`
 * and `sendReset`, and does not know which is underneath. The Firebase SDK is
 * reached through ensureCloud() so it stays out of a demo build's bundle.
 */
import { isCloudEnabled, ensureCloud } from "./firebase";

export const isRealAuth = () => isCloudEnabled;

/* Firebase speaks in error codes; staff need a sentence. */
const MESSAGES = {
  "auth/invalid-email": "That doesn't look like an email address.",
  "auth/user-disabled": "That account is inactive. Contact your scheduler.",
  "auth/user-not-found": "No account with that email. Your scheduler sets it up.",
  "auth/wrong-password": "That password isn't right.",
  "auth/invalid-credential": "That email and password don't match.",
  "auth/too-many-requests": "Too many attempts. Wait a minute and try again.",
  "auth/weak-password": "Use at least 8 characters.",
  "auth/requires-recent-login": "Sign in again before changing your password.",
  "auth/network-request-failed": "Can't reach the server. Check your connection.",
};

const readable = (e) => MESSAGES[e && e.code] || "Something went wrong. Try again.";

function localSignIn(entered, password, org) {
  const found = org.people.find(
    (p) => (p.username || "").toLowerCase() === entered || (p.email || "").toLowerCase() === entered
  );
  if (!found) return { ok: false, error: `No account for that email or username at ${org.name}. Your scheduler sets it up.` };
  if (found.active === false) return { ok: false, error: "That account is inactive. Contact your scheduler." };
  if (!password) return { ok: false, error: "Enter your password." };
  return { ok: true, uid: found.id, mustChangePassword: false };
}

/**
 * @returns {{ok: true, uid: string, mustChangePassword: boolean} | {ok: false, error: string}}
 */
export async function signIn(identifier, password, org) {
  const entered = String(identifier || "").trim().toLowerCase();
  if (!entered) return { ok: false, error: "Enter your email or username." };

  const cloud = await ensureCloud();
  if (!cloud) return localSignIn(entered, password, org);

  /* Firebase authenticates on email only, so a username has to be resolved
     against the roster first. */
  const email = entered.includes("@")
    ? entered
    : (org.people.find((p) => (p.username || "").toLowerCase() === entered) || {}).email;
  if (!email) return { ok: false, error: `No account for that username at ${org.name}.` };
  if (!password) return { ok: false, error: "Enter your password." };

  try {
    const cred = await cloud.sdk.signInWithEmailAndPassword(cloud.auth, email, password);
    /* The claim is set server-side when an account is provisioned with a temp
       password, and cleared once the person picks their own. */
    const token = await cred.user.getIdTokenResult();
    return { ok: true, uid: cred.user.uid, mustChangePassword: !!token.claims.mustChangePassword };
  } catch (e) {
    return { ok: false, error: readable(e) };
  }
}

export async function signOutNow() {
  const cloud = await ensureCloud();
  if (!cloud) return { ok: true };
  try {
    await cloud.sdk.signOut(cloud.auth);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: readable(e) };
  }
}

/* Firebase requires a recent login before a password change, so the current
   password is taken and used to reauthenticate rather than trusting the
   session age. */
export async function changePassword(currentPassword, nextPassword) {
  if (String(nextPassword || "").length < 8) {
    return { ok: false, error: "Use at least 8 characters." };
  }
  const cloud = await ensureCloud();
  if (!cloud) {
    return { ok: false, error: "Password changes need the live build. This demo has no password to change." };
  }
  const u = cloud.auth.currentUser;
  if (!u) return { ok: false, error: "Sign in again before changing your password." };
  try {
    const credential = cloud.sdk.EmailAuthProvider.credential(u.email, currentPassword);
    await cloud.sdk.reauthenticateWithCredential(u, credential);
    await cloud.sdk.updatePassword(u, nextPassword);
    /* Force a token refresh so the mustChangePassword claim, cleared by the
       provisioning function, stops gating the app. */
    await u.getIdToken(true);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: readable(e) };
  }
}

export async function sendReset(email) {
  const cloud = await ensureCloud();
  if (!cloud) return { ok: false, error: "Password resets need the live build." };
  try {
    await cloud.sdk.sendPasswordResetEmail(cloud.auth, String(email || "").trim().toLowerCase());
    return { ok: true };
  } catch (e) {
    return { ok: false, error: readable(e) };
  }
}
