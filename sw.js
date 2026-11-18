// Offline-Cache für die App-Dateien. KI-Anfragen gehen immer ins Netz.
const CACHE = 'lernki-v78';
const SHELL = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'assets/icon.svg', 'assets/fonts.css',
  'js/ai.js', 'js/app.js', 'js/auth.js', 'js/celebrate.js', 'js/chess-engine.js', 'js/chess.js', 'js/env.js', 'js/files.js', 'js/firebase-config.js', 'js/games.js', 'js/push.js', 'js/gen.js', 'js/goodnotes.js', 'js/grades.js', 'js/license.js', 'js/notes.js', 'js/offline-ai.js', 'js/pdf.js', 'js/prompts.js', 'js/ranks.js', 'js/rewards.js', 'js/seasons.js', 'js/store.js', 'js/sync.js', 'js/ui.js', 'js/viewer.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  // Nur eigene alte Stände löschen – nicht die von Jelly Developer (/dev/) oder vom Offline-Tutor
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && /^lernki-v\d/.test(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Netz zuerst (damit Updates sofort ankommen), Cache als Rückfall.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/control/')) return; // Control-App: immer direkt aus dem Netz
  if (url.pathname.includes('/dev/')) return; // Jelly Developer hat einen eigenen Service Worker
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match(url.pathname.includes('/voice/') ? 'voice/index.html' : 'index.html')))
  );
});

// ---------- Push-Mitteilungen (vom Server über Firebase Cloud Messaging)
self.addEventListener('push', (e) => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch { p = { body: e.data?.text?.() || '' }; }
  const n = p.notification || {};
  const d = p.data || p;
  const title = n.title || d.title || 'Jelly';
  const opts = { body: n.body || d.body || '', icon: 'assets/icon-192.png', badge: 'assets/icon-192.png', tag: d.tag || n.tag || 'jelly', data: { url: d.url || (p.fcmOptions && p.fcmOptions.link) || './' } };
  e.waitUntil(self.registration.showNotification(title, opts));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
