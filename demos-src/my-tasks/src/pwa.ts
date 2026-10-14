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
  // DEMO BUILD — deliberately does nothing.
  //
  // The demo must not install itself, must not claim to be an app, and must
  // not register a service worker (which would cache the bundle on the
  // visitor's device). Leaving this as a no-op removes the manifest, the
  // install meta tags, the install prompt and the service worker in one go.
  //
  // The module's other exports (useInstallStore, promptInstall,
  // updateThemeColorMeta) are left intact so nothing else needs to change;
  // with no install prompt ever captured, promptInstall is a no-op too.
  void ensureHeadTag;
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
