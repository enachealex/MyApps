import { Platform } from 'react-native';
import { create } from 'zustand';

/**
 * PWA glue for the web build: injects the manifest + install meta tags,
 * captures Chrome's install prompt so the app can offer an "Install app"
 * button, and registers the offline service worker in production builds.
 * Everything is a no-op on iOS/Android native.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface InstallState {
  /** True when the browser offered an install prompt we can replay. */
  canInstall: boolean;
}

export const useInstallStore = create<InstallState>(() => ({ canInstall: false }));

let deferredPrompt: BeforeInstallPromptEvent | null = null;

function ensureHeadTag(tagName: 'link' | 'meta', attrs: Record<string, string>): void {
  const keyAttr = tagName === 'link' ? 'rel' : 'name';
  if (document.head.querySelector(`${tagName}[${keyAttr}="${attrs[keyAttr]}"]`)) return;
  const el = document.createElement(tagName);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  document.head.appendChild(el);
}

export function setupPwa(): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;

  // Relative paths: the app lives at the domain root in dev but under a
  // subpath (e.g. /my-tasks/) on the hosted site.
  ensureHeadTag('link', { rel: 'manifest', href: 'manifest.webmanifest' });
  ensureHeadTag('link', { rel: 'apple-touch-icon', href: 'icons/icon-192.png' });
  ensureHeadTag('meta', { name: 'theme-color', content: '#2564CF' });
  ensureHeadTag('meta', { name: 'mobile-web-app-capable', content: 'yes' });
  ensureHeadTag('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
  ensureHeadTag('meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'default' });
  ensureHeadTag('meta', { name: 'apple-mobile-web-app-title', content: 'My Tasks' });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    useInstallStore.setState({ canInstall: true });
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    useInstallStore.setState({ canInstall: false });
  });

  // The service worker would serve stale bundles against Metro in dev,
  // so it only runs in exported (production) builds. setupPwa runs from a
  // React effect, which is usually after the window load event — register
  // immediately in that case.
  if (!__DEV__ && 'serviceWorker' in navigator) {
    const register = () =>
      navigator.serviceWorker
        .register('sw.js')
        .catch((e) => console.warn('Service worker registration failed', e));
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }
}

/** Replays the browser's install prompt (Chrome/Edge; no-op elsewhere). */
export async function promptInstall(): Promise<void> {
  if (!deferredPrompt) return;
  const prompt = deferredPrompt;
  deferredPrompt = null;
  useInstallStore.setState({ canInstall: false });
  await prompt.prompt();
  await prompt.userChoice;
}

/** Keeps the browser UI color in sync with the active theme. */
export function updateThemeColorMeta(color: string): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  const meta = document.head.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', color);
}
