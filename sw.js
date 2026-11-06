// Service worker: permite usar o app offline depois do primeiro acesso.
const CACHE = 'treino-v32';
const ASSETS = ['./', './index.html', './sync.js', './firebase-config.js', './exercicios.json', './manifest.webmanifest', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Cache primeiro (abre na hora, mesmo com sinal fraco na academia) e atualiza em segundo plano.
// A versão nova passa a valer na próxima vez que o app for aberto.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Arquivos do app e a biblioteca do Firebase (para abrir offline); chamadas de login e banco passam direto
  if (e.request.method !== 'GET' || !(url.origin === location.origin || url.href.startsWith('https://www.gstatic.com/firebasejs/') || url.href.startsWith('https://raw.githubusercontent.com/yuhonas/free-exercise-db/') || url.href.startsWith('https://wger.de/media/'))) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const cached = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') c.put(e.request, r.clone());   // imagens de outros sites chegam como 'opaque' return r; }).catch(() => null);
    if (cached) { e.waitUntil(net); return cached; }
    return (await net) || (await c.match('./index.html')) || Response.error();
  }));
});
