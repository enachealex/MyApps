import AsyncStorage from '@react-native-async-storage/async-storage';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { Auth, getAuth } from 'firebase/auth';
import * as firebaseAuth from 'firebase/auth';
import {
  Firestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { Platform } from 'react-native';
import { firebaseConfig, recaptchaV3SiteKey } from '../../firebase.config';

export const isCloudEnabled = firebaseConfig != null;

let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

if (firebaseConfig) {
  const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

  // Bot protection: with App Check enforced in the Firebase console, Firestore
  // and Auth reject traffic that can't prove it comes from the real app.
  // reCAPTCHA v3 is invisible — no puzzle for legitimate users.
  if (Platform.OS === 'web' && recaptchaV3SiteKey) {
    try {
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(recaptchaV3SiteKey),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (e) {
      console.warn('App Check initialization failed', e);
    }
  }

  if (Platform.OS === 'web') {
    authInstance = getAuth(app);
  } else {
    // On native, auth state must be persisted explicitly via AsyncStorage.
    // getReactNativePersistence only exists in the react-native build of
    // firebase/auth, so reach for it dynamically.
    const rnAuth = firebaseAuth as unknown as {
      initializeAuth?: (app: FirebaseApp, deps: object) => Auth;
      getReactNativePersistence?: (storage: unknown) => unknown;
    };
    try {
      if (rnAuth.initializeAuth && rnAuth.getReactNativePersistence) {
        authInstance = rnAuth.initializeAuth(app, {
          persistence: rnAuth.getReactNativePersistence(AsyncStorage),
        });
      } else {
        authInstance = getAuth(app);
      }
    } catch {
      authInstance = getAuth(app);
    }
  }
  if (Platform.OS === 'web') {
    // Persistent cache (IndexedDB) keeps cloud data readable/editable offline
    // in the installed PWA; changes sync when the connection returns.
    dbInstance = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } else {
    dbInstance = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
  }
}

export function auth(): Auth {
  if (!authInstance) throw new Error('Firebase is not configured');
  return authInstance;
}

export function db(): Firestore {
  if (!dbInstance) throw new Error('Firebase is not configured');
  return dbInstance;
}
