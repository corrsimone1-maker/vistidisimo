// Service worker: tiene una copia dell'app per aprirla anche offline. Prima prova la rete,
// così gli aggiornamenti arrivano subito; le API (GitHub, TMDB) non passano da qui.
const CACHE = 'vistidisimo-v15';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    try {
      // no-cache: chiede sempre al server se il file è cambiato (risposta 304 se uguale),
      // così non si mischiano file vecchi e nuovi dopo un aggiornamento
      const res = await fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' });
      if (res.ok) { const c = await caches.open(CACHE); c.put(e.request, res.clone()); }
      return res;
    } catch {
      const hit = await caches.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      if (e.request.mode === 'navigate') return (await caches.match('./index.html', { ignoreSearch: true })) || Response.error();
      return Response.error();
    }
  })());
});
