const CACHE = 'lematic-fs-flat-v8';
// Core app shell only — cached on install so the app opens fast and works offline.
const PRECACHE = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './templates.js',
  './manifest.webmanifest',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png'
];
// Export-only libraries and templates — fetched (and cached by the runtime
// fetch handler below) only the first time a PDF/Excel export is used, so
// they don't slow down first load or eat storage for techs who never export.
// exceljs.min.js, jspdf.umd.min.js, jspdf.plugin.autotable.min.js,
// Punchlist-Template.xlsx, timecard-template.xlsx
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    } catch (e) {
      const cached = await cache.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const home = await cache.match('./index.html');
        if (home) return home;
      }
      throw e;
    }
  })());
});
