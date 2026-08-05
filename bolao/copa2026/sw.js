// sw.js — football-hardening checkpoint G: zero-stale-cache policy.
// Same kill-switch treatment as bolao/sw.js (see that file's comment for full rationale) —
// Copa2026 previously registered its OWN copy of the caching service worker at this path
// (CLAUDE.md's "Copa do Mundo 2026 archive" note). Reduced here to self-unregister + clear all
// Cache API entries; nothing in copa2026/js/app.js calls navigator.serviceWorker.register()
// anymore (removed this same checkpoint — see bolao/shared/js/freshness-guard.js for the new
// primary unregister-on-load mechanism).
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
