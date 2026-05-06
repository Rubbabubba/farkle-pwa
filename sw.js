importScripts('./version.js');

const CACHE_VERSION = FARKLE_APP_VERSION;
const CACHE_NAME = `farkle-pwa-${CACHE_VERSION}`;
const ASSET_VERSION = CACHE_VERSION.replace(/^v/, '');

const ASSETS = [
  './',
  `./index.html?v=${ASSET_VERSION}`,
  `./style.css?v=${ASSET_VERSION}`,
  `./version.js?v=${ASSET_VERSION}`,
  `./engine.js?v=${ASSET_VERSION}`,
  `./app.js?v=${ASSET_VERSION}`,
  `./manifest.webmanifest?v=${ASSET_VERSION}`,
  './assets/icon-192.png',
  './assets/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: false });
    if (cached) return cached;

    try {
      const fresh = await fetch(req);
      if (new URL(req.url).origin === self.location.origin) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (e) {
      return cached;
    }
  })());
});
