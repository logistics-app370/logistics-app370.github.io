/* Logistics app shell cache. Only same-origin GET files are cached.
   The data line (script.google.com) is never intercepted or cached. */
'use strict';
var VERSION = 'a5da38a8e3';
var CACHE = 'logistics-app-' + VERSION;
var SHELL = [
  './', './index.html', './shell.css', './app.css', './app.js', './libs.js', './api.js', './boot.js',
  './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './favicon-32.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('logistics-app-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;
  // config.js: network first so a new data-line URL applies right away.
  if (/\/config\.js$/.test(url.pathname)) {
    event.respondWith(fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
      return res;
    }).catch(function () { return caches.match(req); }));
    return;
  }
  // Everything else: cache first for an instant start, refresh in the background.
  var key = req.mode === 'navigate' ? './index.html' : req;
  event.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(key, { ignoreSearch: req.mode === 'navigate' }).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') c.put(key, res.clone());
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    });
  }));
});
