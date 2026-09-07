const CACHE = 'lematic-fs-flat-v54';
const PRECACHE = [
  './',
  './index.html',
  './app.css?v=53',
  './app.js?v=53',
  './templates.js?v=53',
  './qrcode.min.js?v=53',
  './manifest.webmanifest',
  './apple-touch-icon.png',
  './icon-192.png'
];
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE).catch(() => {})).then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req) || await cache.match(url.pathname);
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) cache.put(req, fresh.clone());
      return cached || fresh;
    } catch (e) {
      if (cached) return cached;
      return cache.match('./index.html');
    }
  })());
});
