import type { FirebaseOptions } from 'firebase/app';

/**
 * Cloud sync + sharing between friends is powered by Firebase.
 *
 * Out of the box this is `null`, and the app runs in LOCAL MODE:
 * everything works on one device, but lists cannot be shared.
 *
 * To enable cloud mode, follow the "Firebase setup" section in README.md,
 * then replace `null` below with your Firebase web app config object, e.g.:
 *
 * export const firebaseConfig: FirebaseOptions | null = {
 *   apiKey: '...',
 *   authDomain: 'my-tasks-xxxxx.firebaseapp.com',
 *   projectId: 'my-tasks-xxxxx',
 *   storageBucket: 'my-tasks-xxxxx.firebasestorage.app',
 *   messagingSenderId: '...',
 *   appId: '...',
 * };
 */
export const firebaseConfig: FirebaseOptions | null = null;

/**
 * Optional bot protection (recommended once cloud mode is on): Firebase App
 * Check with reCAPTCHA v3. Follow "Bot protection" in README.md, then paste
 * your reCAPTCHA v3 SITE key here. Invisible to real users; Firebase rejects
 * requests that don't come from your real app.
 */
export const recaptchaV3SiteKey: string | null = null;
