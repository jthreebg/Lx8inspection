/* LeMatic Field Service — network-first HTML so GitHub updates actually arrive */
const CACHE = 'lematic-inspect-v8';
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
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

  const isDoc = req.mode === 'navigate' ||
    (req.destination === 'document') ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('/');

  event.respondWith((async () => {
    if (isDoc) {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        if (fresh && fresh.ok) {
          const cache = await caches.open(CACHE);
          cache.put(req, fresh.clone());
          if (url.pathname.endsWith('/') || url.pathname.endsWith('index.html')) {
            cache.put('./index.html', fresh.clone()).catch(() => {});
          }
        }
        return fresh;
      } catch (err) {
        return (await caches.match(req, { ignoreSearch: true })) ||
               (await caches.match('./index.html')) ||
               (await caches.match('./'));
      }
    }

    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      return cached;
    }
  })());
});
