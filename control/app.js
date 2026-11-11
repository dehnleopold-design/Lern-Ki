// Jelly Control – Übersicht aller Jelly-Konten (nur Kennzahlen aus userIndex/{uid}, keine Lerninhalte).
// Lesen darf nur das Admin-Konto; das legen die Firestore-Regeln fest (siehe Einrichtung in dieser App).

import { firebaseConfig } from '../js/firebase-config.js';
import { md } from '../js/ui.js';
import { SHEET_CSS } from '../js/pdf.js';
import { rulesText as buildRules } from './rules.js';

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
let invites = [], licenses = {}, protectOn = null, partners = []; // Code-Schutz
let unsubs = [];
const ui = { q: '', sort: 'seen' };
let viewing = null; // uid, dessen Inhalte gerade angezeigt werden
{ const st = document.createElement('style'); st.textContent = SHEET_CSS; document.head.append(st); }

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
  back: '<path d="m15 18-6-6 6-6"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
  share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
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

// Admins = dieses Konto + eingetragene Partner (auch lokal gemerkt, falls control/admins noch nicht lesbar ist)
function adminList(uid) {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem('control-partners') || '[]'); } catch {}
  return [uid, ...partners, ...saved];
}
const rulesText = (uid) => buildRules(adminList(uid));

function viewSetup(user, update = false) {
  const text = rulesText(user.uid);
  root.replaceChildren(h('div', { class: 'center-screen' },
    h('div', { class: 'logo big' }),
    h('h1', {}, update ? 'Regeln ergänzen' : 'Noch eine Freigabe'),
    h('p', { class: 'muted' }, update ? 'Für den Code-Schutz, Partner und das Ansehen von Inhalten brauchen die Firestore-Regeln eine Aktualisierung. Bestehende Konten bleiben freigeschaltet.' : `Angemeldet als ${user.email || user.uid}. Damit nur du die Übersicht sehen kannst, müssen die Firestore-Regeln einmal ergänzt werden.`),
    !update ? h('p', { class: 'muted small' }, 'Du bist Partner? Dann musst du nichts einfügen – schick einfach deine Konto-ID an den Haupt-Admin: ',
      h('button', { class: 'chip', onclick: async () => { try { await navigator.clipboard.writeText(user.uid); toast('ID kopiert'); } catch { toast(user.uid); } } }, user.uid)) : null,
    h('ol', { class: 'steps' },
      h('li', {}, 'Regeln unten kopieren.'),
      h('li', {}, h('a', { href: 'https://console.firebase.google.com/project/jelly-721e4/firestore/rules', target: '_blank', rel: 'noopener' }, 'Firestore → Regeln'), ' öffnen, alles markieren, durch die kopierten Regeln ersetzen und „Veröffentlichen“ tippen.'),
      h('li', {}, 'Hier „Erneut prüfen“ tippen.')),
    h('pre', { class: 'code' }, text),
    h('div', { class: 'stack' },
      h('button', { class: 'btn primary block', onclick: async () => { try { await navigator.clipboard.writeText(text); toast('Regeln kopiert'); } catch { toast('Kopieren nicht erlaubt – bitte markieren und kopieren.'); } } }, icon('copy'), 'Regeln kopieren'),
      h('button', { class: 'btn block', onclick: () => (update && viewing ? openContent(viewing) : listen(user)) }, update ? 'Fertig – zurück' : 'Erneut prüfen'),
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
    protectSection(user),
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
    licenses[u.uid]?.revoked ? h('span', { class: 'tag bad' }, 'gesperrt') : null,
    h('span', { class: `state ${online(u) ? 'online' : ''}` }, online(u) ? 'online' : ago(u.lastSeen)));
}

function detail(u) {
  const c = u.counts || {};
  const close = () => { ov.remove(); if (!viewing) viewDashboard(auth.currentUser); };
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
      accessBlock(u, close),
      h('button', { class: 'btn primary block', style: 'margin-bottom:10px', onclick: () => { close(); openContent(u); } }, 'Inhalte ansehen'),
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
  unsubs.forEach((f) => f()); unsubs = [];
  const redraw = () => { if (!document.querySelector('.overlay') && !viewing && users.loaded) viewDashboard(user); };
  // Code-Schutz: klappt das Lesen der Codes nicht, sind die Regeln noch alt
  unsubs.push(F.onSnapshot(F.collection(db, 'invites'), (snap) => {
    protectOn = true;
    invites = snap.docs.map((d) => ({ code: d.id, ...d.data() })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    redraw();
  }, () => { protectOn = false; redraw(); }));
  unsubs.push(F.onSnapshot(F.collection(db, 'licenses'), (snap) => {
    licenses = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
    redraw();
  }, () => {}));
  unsubs.push(F.onSnapshot(F.doc(db, 'control', 'admins'), (d) => {
    partners = d.data()?.uids || [];
    try { localStorage.setItem('control-partners', JSON.stringify(partners)); } catch {}
    redraw();
  }, () => {}));
  unsub = F.onSnapshot(F.collection(db, 'userIndex'), (snap) => {
    users = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    users.loaded = true;
    redraw();
  }, (e) => {
    if (e.code === 'permission-denied') viewSetup(user);
    else root.replaceChildren(h('div', { class: 'center-screen' }, h('div', { class: 'logo big' }), h('p', {}, `Fehler: ${e.message}`), h('button', { class: 'btn', onclick: () => listen(user) }, 'Nochmal')));
  });
}

A.onAuthStateChanged(auth, (user) => {
  unsub?.(); unsub = null; unsubs.forEach((f) => f()); unsubs = [];
  if (user) listen(user); else viewLogin();
});

// ================================================================ Inhalte eines Kontos (nur lesen)
const userDoc = (uid, ...p) => F.doc(db, 'users', uid, ...p);

async function loadState(uid) {
  const meta = await F.getDoc(userDoc(uid, 'state', 'meta'));
  if (!meta.exists()) return null;
  const m = meta.data();
  const parts = [];
  for (let i = 0; i < m.n; i++) parts.push((await F.getDoc(userDoc(uid, 'state', `c${i}`))).data()?.d || '');
  const st = JSON.parse(parts.join(''));
  delete st.settings; // Einstellungen (bei alten Ständen noch mit Schlüssel) werden nie angezeigt
  return { meta: m, st };
}

async function loadBlob(uid, meta, fid) {
  const n = meta.blobs?.[fid];
  if (!n) return null;
  let mime = '', data = '';
  for (let i = 0; i < n; i++) { const b = (await F.getDoc(userDoc(uid, 'blobs', `${fid}_${i}`))).data(); if (!b) return null; mime = b.mime; data += b.d; }
  return { mime, data };
}

const htmlBox = (markdown, cls = 'md-box') => { const d = h('div', { class: cls }); d.innerHTML = md(markdown || ''); return d; };
const paper = (markdown) => { const d = h('div', { class: 'sheet-doc paper' }); d.innerHTML = md(markdown || ''); return d; };

function bigSheet(title, ...content) {
  const close = () => ov.remove();
  const ov = h('div', { class: 'overlay', onclick: (e) => { if (e.target === ov) close(); } },
    h('div', { class: 'sheet wide' }, h('div', { class: 'sheet-head' }, h('div', { style: 'flex:1;min-width:0;font-weight:800;font-size:1.1rem' }, title), h('button', { class: 'iconbtn', 'aria-label': 'Schließen', onclick: close }, icon('close'))), ...content));
  document.body.append(ov);
}

async function openContent(u) {
  viewing = u;
  root.replaceChildren(h('div', { class: 'center-screen' }, h('div', { class: 'logo big' }), h('p', { class: 'muted' }, `Lade Inhalte von ${u.name || u.email} …`)));
  let data;
  try { data = await loadState(u.uid); } catch (e) {
    if (e.code === 'permission-denied') { viewSetup(auth.currentUser, true); return; }
    root.replaceChildren(h('div', { class: 'center-screen' }, h('p', {}, `Fehler: ${e.message}`), h('button', { class: 'btn', onclick: () => { viewing = null; listen(auth.currentUser); } }, 'Zurück')));
    return;
  }
  if (!data) { toast('Dieses Konto hat noch nichts in der Cloud.'); viewing = null; viewDashboard(auth.currentUser); return; }
  ui.ctab ??= 'exams';
  drawContent(u, data);
}

function drawContent(u, { meta, st }) {
  const subj = (id) => (st.subjects || []).find((s) => s.id === id);
  const tabs = [['exams', 'Klausuren'], ['subjects', 'Fächer'], ['vocab', 'Vokabeln'], ['solved', 'Blätter'], ['plan', 'Stundenplan'], ['files', 'Dateien']];
  const body = h('div', { class: 'list' });
  const card = (title, sub, onclick) => h('button', { class: 'user', onclick }, h('div', { class: 'txt' }, h('div', { class: 'name' }, title), sub ? h('div', { class: 'sub' }, sub) : null));
  const fill = () => {
    const t = ui.ctab;
    let items = [];
    if (t === 'exams') {
      items = (st.exams || []).map((e) => {
        const units = (e.plan?.abschnitte || []).flatMap((a) => a.einheiten || []);
        return h('div', { class: 'exam-box' },
          h('div', { class: 'name' }, `${subj(e.subjectId)?.name || 'Fach'}${e.date ? ` · ${new Date(e.date).toLocaleDateString('de-DE')}` : ''}`),
          h('div', { class: 'sub muted small' }, [e.plan?.themen?.length ? `${e.plan.themen.length} Themen` : 'noch kein Plan', e.topicsText ? `Notizen: ${e.topicsText.slice(0, 120)}` : ''].filter(Boolean).join(' · ')),
          h('div', { class: 'unit-list' }, units.map((un) => {
            const sess = st.sessions?.[un.id];
            const done = sess && (sess.lernzettel || sess.fragen || sess.aufgaben);
            return h('button', { class: `unit ${done ? '' : 'missing'}`, onclick: () => done && showUnit(un, sess, e) }, un.titel, un.status === 'done' ? ' ✓' : un.status === 'skipped' ? ' (übersprungen)' : '', done ? '' : ' – noch leer');
          })));
      });
    } else if (t === 'subjects') {
      items = (st.subjects || []).map((s) => card(s.name, [s.teacher, s.teacherProfile ? 'Lehrerprofil vorhanden' : 'kein Lehrerprofil', s.teacherNotes ? 'Notizen' : ''].filter(Boolean).join(' · '),
        () => bigSheet(s.name, s.teacherNotes ? [h('h3', {}, 'Notizen zur Lehrkraft'), h('p', {}, s.teacherNotes)] : null, h('h3', {}, 'Lehrerprofil'), s.teacherProfile ? htmlBox(s.teacherProfile) : h('p', { class: 'muted' }, 'Keins.'))));
    } else if (t === 'vocab') {
      items = (st.vocab?.sets || []).map((v) => card(v.titel, `${v.sprache || ''} · ${(v.words || []).length} Vokabeln${v.testDate ? ` · Test ${new Date(v.testDate).toLocaleDateString('de-DE')}` : ''}`,
        () => bigSheet(v.titel, h('table', { class: 'tbl' }, h('tbody', {}, (v.words || []).map((w) => h('tr', {}, h('td', {}, w.w), h('td', {}, w.t), h('td', { class: 'muted' }, `Stufe ${w.box || 0}`))))))));
    } else if (t === 'solved') {
      items = (st.solved || []).map((x) => card(x.titel, x.ersteAufgabe || (x.links || []).join(' '), () => bigSheet(x.titel, x.loesung ? paper(x.loesung) : h('p', { class: 'muted' }, 'Noch nicht gelöst.'))));
    } else if (t === 'plan') {
      const L = st.timetable?.lessons || [];
      const days = ['Mo', 'Di', 'Mi', 'Do', 'Fr'];
      items = L.length ? [h('table', { class: 'tbl' }, h('tbody', {}, days.map((d, i) => h('tr', {}, h('th', {}, d), h('td', {}, L.filter((l) => l.day === i + 1).sort((a, b) => a.slot - b.slot).map((l) => `${l.slot}. ${subj(l.subjectId)?.name || l.fach}${l.room ? ` (${l.room})` : ''}`).join(' · ') || '–')))))]
        : [h('div', { class: 'empty' }, 'Kein Stundenplan.')];
      const ex = st.examPlan?.items || [];
      if (ex.length) items.push(h('h3', {}, 'Termine'), ...ex.sort((a, b) => a.date.localeCompare(b.date)).map((x) => card(`${subj(x.subjectId)?.name || x.fach} · ${x.art}`, [new Date(x.date).toLocaleDateString('de-DE'), x.thema, x.notiz].filter(Boolean).join(' · '))));
    } else if (t === 'files') {
      items = Object.values(st.files || {}).filter((f) => !f.group || f.group === f.id).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).map((f) => card(f.digest?.titel || f.name, [f.kind, f.mime === 'application/pdf' ? 'PDF' : 'Foto', f.addedAt ? new Date(f.addedAt).toLocaleDateString('de-DE') : ''].join(' · '), async () => {
        const ids = Object.values(st.files).filter((x) => (x.group || x.id) === (f.group || f.id)).map((x) => x.id);
        const blobs = (await Promise.all(ids.map((id) => loadBlob(u.uid, meta, id)))).filter(Boolean);
        if (!blobs.length) return toast('Datei ist nicht in der Cloud.');
        if (blobs[0].mime === 'application/pdf') {
          const bytes = Uint8Array.from(atob(blobs[0].data), (c) => c.charCodeAt(0));
          window.open(URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })), '_blank');
          return;
        }
        bigSheet(f.digest?.titel || f.name, blobs.map((b) => h('img', { class: 'full-img', src: `data:${b.mime};base64,${b.data}` })));
      }));
    }
    body.replaceChildren(...(items.length ? items : [h('div', { class: 'empty' }, 'Nichts vorhanden.')]));
  };
  const seg = h('div', { class: 'ctabs' }, tabs.map(([k, l]) => h('button', { class: `ctab ${ui.ctab === k ? 'on' : ''}`, onclick: () => { ui.ctab = k; drawContent(u, { meta, st }); } }, l)));
  fill();
  root.replaceChildren(h('div', { class: 'wrap' },
    h('header', { class: 'top' }, h('button', { class: 'iconbtn', 'aria-label': 'Zurück', onclick: () => { viewing = null; viewDashboard(auth.currentUser); } }, icon('back')),
      h('div', { style: 'flex:1;min-width:0' }, h('h1', {}, u.name || u.email), h('div', { class: 'who' }, `Stand vom ${new Date(meta.updatedAt).toLocaleString('de-DE')} · nur lesen`))),
    seg, body));
}

function showUnit(un, sess, exam) {
  if (sess.lernzettel) return bigSheet(un.titel, paper(sess.lernzettel));
  if (sess.fragen) {
    return bigSheet(un.titel, h('ol', { class: 'qlist' }, sess.fragen.map((q, i) => {
      const a = sess.antworten?.[i];
      const right = q.typ === 'mc' ? q.optionen?.[q.richtig] : q.typ === 'wahrfalsch' ? (q.richtig ? 'Wahr' : 'Falsch') : (q.antworten || [])[0];
      return h('li', {}, h('div', {}, q.frage), h('div', { class: 'small' }, h('b', {}, `Richtig: ${right}`), a ? ` · Antwort: ${a.label ?? '–'} ${a.correct ? '✓' : '✗'}` : ' · nicht beantwortet'));
    })));
  }
  const g = sess.grading;
  return bigSheet(un.titel,
    g ? h('p', {}, h('b', {}, `${g.got}/${g.max} Punkte (${g.percent} %) · Note ≈ ${g.grade}`)) : h('p', { class: 'muted' }, 'Noch nicht abgegeben.'),
    (sess.aufgaben || []).map((a, i) => {
      const r = g?.ergebnisse?.find((x) => x.id === a.id);
      return h('div', { class: 'task-box' },
        h('div', { class: 'name' }, `Aufgabe ${i + 1}${a.punkte ? ` (${a.punkte} P.)` : ''}`), htmlBox(a.aufgabe),
        a.material ? htmlBox(a.material, 'md-box material') : null,
        h('div', { class: 'label' }, 'Antwort'), h('p', {}, sess.answers?.[a.id] || '–'),
        r ? [h('div', { class: 'label' }, `Bewertung: ${r.punkte}/${r.maxPunkte}`), htmlBox(r.feedback || '')] : null);
    }));
}

// ================================================================ Code-Schutz
// Ohne Server lässt sich der Schutz nur über die Firestore-Regeln durchsetzen:
// Neue Konten können erst synchronisieren, wenn sie einen Einmal-Code eingelöst haben (oder hier freigeschaltet wurden).
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne 0/O, 1/I
function newCode() {
  const r = crypto.getRandomValues(new Uint32Array(8));
  const c = [...r].map((x) => ALPHA[x % ALPHA.length]).join('');
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

async function shareCode(code, note) {
  const text = `Dein Zugangscode für Jelly: ${code}\n${location.origin}${location.pathname.replace(/control\/.*$/, '')}\nDer Code funktioniert nur einmal und nur für dein Konto.`;
  try { if (navigator.share) { await navigator.share({ text }); return; } } catch { return; }
  try { await navigator.clipboard.writeText(text); toast('Code und Link kopiert'); } catch { toast(code); }
}

function protectSection(user) {
  if (protectOn === false) {
    return h('section', { class: 'protect warn' },
      h('div', { class: 'protect-head' }, icon('key'), h('b', {}, 'Code-Schutz ist noch aus')),
      h('p', { class: 'muted small' }, 'Aktiviere ihn, indem du die Firestore-Regeln einmal aktualisierst. Alle Konten, die schon Daten in der Cloud haben, bleiben automatisch freigeschaltet.'),
      h('button', { class: 'btn primary block', onclick: () => viewSetup(user, true) }, 'Regeln aktualisieren'));
  }
  if (protectOn !== true) return null;
  const open = invites.filter((i) => !i.usedBy);
  const used = invites.filter((i) => i.usedBy);
  const nameOf = (uid) => { const u = users.find((x) => x.uid === uid); return u ? (u.name || u.email) : null; };
  const row = (i) => h('div', { class: 'code-row' },
    h('div', { class: 'txt' }, h('div', { class: 'code-val' }, i.code), h('div', { class: 'sub' }, i.usedBy ? `eingelöst von ${nameOf(i.usedBy) || i.usedEmail || 'Konto'} · ${fmt(i.usedAt)}` : [i.note, `erstellt ${fmt(i.createdAt)}`].filter(Boolean).join(' · '))),
    i.usedBy ? null : h('button', { class: 'iconbtn', 'aria-label': 'Teilen', title: 'Teilen / kopieren', onclick: () => shareCode(i.code, i.note) }, icon('share')),
    i.usedBy ? null : h('button', { class: 'iconbtn', 'aria-label': 'Löschen', title: 'Code löschen', onclick: async () => { if (confirm(`Code ${i.code} löschen?`)) await F.deleteDoc(F.doc(db, 'invites', i.code)).catch(() => toast('Löschen fehlgeschlagen.')); } }, icon('trash')));
  return h('section', { class: 'protect' },
    h('div', { class: 'protect-head' }, icon('key'), h('b', { style: 'flex:1' }, 'Zugangscodes'), h('span', { class: 'chip' }, 'Schutz aktiv')),
    h('p', { class: 'muted small' }, 'Neue Konten brauchen einen Code. Jeder Code klappt genau einmal und ist danach an das Konto gebunden.'),
    h('button', { class: 'btn primary block', onclick: async () => {
      const note = prompt('Für wen ist der Code? (optional, nur für dich)') ?? null;
      if (note === null) return;
      const code = newCode();
      try {
        await F.setDoc(F.doc(db, 'invites', code), { usedBy: null, createdAt: Date.now(), createdBy: user.uid, note: note.trim() });
        shareCode(code, note);
      } catch { toast('Code konnte nicht erstellt werden.'); }
    } }, '+ Neuer Code'),
    open.length ? [h('div', { class: 'label' }, `Offen (${open.length})`), h('div', { class: 'list' }, open.map(row))] : null,
    used.length ? h('details', {}, h('summary', { class: 'label' }, `Eingelöst (${used.length})`), h('div', { class: 'list' }, used.map(row))) : null,
    h('details', { class: 'partners' }, h('summary', { class: 'label' }, `Partner mit Control-Zugriff (${partners.length})`),
      h('p', { class: 'muted small' }, 'Der Partner öffnet Control, meldet sich an und schickt dir die angezeigte Konto-ID. Danach die Regeln einmal aktualisieren.'),
      partners.map((p) => h('div', { class: 'code-row' }, h('div', { class: 'txt' }, h('div', { class: 'sub' }, nameOf(p) || p)),
        h('button', { class: 'iconbtn', 'aria-label': 'Entfernen', onclick: async () => {
          if (!confirm('Partner entfernen? Danach die Regeln aktualisieren.')) return;
          await F.setDoc(F.doc(db, 'control', 'admins'), { uids: partners.filter((x) => x !== p) });
          viewSetup(user, true);
        } }, icon('trash')))),
      h('button', { class: 'btn block', onclick: async () => {
        const id = (prompt('Konto-ID des Partners:') || '').trim();
        if (!/^[A-Za-z0-9]{20,40}$/.test(id)) { if (id) toast('Das sieht nicht wie eine Konto-ID aus.'); return; }
        const next = [...new Set([...partners, id])];
        try { await F.setDoc(F.doc(db, 'control', 'admins'), { uids: next }); } catch {}
        partners = next;
        try { localStorage.setItem('control-partners', JSON.stringify(next)); } catch {}
        viewSetup(user, true);
      } }, 'Partner hinzufügen')));
}

// Zugang eines Kontos im Detailblatt
function accessBlock(u, close) {
  if (protectOn !== true) return null;
  const lic = licenses[u.uid];
  const status = h('span', {}, '…');
  const set = async (data, msg) => { try { await F.setDoc(F.doc(db, 'licenses', u.uid), { ...data, by: auth.currentUser.uid, changedAt: Date.now() }, { merge: true }); toast(msg); close(); } catch { toast('Ändern nicht erlaubt.'); } };
  const btns = h('div', { class: 'row-btns' });
  if (lic?.revoked) {
    status.textContent = 'Gesperrt';
    btns.append(h('button', { class: 'btn block', onclick: () => set({ revoked: false }, 'Wieder freigeschaltet') }, 'Entsperren'));
  } else if (lic) {
    status.textContent = lic.code && lic.code !== 'control' ? `Freigeschaltet mit Code ${lic.code}` : 'Freigeschaltet (von Control)';
    btns.append(h('button', { class: 'btn block danger', onclick: () => confirm('Zugang sperren? Das Konto kann dann nicht mehr synchronisieren und Jelly nicht mehr öffnen.') && set({ revoked: true }, 'Gesperrt') }, 'Sperren'));
  } else {
    // Bestandskonto (Stand in der Cloud) oder ohne Zugang
    F.getDoc(F.doc(db, 'users', u.uid, 'state', 'meta')).then((m) => {
      status.textContent = m.exists() ? 'Bestandskonto (automatisch frei)' : 'Kein Zugang – noch kein Code eingelöst';
      btns.replaceChildren(m.exists()
        ? h('button', { class: 'btn block danger', onclick: () => confirm('Zugang sperren?') && set({ revoked: true }, 'Gesperrt') }, 'Sperren')
        : h('button', { class: 'btn block', onclick: () => set({ code: 'control', at: Date.now() }, 'Freigeschaltet') }, 'Ohne Code freischalten'));
    }).catch(() => { status.textContent = 'unbekannt'; });
  }
  return h('div', { class: 'access' }, h('div', { class: 'label' }, 'Zugang'), h('div', { style: 'margin:4px 0 8px;font-weight:600' }, status), btns);
}
