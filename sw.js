// Service worker: permite usar o app offline depois do primeiro acesso.
const CACHE = 'treino-v50';
const ASSETS = ['./', './index.html', './sync.js', './firebase-config.js', './exercicios.json', './manifest.webmanifest', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  // cache: 'reload' ignora o cache HTTP do navegador (o GitHub Pages guarda por até 10 min) e baixa a versão publicada
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('message', e => { if (e.data === 'version') e.source.postMessage({ version: CACHE }); });

// Cache primeiro (abre na hora, mesmo com sinal fraco na academia) e atualiza em segundo plano.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Arquivos do app e a biblioteca do Firebase (para abrir offline); chamadas de login e banco passam direto
  if (e.request.method !== 'GET' || !(url.origin === location.origin || url.href.startsWith('https://www.gstatic.com/firebasejs/') || url.href.startsWith('https://raw.githubusercontent.com/yuhonas/free-exercise-db/') || url.href.startsWith('https://wger.de/media/'))) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const cached = await c.match(e.request, { ignoreSearch: true });
    const req = url.origin === location.origin ? new Request(e.request.url, { cache: 'no-cache' }) : e.request;   // arquivos do app: sempre confere com o servidor
    const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; }).catch(() => null);
    if (cached) { e.waitUntil(net); return cached; }
    return (await net) || (await c.match('./index.html')) || Response.error();
  }));
});
