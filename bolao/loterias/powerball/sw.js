// Service Worker for Powerball bolão — força fresh load SEMPRE, nunca cache
// Intercepta TODAS requisições e previne caching de dados e scripts

self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', function(event) {
  var url = event.request.url;
  var isDataFile = url.includes('data.js') || url.includes('app.js') || url.includes('index.html');

  // Para data.js, app.js, e index.html: NUNCA cache, sempre fetch fresh
  if (isDataFile) {
    event.respondWith(
      fetch(event.request, {cache: 'no-store'}).then(function(response) {
        // Garante que a resposta não é cacheada
        var clonedResponse = response.clone();
        return new Response(clonedResponse.body, {
          status: response.status,
          statusText: response.statusText,
          headers: new Headers(response.headers)
        });
      }).catch(function(err) {
        console.error('Fetch failed for ' + url, err);
        return new Response('Offline or fetch failed', {status: 503});
      })
    );
  } else {
    // Outros recursos: passthrough padrão
    event.respondWith(fetch(event.request));
  }
});
