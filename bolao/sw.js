// sw.js — football-hardening checkpoint G: zero-stale-cache policy.
//
// This used to be a network-first-for-HTML / cache-first-for-versioned-assets service worker.
// That caching behavior is exactly the failure mode this checkpoint exists to eliminate: a
// network fetch failure could fall back to `caches.match()` and silently serve a stale
// index.html (see docs/bolao/FOOTBALL_HARDENING_INCIDENT_AUDIT.md and the freshness-guard
// wired into every page now, bolao/shared/js/freshness-guard.js).
//
// This file is now a self-unregistering kill switch: for any returning visitor whose browser
// still has the OLD caching version of this file registered, the new one (this one) takes over
// on the next load, deletes every Cache API entry it can find, and unregisters itself — leaving
// the browser with no service worker for this origin at all going forward. It never registers
// itself again (nothing in this repo calls navigator.serviceWorker.register() for this file
// anymore — see freshness-guard.js's own unregister-on-load logic, which is the primary
// mechanism; this file is the redundant second layer for a worker that's already active before
// the page's JS runs).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll())
      .then((clients) => clients.forEach((c) => c.navigate(c.url)))
  );
});
