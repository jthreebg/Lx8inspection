const CACHE = 'lematic-fs-flat-v56';
const PRECACHE = [
  './',
  './index.html',
  './app.css?v=57',
  './app.js?v=57',
  './templates.js?v=57',
  './qrcode.min.js?v=57',
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
    // Cache-first makes repeat launches instant. A background refresh keeps
    // the app current without blocking the first paint on network latency.
    if (cached) {
      event.waitUntil(
        fetch(req).then((fresh) => {
          if (fresh && fresh.ok) return cache.put(req, fresh);
        }).catch(() => {})
      );
      return cached;
    }
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    } catch (e) {
      return cache.match('./index.html');
    }
  })());
});
