// Service Worker von Jelly Developer (/dev/). Eigener Cache, getrennt vom echten Jelly.
// Wird von tools/dev.py erzeugt – nicht von Hand ändern.
const CACHE = 'lernki-dev-23';
const SHELL = ["./", "index.html", "devshim.js", "styles.css", "manifest.webmanifest", "icon-180.png", "../assets/icon.svg", "../assets/fonts.css", "js/ai.js", "js/app.js", "js/auth.js", "js/celebrate.js", "js/chess-engine.js", "js/chess.js", "js/devtools.js", "js/env.js", "js/files.js", "js/firebase-config.js", "js/games.js", "js/gen.js", "js/goodnotes.js", "js/grades.js", "js/hand-fallback.js", "js/hand-words.js", "js/hand.js", "js/inbox.js", "js/license.js", "js/notes.js", "js/offline-ai.js", "js/pdf.js", "js/prompts.js", "js/push.js", "js/ranks.js", "js/rewards.js", "js/seasons.js", "js/store.js", "js/sync.js", "js/ui.js", "js/viewer.js"];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k.startsWith('lernki-dev-')).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});
