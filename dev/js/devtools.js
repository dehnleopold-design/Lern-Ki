// Jelly Developer: Werkzeuge, die es nur unter /dev/ gibt.
//  - Markieren: auf eine Stelle tippen, Notiz dazu schreiben (Fehler / Idee / Design). Die Stelle bekommt eine Nadel.
//  - Liste aller Markierungen, abhaken, als Text kopieren (zum Einfügen in den Chat mit Claude).
//  - Echte Daten kopieren: holt den Stand aus dem echten Jelly auf diesem Gerät hierher (nur lesen, nie zurück).
// Markierungen liegen in users/{uid}/devnotes – auf allen Geräten mit demselben Konto gleich.

import { h, add, icon, toast, confirmDialog } from './ui.js';
import { firebaseApp } from './auth.js';
import { state, replaceState, putBlob } from './store.js';
import { push } from './sync.js';

const V = '10.12.2';
const KINDS = { bug: { emoji: '🐞', label: 'Fehler' }, idea: { emoji: '💡', label: 'Idee' }, design: { emoji: '🎨', label: 'Design' } };
const LOCAL = 'devnotes';

let opts = null;
let notes = [];
let fs = null;
let db = null;
let uid = null;
let pill = null;
let pinLayer = null;

const readLocal = () => { try { return JSON.parse(localStorage.getItem(LOCAL) || '[]'); } catch { return []; } };
const writeLocal = () => { try { localStorage.setItem(LOCAL, JSON.stringify(notes)); } catch {} };
const isDevEl = (el) => !!el?.closest?.('[data-devtool]');
const routeNow = () => { try { return opts.route(); } catch { return ''; } };
const pageTitle = () => (document.querySelector('#app .topbar h1, #app .topbar .title, #app h1')?.textContent || '').trim().slice(0, 60);

export function initDevtools(o) {
  opts = o;
  notes = readLocal();
  document.documentElement.dataset.dev = '';
  pill = h('button', { class: 'dev-pill', 'data-devtool': '', onclick: menu, 'aria-label': 'Jelly Developer' });
  pinLayer = h('div', { class: 'dev-pins', 'data-devtool': '' });
  add(document.body, pinLayer, pill);
  drawPill();
  document.addEventListener('jelly:render', () => requestAnimationFrame(placePins));
  addEventListener('resize', schedulePins);
  addEventListener('scroll', schedulePins, true);
  setInterval(placePins, 1500); // Inhalte, die nachladen, verschieben die Stellen
  connect();
}

// ---------- Speichern: Firestore (live auf allen Geräten), lokal als Rückfall
async function connect() {
  for (let i = 0; i < 40 && !opts.user(); i++) await new Promise((r) => setTimeout(r, 500));
  const u = opts.user();
  if (!u) return;
  uid = u.uid;
  try {
    fs = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`);
    db = fs.getFirestore(firebaseApp());
    // Was offline markiert wurde, jetzt hochladen
    for (const n of notes.filter((x) => x.pending)) await saveRemote(n);
    fs.onSnapshot(fs.collection(db, 'users', uid, 'devnotes'), (snap) => {
      const remote = snap.docs.map((d) => d.data());
      const pending = notes.filter((x) => x.pending && !remote.some((r) => r.id === x.id));
      notes = [...remote, ...pending].sort((a, b) => a.at - b.at);
      writeLocal(); drawPill(); placePins();
      document.dispatchEvent(new Event('devnotes'));
    }, (e) => console.warn('devnotes', e));
  } catch (e) { console.warn('devnotes offline', e); }
}

async function saveRemote(n) {
  if (!db) { n.pending = true; return; }
  const { pending, ...clean } = n;
  try { await fs.setDoc(fs.doc(db, 'users', uid, 'devnotes', n.id), clean); delete n.pending; } catch { n.pending = true; }
}

async function upsert(n) {
  const i = notes.findIndex((x) => x.id === n.id);
  if (i >= 0) notes[i] = n; else notes.push(n);
  writeLocal(); drawPill(); placePins();
  await saveRemote(n);
  writeLocal();
}

async function remove(n) {
  notes = notes.filter((x) => x.id !== n.id);
  writeLocal(); drawPill(); placePins();
  if (db) { try { await fs.deleteDoc(fs.doc(db, 'users', uid, 'devnotes', n.id)); } catch {} }
}

const openNotes = () => notes.filter((n) => !n.done);

function drawPill() {
  const c = openNotes().length;
  pill.replaceChildren(...[h('span', { class: 'dev-pill-tag' }, 'DEV'), c ? h('span', { class: 'dev-pill-count' }, String(c)) : null].filter(Boolean));
}

// ---------- Menü
function menu() {
  const o = opts.sheet('Jelly Developer', [
    h('p', { class: 'muted small' }, `Version ${opts.version} · eigene Testdaten – dein echtes Jelly bleibt unberührt.`),
    row('edit', 'Etwas markieren', 'Auf eine Stelle tippen und notieren, was nicht passt', () => { o.remove(); markMode(); }),
    row('list', 'Markierungen', `${openNotes().length} offen · ${notes.length - openNotes().length} erledigt`, () => { o.remove(); listSheet(); }),
    row('download', 'Echte Daten hierher kopieren', 'Stand des echten Jelly aus deiner Cloud holen (nur lesen)', () => { o.remove(); copyReal(); }),
    row('back', 'Zum echten Jelly', 'Öffnet die normale App', () => { location.href = '../'; }),
  ]);
}

function row(ic, title, sub, onclick) {
  return h('button', { class: 'dev-row', onclick }, icon(ic, 20), h('span', { class: 'dev-row-text' }, h('b', {}, title), h('small', {}, sub)));
}

// ---------- Markieren
function markMode() {
  let target = null;
  let pt = null;
  const box = h('div', { class: 'dev-hl', 'data-devtool': '' });
  const bar = h('div', { class: 'dev-markbar', 'data-devtool': '' },
    h('span', {}, 'Tippe auf die Stelle, die du markieren willst'),
    h('button', { class: 'btn small', onclick: (e) => { e.stopPropagation(); done(); compose(null, null); } }, 'Ganze Seite'),
    h('button', { class: 'btn small ghost', onclick: (e) => { e.stopPropagation(); done(); } }, 'Abbrechen'));
  const layer = h('div', { class: 'dev-marklayer', 'data-devtool': '' });
  const pick = (x, y) => {
    layer.style.pointerEvents = 'none';
    const el = document.elementsFromPoint(x, y).find((e) => !isDevEl(e) && e !== document.body && e !== document.documentElement && e.id !== 'app');
    layer.style.pointerEvents = '';
    return el || null;
  };
  const show = (el) => {
    target = el;
    if (!el) { box.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  };
  layer.addEventListener('pointermove', (e) => show(pick(e.clientX, e.clientY)));
  layer.addEventListener('click', (e) => {
    const el = pick(e.clientX, e.clientY);
    if (!el) return;
    const r = el.getBoundingClientRect();
    pt = { x: r.width ? (e.clientX - r.left) / r.width : 0.5, y: r.height ? (e.clientY - r.top) / r.height : 0.5 };
    done();
    compose(el, pt);
  });
  function done() { layer.remove(); box.remove(); bar.remove(); }
  add(document.body, layer, box, bar);
}

function compose(el, pt, existing = null) {
  let kind = existing?.kind || 'bug';
  let current = el;
  const desc = h('p', { class: 'muted small dev-desc' });
  const hl = h('div', { class: 'dev-hl fixed', 'data-devtool': '' });
  const drawTarget = () => {
    desc.textContent = current ? `Stelle: ${describe(current)}` : existing ? `Stelle: ${existing.label || 'ganze Seite'}` : 'Ganze Seite';
    if (current) { const r = current.getBoundingClientRect(); Object.assign(hl.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` }); } else hl.style.display = 'none';
  };
  const kinds = h('div', { class: 'seg' });
  const drawKinds = () => kinds.replaceChildren(...Object.entries(KINDS).map(([k, v]) => h('button', { class: `seg-btn ${kind === k ? 'active' : ''}`, onclick: () => { kind = k; drawKinds(); } }, `${v.emoji} ${v.label}`)));
  drawKinds();
  const ta = h('textarea', { class: 'input', rows: 4, placeholder: 'Was stimmt hier nicht / was soll anders werden?' });
  ta.value = existing?.text || '';
  const bigger = current?.parentElement && current.parentElement.id !== 'app'
    ? h('button', { class: 'btn small ghost', onclick: () => { if (current?.parentElement && current.parentElement.id !== 'app') { current = current.parentElement; pt = { x: 0.5, y: 0.5 }; drawTarget(); } } }, 'Größeren Bereich wählen')
    : null;
  const o = opts.sheet(existing ? 'Markierung bearbeiten' : 'Neue Markierung', [
    desc, bigger, kinds, ta,
    h('button', { class: 'btn primary block', onclick: async () => {
      const text = ta.value.trim();
      if (!text) { toast('Schreib kurz dazu, was los ist.', 'error'); return; }
      const n = existing ? { ...existing, kind, text } : {
        id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
        kind, text, at: Date.now(), done: false, version: opts.version,
        route: routeNow(), page: pageTitle(),
        sel: current ? selectorOf(current) : '', label: current ? describe(current) : '',
        x: pt?.x ?? 0.5, y: pt?.y ?? 0.5,
        screen: `${innerWidth}×${innerHeight}`,
      };
      close(); await upsert(n); toast('Markiert.', 'ok');
    } }, existing ? 'Speichern' : 'Markieren'),
  ]);
  add(document.body, hl);
  drawTarget();
  const close = () => { o.remove(); hl.remove(); };
  // Schließen über den Hintergrund entfernt auch den Rahmen
  new MutationObserver((_, mo) => { if (!o.isConnected) { hl.remove(); mo.disconnect(); } }).observe(document.body, { childList: true });
  setTimeout(() => ta.focus(), 50);
}

// Kurze, lesbare Beschreibung eines Elements (für die Liste und den Text an Claude)
function describe(el) {
  const text = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim();
  const cls = [...el.classList].filter((c) => !/^(on|active|open|show)$/.test(c)).slice(0, 2).join('.');
  const tag = el.tagName.toLowerCase() + (cls ? `.${cls}` : '');
  return text ? `„${text.slice(0, 50)}${text.length > 50 ? '…' : ''}“ (${tag})` : tag;
}

// CSS-Pfad von #app bis zum Element – damit die Nadel beim nächsten Öffnen wieder an derselben Stelle sitzt
function selectorOf(el) {
  const parts = [];
  for (let e = el; e && e.id !== 'app' && e !== document.body; e = e.parentElement) {
    let p = e.tagName.toLowerCase();
    const cls = [...e.classList].filter((c) => /^[a-z][\w-]*$/i.test(c) && !/^(on|active|open|show|done|busy)$/.test(c)).slice(0, 2);
    if (cls.length) p += `.${cls.join('.')}`;
    const sibs = e.parentElement ? [...e.parentElement.children].filter((s) => s.tagName === e.tagName) : [];
    if (sibs.length > 1) p += `:nth-of-type(${sibs.indexOf(e) + 1})`;
    parts.unshift(p);
  }
  return parts.length ? `#app > ${parts.join(' > ')}` : '';
}

function findEl(n) {
  if (!n.sel) return null;
  try { return document.querySelector(n.sel); } catch { return null; }
}

// ---------- Nadeln an den markierten Stellen
let pinQueued = false;
function schedulePins() { if (pinQueued) return; pinQueued = true; requestAnimationFrame(() => { pinQueued = false; placePins(); }); }

function placePins() {
  if (!pinLayer) return;
  const here = routeNow();
  const pins = [];
  openNotes().forEach((n) => {
    if (n.route !== here || !n.sel) return;
    const el = findEl(n);
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return;
    const x = Math.min(innerWidth - 14, Math.max(14, r.left + r.width * n.x));
    const y = Math.min(innerHeight - 14, Math.max(14, r.top + r.height * n.y));
    if (r.bottom < 0 || r.top > innerHeight) return;
    pins.push(h('button', { class: `dev-pin k-${n.kind}`, style: { left: `${x}px`, top: `${y}px` }, onclick: () => noteSheet(n) }, KINDS[n.kind]?.emoji || '📌'));
  });
  pinLayer.replaceChildren(...pins);
}

function noteSheet(n) {
  const o = opts.sheet(`${KINDS[n.kind]?.emoji || ''} ${KINDS[n.kind]?.label || 'Markierung'}`, [
    h('p', { class: 'dev-note-text' }, n.text),
    h('p', { class: 'muted small' }, `${n.page || n.route} · ${n.label || 'ganze Seite'} · ${new Date(n.at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`),
    h('button', { class: 'btn primary block', onclick: async () => { o.remove(); await upsert({ ...n, done: !n.done, doneAt: n.done ? null : Date.now() }); } }, n.done ? 'Wieder öffnen' : icon('check', 18), n.done ? '' : 'Erledigt'),
    h('button', { class: 'btn block', onclick: () => { o.remove(); compose(findEl(n), { x: n.x, y: n.y }, n); } }, 'Bearbeiten'),
    h('button', { class: 'btn ghost block danger-text', onclick: async () => { if (await confirmDialog('Markierung löschen?', 'Löschen')) { o.remove(); remove(n); } } }, 'Löschen'),
  ]);
}

// ---------- Liste
function listSheet() {
  let filter = 'open';
  const list = h('div', { class: 'dev-list' });
  const seg = h('div', { class: 'seg' });
  const draw = () => {
    seg.replaceChildren(
      h('button', { class: `seg-btn ${filter === 'open' ? 'active' : ''}`, onclick: () => { filter = 'open'; draw(); } }, `Offen (${openNotes().length})`),
      h('button', { class: `seg-btn ${filter === 'done' ? 'active' : ''}`, onclick: () => { filter = 'done'; draw(); } }, `Erledigt (${notes.length - openNotes().length})`));
    const items = notes.filter((n) => (filter === 'open' ? !n.done : n.done)).slice().reverse();
    list.replaceChildren(...(items.length ? items.map((n) => h('button', { class: `dev-item ${n.done ? 'is-done' : ''}`, onclick: () => { o.remove(); noteSheet(n); } },
      h('span', { class: 'dev-item-emoji' }, KINDS[n.kind]?.emoji || '📌'),
      h('span', { class: 'dev-row-text' }, h('b', {}, n.text), h('small', {}, `${n.page || n.route}${n.label ? ` · ${n.label}` : ''}${n.pending ? ' · noch nicht hochgeladen' : ''}`))))
      : [h('p', { class: 'muted' }, filter === 'open' ? 'Nichts offen. Über „Etwas markieren“ kommt etwas dazu.' : 'Noch nichts erledigt.')]));
  };
  const onUpdate = () => { if (o.isConnected) draw(); else document.removeEventListener('devnotes', onUpdate); };
  document.addEventListener('devnotes', onUpdate);
  const o = opts.sheet('Markierungen', [
    seg, list,
    h('button', { class: 'btn primary block', onclick: () => copyText() }, icon('file', 18), 'Offene als Text kopieren (für Claude)'),
    h('button', { class: 'btn block', onclick: () => { o.remove(); markMode(); } }, icon('edit', 18), 'Etwas markieren'),
  ]);
  draw();
}

export function notesText(list = openNotes()) {
  const lines = [`Jelly Developer – ${list.length} offene Markierung${list.length === 1 ? '' : 'en'} (Version ${opts?.version || '?'})`, ''];
  list.forEach((n, i) => {
    lines.push(`${i + 1}. ${KINDS[n.kind]?.emoji || ''} ${KINDS[n.kind]?.label || ''} · Seite: ${n.page || '–'} [${n.route}] · Stelle: ${n.label || 'ganze Seite'}`);
    lines.push(`   ${n.text.replace(/\n/g, '\n   ')}`);
    lines.push(`   (Bildschirm ${n.screen || '?'}, markiert in ${n.version || '?'}${n.sel ? `, Pfad ${n.sel}` : ''})`);
  });
  return lines.join('\n');
}

async function copyText() {
  const text = notesText();
  try { await navigator.clipboard.writeText(text); toast('Kopiert – einfach in den Chat einfügen.', 'ok'); }
  catch {
    if (navigator.share) { try { await navigator.share({ text }); return; } catch {} }
    const ta = h('textarea', { class: 'input', rows: 10 }); ta.value = text;
    opts.sheet('Zum Kopieren', [ta]); ta.select();
  }
}

// ---------- Echte Daten kopieren (nur lesen aus dem echten Jelly, schreiben nur in Developer)
function openReal(name) {
  return new Promise((resolve, reject) => {
    const real = window.__realIDB;
    if (!real) { reject(new Error('Nicht verfügbar.')); return; }
    const req = real.open(name);
    // Gibt es den Speicher nicht, nichts anlegen (sonst wäre das echte Jelly danach kaputt)
    req.onupgradeneeded = () => { try { req.transaction.abort(); } catch {} };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('Im echten Jelly auf diesem Gerät liegen für dieses Konto keine Daten.'));
  });
}
const readStore = (db, store) => new Promise((resolve, reject) => {
  const out = [];
  const r = db.transaction(store, 'readonly').objectStore(store).openCursor();
  r.onsuccess = () => { const c = r.result; if (c) { out.push([c.key, c.value]); c.continue(); } else resolve(out); };
  r.onerror = () => reject(r.error);
});

// Stand des echten Jelly aus der Cloud lesen (users/{uid}/state, blobs, secret) – wird nur gelesen
async function readRealCloud(u) {
  if (!db) throw new Error('Keine Verbindung zur Cloud – bitte gleich nochmal.');
  const ref = (...p) => fs.doc(db, 'users', u.uid, ...p);
  const meta = await fs.getDoc(ref('state', 'meta'));
  if (!meta.exists()) return null;
  const m = meta.data();
  const parts = [];
  for (let i = 0; i < m.n; i++) {
    const c = await fs.getDoc(ref('state', `c${i}`));
    if (!c.exists()) throw new Error('Der Stand in der Cloud ist unvollständig.');
    parts.push(c.data().d);
  }
  const st = JSON.parse(parts.join(''));
  try {
    const k = await fs.getDoc(ref('secret', 'keys'));
    if (k.exists()) {
      const keys = k.data();
      st.settings = { ...(st.settings || {}), apiKey: keys.apiKey || st.settings?.apiKey || '', oaKey: keys.oaKey || st.settings?.oaKey || '' };
      if (st.settings.fb) st.settings.fb = { ...st.settings.fb, key: keys.fbKey || st.settings.fb.key || '' };
    }
  } catch {}
  const blobs = [];
  for (const [id, n] of Object.entries(m.blobs || {})) {
    if (!st.files?.[id]) continue;
    const pieces = [];
    let mime = '';
    for (let i = 0; i < n; i++) {
      const b = await fs.getDoc(ref('blobs', `${id}_${i}`));
      if (!b.exists()) { pieces.length = 0; break; }
      mime = b.data().mime;
      pieces.push(b.data().d);
    }
    if (pieces.length) blobs.push([id, { mime, data: pieces.join('') }]);
  }
  return { state: st, blobs };
}

// Rückfall: Speicher des echten Jelly auf diesem Gerät (geht im Browser, nicht zwischen zwei Home-Bildschirm-Apps)
async function readRealLocal(u) {
  const real = await openReal(`lernki-u-${u.uid}`);
  const kv = Object.fromEntries(await readStore(real, 'kv'));
  const blobs = await readStore(real, 'blobs');
  real.close();
  return kv.state?.profile ? { state: kv.state, blobs } : null;
}

async function copyReal() {
  const u = opts.user();
  if (!u) { toast('Erst anmelden.', 'error'); return; }
  if (!(await confirmDialog('Den Stand aus deinem echten Jelly hierher kopieren? Was du in Developer bisher getestet hast, wird dabei ersetzt. Dein echtes Jelly wird nur gelesen, nicht verändert.', 'Kopieren', 'Abbrechen', 'primary'))) return;
  const wait = h('div', { class: 'overlay', 'data-devtool': '' }, h('div', { class: 'sheet' }, h('div', { class: 'sheet-title' }, 'Kopiere …'), h('p', { class: 'muted' }, 'Lade deinen Stand und deine Dateien aus der Cloud. Das kann bei vielen Fotos eine Minute dauern.')));
  add(document.body, wait);
  try {
    for (let i = 0; i < 20 && !db; i++) await new Promise((r) => setTimeout(r, 500));
    let src = null;
    try { src = await readRealCloud(u); } catch (e) { console.warn('Cloud', e); }
    if (!src) { try { src = await readRealLocal(u); } catch {} }
    if (!src?.state?.profile) throw new Error('Für dieses Konto gibt es noch keinen Stand im echten Jelly (weder in der Cloud noch auf diesem Gerät).');
    for (const [id, v] of src.blobs) await putBlob(id, v);
    const keep = state.settings || {};
    const next = src.state;
    if (keep.apiKey && !next.settings?.apiKey) next.settings = { ...(next.settings || {}), apiKey: keep.apiKey };
    replaceState(next);
    await push(true, true);
    wait.remove();
    toast(`Kopiert (${src.blobs.length} Datei${src.blobs.length === 1 ? '' : 'en'}).`, 'ok');
    setTimeout(() => location.reload(), 700);
  } catch (e) { wait.remove(); toast(e.message || 'Kopieren hat nicht geklappt.', 'error'); }
}
