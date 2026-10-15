const CACHE_NAME = "shiftmate-static-v10";
const ASSETS = [
  "./",
  "./index.html",
  "./css/style.css?v=10",
  "./js/main.js?v=10",
  "./js/modules/date-time.js",
  "./js/modules/storage.js",
  "./js/modules/calculator.js",
  "./js/modules/dom.js",
  "./js/modules/clock.js",
  "./js/modules/breaks.js",
  "./js/modules/history.js",
  "./js/modules/theme.js",
  "./manifest.json"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response && response.ok && new URL(event.request.url).origin === self.location.origin) {
      const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => caches.match("./index.html"))));
});