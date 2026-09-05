// Cache name: bump the suffix whenever STATIC_ASSETS contents change
// (e.g. a new icon or vendor library version) so clients pick it up.
const CACHE = 'lematic-fs-flat-v3';

// App shell: changes often, so it's fetched fresh whenever the device is
// online and only served from cache when offline (network-first below).
const APP_SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './templates.js',
  './manifest.webmanifest'
];

// Static/vendor assets: large and effectively immutable. Served
// cache-first so a return visit doesn't re-download megabytes of
// jsPDF/ExcelJS on every load - bump the CACHE name above if any of
// these files are ever replaced with a new version.
const STATIC_ASSETS = [
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './exceljs.min.js',
  './jspdf.umd.min.js',
  './jspdf.plugin.autotable.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll([...APP_SHELL, ...STATIC_ASSETS]).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isStaticAsset(url) {
  return STATIC_ASSETS.some((path) => url.pathname.endsWith(path.replace('./', '/')));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isStaticAsset(url)) {
    // Cache-first: static vendor libs/icons rarely change.
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        throw e;
      }
    })());
    return;
  }

  // Network-first: app shell files should stay fresh while online.
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
