/* Software Hub — service worker
 * Cache-first для статичних ассетів, stale-while-revalidate для software.json.
 * Bump CACHE_VERSION коли змінюється будь-який core asset. */

var CACHE_VERSION = 'software-hub-v1';

var CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './software.json',
  './manifest.webmanifest',
  './assets/icons/favicon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(function (cache) { return cache.addAll(CORE_ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          if (k !== CACHE_VERSION) return caches.delete(k);
          return Promise.resolve();
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  // software.json: stale-while-revalidate
  if (url.pathname.indexOf('/software.json') !== -1) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(function (cache) {
        return cache.match(req).then(function (cached) {
          var network = fetch(req).then(function (resp) {
            if (resp && resp.status === 200) {
              cache.put(req, resp.clone());
            }
            return resp;
          }).catch(function () { return cached; });
          return cached || network;
        });
      })
    );
    return;
  }

  // Все інше: cache-first з фоновим оновленням
  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (resp) {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          var clone = resp.clone();
          caches.open(CACHE_VERSION).then(function (cache) {
            cache.put(req, clone);
          });
        }
        return resp;
      });
    })
  );
});
