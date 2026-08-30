/* LeMatic Field Service — cache-first service worker */
const CACHE = 'lematic-inspect-v6';
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './vendor/jspdf.umd.min.js',
  './vendor/jspdf.plugin.autotable.min.js',
  './vendor/xlsx.full.min.js',
  './vendor/exceljs.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => null)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;

    if (req.mode === 'navigate') {
      const shell = await caches.match('./index.html') || await caches.match('./');
      if (shell) return shell;
    }

    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      if (req.mode === 'navigate') {
        return (await caches.match('./index.html')) ||
               (await caches.match('./')) ||
               new Response('Offline — open LeMatic from the home screen.', {
                 status: 503,
                 headers: { 'Content-Type': 'text/plain' }
               });
      }
      throw err;
    }
  })());
});
