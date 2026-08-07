/* sw.js — service worker for lyvorianstudio.co.in.
   Deliberately simple: network first, falling back to the last good copy.
   Nothing is served stale while online, so deploys behave exactly as before;
   the cache only matters when the network is gone. Present chiefly so the
   site is a real installable PWA (browsers then mint a proper, current
   web app instead of wrapping the page in a legacy shortcut APK). */
var CACHE = 'lyv-v1';

self.addEventListener('install', function (e) {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // analytics etc. untouched

  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        // last resort for page navigations: the cached homepage
        return hit || (req.mode === 'navigate' ? caches.match('/') : undefined);
      });
    })
  );
});
