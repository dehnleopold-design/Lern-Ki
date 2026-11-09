// Offline-Cache für die App-Dateien. KI-Anfragen gehen immer ins Netz.
const CACHE = 'lernki-v55';
const SHELL = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'assets/icon.svg', 'assets/fonts.css',
  'js/app.js', 'js/gen.js', 'js/viewer.js', 'js/notes.js', 'js/chess.js', 'js/chess-engine.js', 'js/ai.js', 'js/store.js', 'js/files.js', 'js/prompts.js', 'js/ui.js', 'js/grades.js', 'js/pdf.js', 'js/auth.js', 'js/firebase-config.js', 'js/sync.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Netz zuerst (damit Updates sofort ankommen), Cache als Rückfall.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/control/')) return; // Control-App: immer direkt aus dem Netz
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});
