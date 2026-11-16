const CACHE = 'exhibit-card-60f65fc8884b18f2';
const assets = ["./index.html","./style.css","./manifest.webmanifest","./icon-192.png","./icon-512.png","./app.js","./rules.js","./storage.js","./export.js","./vendor/tesseract.min.js","./vendor/worker.min.js","./vendor/core/tesseract-core-lstm.wasm.js","./vendor/core/tesseract-core-simd-lstm.wasm.js","./vendor/lang/eng.traineddata.gz","./vendor/lang/chi_sim.traineddata.gz","./vendor/fflate.js","./vendor/jsQR.js"];
const urls = new Set(assets.map(path => new URL(path, self.registration.scope).href));
const entry = new URL('./index.html', self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(assets.map(path => new Request(new URL(path, self.registration.scope), { cache: 'reload' })));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await self.clients.claim();
    // Keep earlier assets while an already-open tab may still be loading a worker.
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const navigation = request.mode === 'navigate' &&
    [self.registration.scope, entry].includes(request.url.split('?')[0]);
  if (!navigation && !urls.has(request.url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = navigation ? entry : request;
    return await cache.match(key) ?? fetch(key);
  })());
});
