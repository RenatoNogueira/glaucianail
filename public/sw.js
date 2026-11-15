// Service worker: torna o site instalável e mostra uma página amigável quando não há internet.
// Dados (API, logo, painel admin e manifestos) NUNCA são guardados: vêm sempre da rede, para nada ficar desatualizado.
const VERSION = 'v2';
const CACHE = `agenda-${VERSION}`;
const OFFLINE = '/offline.html';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, '/offline.js', '/icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // fontes do Google etc.: o navegador resolve
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin') || url.pathname === '/logo' || url.pathname.startsWith('/manifest')) return;

  // Páginas: rede primeiro; sem internet, mostra a página "sem conexão"
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
    return;
  }
  // Arquivos do site (CSS, JS, imagens): rede primeiro, cache só como reserva
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copia = res.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); }
      return res;
    }).catch(() => caches.match(req))
  );
});
