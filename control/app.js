// Jelly Control – Übersicht aller Jelly-Konten (nur Kennzahlen aus userIndex/{uid}, keine Lerninhalte).
// Lesen darf nur das Admin-Konto; das legen die Firestore-Regeln fest (siehe Einrichtung in dieser App).

import { firebaseConfig } from '../js/firebase-config.js';

const V = '10.12.2';
const base = `https://www.gstatic.com/firebasejs/${V}`;
const [{ initializeApp }, A, F] = await Promise.all([import(`${base}/firebase-app.js`), import(`${base}/firebase-auth.js`), import(`${base}/firebase-firestore.js`)]);
const app = initializeApp(firebaseConfig, 'control');
const auth = A.getAuth(app);
auth.languageCode = 'de';
const db = F.getFirestore(app);

const root = document.getElementById('app');
let users = [];
let unsub = null;
const ui = { q: '', sort: 'seen' };

// ---------- kleine Helfer
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const ICON = {
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
};
const icon = (n) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '20'); s.setAttribute('height', '20'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.innerHTML = ICON[n]; return s; };
function toast(t) { const el = h('div', { class: 'toast' }, t); document.body.append(el); setTimeout(() => el.remove(), 2600); }
const fmt = (ms) => (ms ? new Date(ms).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');
function ago(ms) {
  if (!ms) return 'nie';
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 2) return 'gerade eben';
  if (m < 60) return `vor ${m} Min.`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `vor ${hr} Std.`;
  const d = Math.round(hr / 24);
  return d === 1 ? 'gestern' : `vor ${d} Tagen`;
}
const online = (u) => u.lastSeen && Date.now() - u.lastSeen < 20 * 60000;
const DAY = 86400000;

// ---------- Ansichten
function viewLogin(err = '') {
  const email = h('input', { class: 'input', type: 'email', placeholder: 'E-Mail', autocomplete: 'username' });
  const pw = h('input', { class: 'input', type: 'password', placeholder: 'Passwort', autocomplete: 'current-password' });
  root.replaceChildren(h('div', { class: 'center-screen' },
    h('div', { class: 'logo big' }),
    h('h1', {}, 'Jelly Control'),
    h('p', { class: 'muted' }, 'Melde dich mit dem Konto an, mit dem du Jelly verwaltest.'),
    h('div', { class: 'stack' },
      h('button', { class: 'btn white block', onclick: async () => { try { await A.signInWithPopup(auth, new A.GoogleAuthProvider()); } catch (e) { viewLogin(e.code === 'auth/popup-closed-by-user' ? '' : 'Anmeldung fehlgeschlagen.'); } } }, 'Mit Google anmelden'),
      h('p', { class: 'muted small' }, 'oder mit E-Mail'),
      email, pw,
      h('button', { class: 'btn primary block', onclick: async () => { try { await A.signInWithEmailAndPassword(auth, email.value.trim(), pw.value); } catch { viewLogin('E-Mail oder Passwort stimmt nicht.'); } } }, 'Anmelden'),
      err ? h('p', { class: 'small', style: 'color: var(--bad)' }, err) : null)));
}

function rulesText(uid) {
  return `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    // Kontoübersicht: jedes Konto schreibt nur seinen eigenen Eintrag, lesen darf nur Control
    match /userIndex/{uid} {
      allow write: if request.auth != null && request.auth.uid == uid;
      allow read, delete: if request.auth != null && request.auth.uid == '${uid}';
    }
  }
}`;
}

function viewSetup(user) {
  const text = rulesText(user.uid);
  root.replaceChildren(h('div', { class: 'center-screen' },
    h('div', { class: 'logo big' }),
    h('h1', {}, 'Noch eine Freigabe'),
    h('p', { class: 'muted' }, `Angemeldet als ${user.email || user.uid}. Damit nur du die Übersicht sehen kannst, müssen die Firestore-Regeln einmal ergänzt werden.`),
    h('ol', { class: 'steps' },
      h('li', {}, 'Regeln unten kopieren.'),
      h('li', {}, h('a', { href: 'https://console.firebase.google.com/project/jelly-721e4/firestore/rules', target: '_blank', rel: 'noopener' }, 'Firestore → Regeln'), ' öffnen, alles markieren, durch die kopierten Regeln ersetzen und „Veröffentlichen“ tippen.'),
      h('li', {}, 'Hier „Erneut prüfen“ tippen.')),
    h('pre', { class: 'code' }, text),
    h('div', { class: 'stack' },
      h('button', { class: 'btn primary block', onclick: async () => { try { await navigator.clipboard.writeText(text); toast('Regeln kopiert'); } catch { toast('Kopieren nicht erlaubt – bitte markieren und kopieren.'); } } }, icon('copy'), 'Regeln kopieren'),
      h('button', { class: 'btn block', onclick: () => listen(user) }, 'Erneut prüfen'),
      h('button', { class: 'btn block', onclick: () => A.signOut(auth) }, 'Anderes Konto'))));
}

function viewDashboard(user) {
  const now = Date.now();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const kpi = (num, lab) => h('div', { class: 'kpi' }, h('div', { class: 'num' }, num), h('div', { class: 'lab' }, lab));
  const versions = {};
  for (const u of users) versions[u.version || '?'] = (versions[u.version || '?'] || 0) + 1;
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Name oder E-Mail suchen', value: ui.q, oninput: (e) => { ui.q = e.target.value; draw(); } });
  const sort = h('select', { class: 'input', onchange: (e) => { ui.sort = e.target.value; draw(); } },
    [['seen', 'Zuletzt aktiv'], ['new', 'Neueste'], ['name', 'Name']].map(([v, l]) => h('option', { value: v, selected: ui.sort === v ? '' : null }, l)));
  const list = h('div', { class: 'list' });
  const draw = () => {
    const qq = ui.q.trim().toLowerCase();
    const rows = users.filter((u) => !qq || `${u.name} ${u.email}`.toLowerCase().includes(qq)).sort((a, b) =>
      ui.sort === 'new' ? (b.createdAt || 0) - (a.createdAt || 0) : ui.sort === 'name' ? (a.name || a.email || '').localeCompare(b.name || b.email || '', 'de') : (b.lastSeen || 0) - (a.lastSeen || 0));
    list.replaceChildren(...(rows.length ? rows.map(userRow) : [h('div', { class: 'empty' }, users.length ? 'Keine Treffer.' : 'Noch keine Konten. Sie erscheinen, sobald jemand Jelly (ab Version 2.34) mit Konto öffnet.')]));
  };
  draw();
  root.replaceChildren(h('div', { class: 'wrap' },
    h('header', { class: 'top' }, h('div', { class: 'logo' }), h('div', { style: 'flex:1' }, h('h1', {}, 'Control'), h('div', { class: 'who' }, user.email || '')),
      h('button', { class: 'iconbtn', 'aria-label': 'Abmelden', title: 'Abmelden', onclick: () => A.signOut(auth) }, icon('out'))),
    h('section', { class: 'kpis' },
      kpi(users.length, 'Konten'),
      kpi(users.filter((u) => u.lastSeen >= today.getTime()).length, 'heute aktiv'),
      kpi(users.filter((u) => u.lastSeen >= now - 7 * DAY).length, 'aktiv in 7 Tagen'),
      kpi(users.filter((u) => u.createdAt >= now - 7 * DAY).length, 'neu in 7 Tagen')),
    h('h2', {}, 'Jelly-Versionen'),
    h('div', { class: 'chips' }, Object.entries(versions).sort((a, b) => b[0].localeCompare(a[0], 'de', { numeric: true })).map(([v, n]) => h('span', { class: 'chip' }, `${v} · `, h('b', {}, n)))),
    h('div', { class: 'tools' }, search, sort),
    list,
    h('p', { class: 'muted small', style: 'margin-top:22px' }, 'Hier stehen Konten, sobald sie Jelly ab Version 2.34 mit Konto geöffnet haben. Alle registrierten Konten siehst du in der ',
      h('a', { href: 'https://console.firebase.google.com/project/jelly-721e4/authentication/users', target: '_blank', rel: 'noopener' }, 'Firebase-Konsole'), '.')));
}

function userRow(u) {
  const label = u.name || u.email || u.uid;
  return h('button', { class: 'user', onclick: () => detail(u) },
    h('div', { class: 'avatar' }, (label[0] || '?').toUpperCase()),
    h('div', { class: 'txt' }, h('div', { class: 'name' }, label), h('div', { class: 'sub' }, [u.email && u.name ? u.email : '', u.device, u.version ? `v${u.version}` : ''].filter(Boolean).join(' · '))),
    h('span', { class: `state ${online(u) ? 'online' : ''}` }, online(u) ? 'online' : ago(u.lastSeen)));
}

function detail(u) {
  const c = u.counts || {};
  const close = () => ov.remove();
  const ov = h('div', { class: 'overlay', onclick: (e) => { if (e.target === ov) close(); } },
    h('div', { class: 'sheet' },
      h('div', { class: 'sheet-head' }, h('div', { class: 'avatar' }, ((u.name || u.email || '?')[0]).toUpperCase()), h('div', { style: 'flex:1;min-width:0' }, h('div', { class: 'name', style: 'font-weight:700' }, u.name || '–'), h('div', { class: 'muted small' }, u.email || '')),
        h('button', { class: 'iconbtn', 'aria-label': 'Schließen', onclick: close }, icon('close'))),
      h('dl', { class: 'rows' },
        h('dt', {}, 'Status'), h('dd', {}, online(u) ? 'online' : `zuletzt aktiv ${ago(u.lastSeen)}`),
        h('dt', {}, 'Zuletzt aktiv'), h('dd', {}, fmt(u.lastSeen)),
        h('dt', {}, 'Registriert'), h('dd', {}, fmt(u.createdAt)),
        h('dt', {}, 'Anmeldung'), h('dd', {}, u.provider === 'google.com' ? 'Google' : u.provider === 'password' ? 'E-Mail & Passwort' : u.provider || '–'),
        h('dt', {}, 'Version'), h('dd', {}, u.version || '–'),
        h('dt', {}, 'Klasse'), h('dd', {}, u.klasse || '–'),
        h('dt', {}, 'KI'), h('dd', {}, u.ki || '–'),
        h('dt', {}, 'Geräte'), h('dd', {}, Object.values(u.devices || {}).join(', ') || u.device || '–')),
      h('div', { class: 'counts' },
        [['faecher', 'Fächer'], ['klausuren', 'Klausuren'], ['vokabellisten', 'Vokabellisten'], ['blaetter', 'Gelöste Blätter'], ['dateien', 'Dateien'], ['stunden', 'Stunden im Plan']]
          .map(([k, l]) => h('div', {}, h('b', {}, c[k] ?? '–'), h('span', {}, l)))),
      h('p', { class: 'muted small' }, `UID: ${u.uid}`),
      h('button', { class: 'btn block', onclick: async () => {
        if (!confirm('Eintrag aus der Übersicht entfernen? Das Konto selbst bleibt bestehen und erscheint wieder, wenn es Jelly öffnet.')) return;
        try { await F.deleteDoc(F.doc(db, 'userIndex', u.uid)); close(); } catch { toast('Entfernen nicht erlaubt.'); }
      } }, 'Aus Übersicht entfernen')));
  document.body.append(ov);
}

// ---------- Daten
function listen(user) {
  unsub?.();
  root.replaceChildren(h('div', { class: 'center-screen' }, h('div', { class: 'logo big' }), h('p', { class: 'muted' }, 'Lade Konten …')));
  unsub = F.onSnapshot(F.collection(db, 'userIndex'), (snap) => {
    users = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    if (!document.querySelector('.overlay')) viewDashboard(user);
  }, (e) => {
    if (e.code === 'permission-denied') viewSetup(user);
    else root.replaceChildren(h('div', { class: 'center-screen' }, h('div', { class: 'logo big' }), h('p', {}, `Fehler: ${e.message}`), h('button', { class: 'btn', onclick: () => listen(user) }, 'Nochmal')));
  });
}

A.onAuthStateChanged(auth, (user) => {
  unsub?.(); unsub = null;
  if (user) listen(user); else viewLogin();
});
