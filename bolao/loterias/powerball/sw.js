// Service Worker para Powerball - Limpa cache agressivamente
const CACHE_VERSION = 'powerball-v' + Date.now();

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => caches.delete(cacheName))
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Nunca cachear - sempre puxar do servidor
  event.respondWith(
    fetch(event.request).catch(() => {
      // Se falhar, tentar cache como fallback
      return caches.match(event.request);
    })
  );
});
