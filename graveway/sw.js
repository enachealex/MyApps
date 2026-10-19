/* Graveway service worker: lets the game start with no connection.

   Every file is fetched from the network first and cached as it arrives;
   the cache is only used when the network fails. Serving the cache first
   would be faster, but after an update it could hand out a new page with
   old scripts, which breaks. Bump CACHE when the file list changes. */

const CACHE = 'graveway-v4';
const FILES = [
  './',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'fonts/bebas-neue.woff2',
  'vendor/three.module.min.js',
  'src/main.js',
  'src/game.js',
  'src/ui.js',
  'src/config.js',
  'src/save.js',
  'src/audio.js',
  'src/input.js',
  'src/world.js',
  'src/models.js',
  'src/nav.js',
  'src/props.js',
  'src/director.js',
  'src/weapons.js',
  'src/vfx.js',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('graveway-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const fresh = await fetch(request);
      if (fresh.ok) cache.put(request.mode === 'navigate' ? './' : request, fresh.clone());
      return fresh;
    } catch {
      const cached = await cache.match(request.mode === 'navigate' ? './' : request, { ignoreSearch: true });
      return cached || Response.error();
    }
  })());
});
