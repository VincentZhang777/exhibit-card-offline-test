const CACHE = 'exhibit-card-87080c391c29a5eb';
const assets = ["./index.html","./style.css","./manifest.webmanifest","./icon-192.png","./icon-512.png","./app.js","./rules.js","./storage.js","./export.js","./vendor/tesseract.min.js","./vendor/worker.min.js","./vendor/core/tesseract-core-lstm.wasm.js","./vendor/core/tesseract-core-simd-lstm.wasm.js","./vendor/lang/eng.traineddata.gz","./vendor/lang/chi_sim.traineddata.gz","./vendor/lang/rus.traineddata.gz","./vendor/lang/spa.traineddata.gz","./vendor/lang/ara.traineddata.gz","./vendor/lang/fra.traineddata.gz","./vendor/fflate.js","./vendor/jsQR.js"];
const modelAssets = ["./vendor/tesseract.min.js","./vendor/worker.min.js","./vendor/core/tesseract-core-lstm.wasm.js","./vendor/core/tesseract-core-simd-lstm.wasm.js","./vendor/lang/eng.traineddata.gz","./vendor/lang/chi_sim.traineddata.gz","./vendor/lang/rus.traineddata.gz","./vendor/lang/spa.traineddata.gz","./vendor/lang/ara.traineddata.gz","./vendor/lang/fra.traineddata.gz","./vendor/jsQR.js"];
const resolveAsset = path => new URL(path, self.registration.scope).href;
const urls = new Set(assets.map(resolveAsset));
const models = new Set(modelAssets.map(resolveAsset));
const entry = new URL('./index.html', self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const shell = [...urls].filter(url => !models.has(url));
    await cache.addAll(shell.map(url => new Request(url, { cache: 'reload' })));
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
    const cached = await cache.match(key);
    if (cached) return cached;
    if (!models.has(request.url)) return fetch(key);
    const response = await fetch(request, { cache: 'reload' });
    if (!response.ok) return response;
    await cache.put(request, response.clone());
    return response;
  })());
});
