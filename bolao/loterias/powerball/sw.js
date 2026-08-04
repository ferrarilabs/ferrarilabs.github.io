// Service Worker — força fresh load, nunca cache
self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', function(event) {
  var url = event.request.url;
  // Para data.js, app.js, index.html: força fresh, não cacheia
  if (url.includes('data.js') || url.includes('app.js') || url.includes('index.html')) {
    event.respondWith(fetch(event.request, {cache: 'no-store'}));
  } else {
    // Outros recursos: passthrough padrão
    event.respondWith(fetch(event.request));
  }
});
