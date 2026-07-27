/*
 * My Tasks service worker: keeps the app shell available offline.
 *
 * - Navigations: network-first, falling back to the cached shell when offline.
 * - Same-origin static assets (bundles, icons, fonts): stale-while-revalidate.
 * - Cross-origin traffic (Firebase auth/Firestore) is never intercepted, so
 *   live sync and Firestore's own offline queue behave normally.
 *
 * Bump CACHE when changing caching behavior so old caches get dropped.
 */
const CACHE = 'my-tasks-shell-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['/'])));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put('/', fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match('/');
          return cached ?? Response.error();
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => undefined);
      return cached ?? (await network) ?? Response.error();
    })()
  );
});
