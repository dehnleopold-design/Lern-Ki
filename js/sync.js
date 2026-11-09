// Synchronisierung zwischen Geräten über Firestore (kostenloser Spark-Tarif).
// Gespeichert wird unter users/{uid}/… – die Sicherheitsregeln erlauben nur dem Konto selbst den Zugriff.
//
//  users/{uid}/state/meta   { updatedAt, n, device, blobs: { fileId: Anzahl Stücke } }
//  users/{uid}/state/c0..cN  der gesamte App-Stand als JSON, in Stücke zerlegt (Firestore-Limit 1 MB pro Dokument)
//  users/{uid}/blobs/{fileId}_{i}  Fotos/PDFs als Base64-Stücke
//
// Prinzip: Der neuere Stand gewinnt. Änderungen werden nach ein paar Sekunden hochgeladen;
// beim Öffnen und beim Zurückkehren in die App wird geprüft, ob ein anderes Gerät etwas Neueres hat.

import { state, save, onChange, applyRemoteState, kvGet, kvPut, getBlob, putBlob, blobKeys } from './store.js';
import { allUnits, applyOps } from './gen.js';
import { firebaseApp } from './auth.js';
import { backgroundFunctions } from './firebase-config.js';

const V = '10.12.2';
const CHUNK = 900000; // Zeichen pro Dokument (unter dem 1-MB-Limit)
let fs = null;
let db = null;
let uid = null;
let pushTimer = null;
let pushing = false;
let local = { base: 0, dirty: false, dirtyAt: 0 };
let onApplied = null;
let onConflict = null;
let statusListener = null;
let bgListener = null;
let bgDocs = [];

export const syncStatus = { state: 'aus', at: 0, error: '' };
const setStatus = (st, error = '') => { syncStatus.state = st; syncStatus.error = error; if (st === 'ok') syncStatus.at = Date.now(); try { statusListener?.(); } catch {} };
export function onSyncStatus(fn) { statusListener = fn; }

function deviceId() {
  try {
    let d = localStorage.getItem('lernki-device');
    if (!d) { d = Math.random().toString(36).slice(2, 10); localStorage.setItem('lernki-device', d); }
    return d;
  } catch { return 'x'; }
}

const metaRef = () => fs.doc(db, 'users', uid, 'state', 'meta');
// KI-Schlüssel liegen getrennt vom Stand (users/{uid}/secret/keys). Den Stand darf auch Control lesen, die Schlüssel nicht.
const secretRef = () => fs.doc(db, 'users', uid, 'secret', 'keys');
const keysOf = (st) => ({ apiKey: st.settings?.apiKey || '', oaKey: st.settings?.oaKey || '', fbKey: st.settings?.fb?.key || '' });
function withoutKeys(st) {
  const s = st.settings || {};
  return { ...st, settings: { ...s, apiKey: '', oaKey: '', ...(s.fb ? { fb: { ...s.fb, key: '' } } : {}) } };
}
async function readKeys() {
  try { const d = await fs.getDoc(secretRef()); return d.exists() ? d.data() : null; } catch { return null; }
}
// Schlüssel in einen geladenen Stand einsetzen: aus der Cloud, sonst die, die auf diesem Gerät schon da sind
function putKeys(next, keys) {
  const own = keysOf(state);
  const k = { apiKey: keys?.apiKey || next.settings?.apiKey || own.apiKey, oaKey: keys?.oaKey || next.settings?.oaKey || own.oaKey, fbKey: keys?.fbKey || next.settings?.fb?.key || own.fbKey };
  next.settings = { ...(next.settings || {}), apiKey: k.apiKey, oaKey: k.oaKey };
  if (next.settings.fb) next.settings.fb = { ...next.settings.fb, key: k.fbKey };
  return next;
}
const chunkRef = (i) => fs.doc(db, 'users', uid, 'state', `c${i}`);
const blobRef = (id, i) => fs.doc(db, 'users', uid, 'blobs', `${id}_${i}`);
const jobRef = (examId) => fs.doc(db, 'users', uid, 'bgjobs', examId);
const resultsCol = () => fs.collection(db, 'users', uid, 'bgresults');
const presenceRef = () => fs.doc(db, 'users', uid, 'bgpresence', 'app');

// Solange die App offen ist, pausiert der Hintergrund-Dienst (sonst teilen sich beide die Gratis-Limits).
function heartbeat(open) {
  if (!db || !backgroundFunctions) return;
  fs.setDoc(presenceRef(), { until: open ? Date.now() + 4 * 60000 : 0 }).catch(() => {});
}

async function saveLocalMeta() { await kvPut('sync', local); }

function friendly(e) {
  const code = e?.code || '';
  if (/has not been used|is disabled|SERVICE_DISABLED/i.test(e?.message || '')) return 'Firestore ist im Firebase-Projekt noch nicht eingeschaltet – der Abgleich startet, sobald es aktiv ist.';
  if (code === 'permission-denied') return 'Keine Berechtigung – sind die Firestore-Regeln veröffentlicht?';
  if (code === 'not-found' || /database .* does not exist|NOT_FOUND/i.test(e?.message || '')) return 'Firestore ist im Firebase-Projekt noch nicht eingerichtet.';
  if (code === 'unavailable') return 'Offline – wird später synchronisiert.';
  if (code === 'resource-exhausted') return 'Tageslimit des kostenlosen Firebase-Tarifs erreicht.';
  return e?.message || 'Unbekannter Fehler';
}

// Kontoübersicht für die Control-App: nur Kennzahlen, keine Lerninhalte (userIndex/{uid}).
// Höchstens alle 15 Minuten, beim Öffnen der App.
let indexUser = null;
let indexInfo = null;
function deviceType() {
  const ua = navigator.userAgent || '';
  const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  const kind = /iPad/.test(ua) || touchMac ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Computer';
  const app = matchMedia?.('(display-mode: standalone)').matches || navigator.standalone ? 'App' : 'Browser';
  return `${kind} · ${app}`;
}
export async function writeIndex(force = false) {
  if (!db || !indexUser) return;
  const key = `lernki-index-${indexUser.uid}`;
  try { if (!force && Date.now() - Number(localStorage.getItem(key) || 0) < 15 * 60000) return; } catch {}
  const u = indexUser;
  const doc = {
    uid: u.uid, email: u.email || '', name: u.displayName || state.profile?.name || '',
    provider: u.providerData?.[0]?.providerId || 'password',
    createdAt: Date.parse(u.metadata?.creationTime || '') || null,
    lastSeen: Date.now(), device: deviceType(), devices: { [deviceId()]: deviceType() },
    ...(indexInfo ? indexInfo() : {}),
  };
  try {
    await fs.setDoc(fs.doc(db, 'userIndex', u.uid), doc, { merge: true });
    try { localStorage.setItem(key, String(Date.now())); } catch {}
  } catch { /* Regeln noch nicht freigegeben – egal, die App funktioniert trotzdem */ }
}

export async function startSync(user, { onRemoteApplied, onConflict: conflictFn, onBackground, info } = {}) {
  indexUser = user;
  indexInfo = info || null;
  onApplied = onRemoteApplied;
  bgListener = onBackground;
  onConflict = conflictFn;
  uid = user.uid;
  try {
    fs = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`);
    db = fs.getFirestore(firebaseApp());
  } catch (e) { setStatus('fehler', 'Sync-Bibliothek nicht geladen (offline?)'); return; }
  local = Object.assign({ base: 0, dirty: false, dirtyAt: 0 }, await kvGet('sync'));
  onChange(() => {
    local.dirty = true;
    local.dirtyAt = Date.now();
    kvPut('sync', local).catch(() => {});
    schedulePush();
  });
  addEventListener('online', () => syncNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { heartbeat(true); syncNow(); writeIndex().catch(() => {}); }
    else { heartbeat(false); if (local.dirty) push().catch(() => {}); }
  });
  await syncNow(true);
  heartbeat(true);
  writeIndex().catch(() => {});
  setInterval(() => { if (document.visibilityState === 'visible') heartbeat(true); }, 2 * 60000);
  // Fertige Inhalte vom Hintergrund-Dienst sofort übernehmen, sobald sie da sind
  try { fs.onSnapshot(resultsCol(), (snap) => { bgDocs = snap.docs; applyBackground(); }, () => {}); } catch {}
}

// Ein Ergebnis des Hintergrund-Dienstes in Änderungen am Stand übersetzen.
function resultOps(d) {
  const r = d.data() || {};
  if (r.ops) { try { return { ops: JSON.parse(r.ops), require: r.require ? JSON.parse(r.require) : null, label: r.label || '' }; } catch { return null; } }
  // ältere Form: nur eine Lerneinheit
  if (r.data) {
    const exam = state.exams.find((x) => x.id === r.examId);
    if (!exam || !allUnits(exam).some((u) => u.id === d.id)) return { ops: [] };
    try { return { ops: [{ path: ['sessions', d.id], value: JSON.parse(r.data), onlyIfEmpty: true }], label: 'Inhalt' }; } catch { return null; }
  }
  return null;
}

// Ergebnisse des Hintergrund-Dienstes in den Stand übernehmen. Gelöscht werden sie erst,
// wenn der Stand mit ihnen hochgeladen ist (sonst könnten sie bei einem Abgleich verloren gehen).
function applyBackground() {
  if (!db || !bgDocs.length) return;
  const added = [];
  for (const d of bgDocs) {
    const r = resultOps(d);
    if (r && applyOps(state, r.ops, r.require)) added.push({ id: d.id, label: r.label });
    else if (!local.dirty && !pushing) fs.deleteDoc(d.ref).catch(() => {});
  }
  if (added.length) { save(); try { bgListener?.(added); } catch {} }
}

// Auftrag an den Hintergrund-Dienst. job: { key, type, id }
export async function requestJob(job) {
  if (!db || !backgroundFunctions) return false;
  try {
    await fs.setDoc(jobRef(job.key), { type: job.type, id: job.id, requestedAt: Date.now(), device: deviceId(), attempts: 0 });
    return true;
  } catch { return false; }
}
export const backgroundAvailable = () => !!db && backgroundFunctions;

function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => push().catch(() => {}), 4000);
}

// Prüft beide Seiten und gleicht ab: Neueres gewinnt.
export async function syncNow(first = false) {
  if (!db) return;
  setStatus('läuft');
  try {
    const snap = await fs.getDoc(metaRef());
    const remote = snap.exists() ? snap.data() : null;
    const hasLocal = !!state.profile;
    if (!remote) {
      if (hasLocal) await push(true);
      else setStatus('ok');
      return;
    }
    // Erste Verbindung dieses Geräts, aber hier UND im Konto liegen schon Daten → nachfragen statt überschreiben
    if (!local.base && hasLocal && onConflict) {
      const choice = await onConflict(remote);
      if (choice === 'local') { await push(true, true); return; }
      if (choice === 'remote') { await pull(remote); return; }
    }
    const remoteNewer = remote.updatedAt > local.base;
    if (remoteNewer && (!local.dirty || remote.updatedAt > local.dirtyAt || (first && !hasLocal))) {
      await pull(remote);
    } else if (local.dirty || !local.base) {
      await push(true);
    } else {
      setStatus('ok');
    }
  } catch (e) { setStatus('fehler', friendly(e)); }
}

async function pull(remote) {
  const parts = [];
  for (let i = 0; i < remote.n; i++) {
    const c = await fs.getDoc(chunkRef(i));
    if (!c.exists()) throw new Error('Unvollständiger Stand in der Cloud.');
    parts.push(c.data().d);
  }
  const next = putKeys(JSON.parse(parts.join('')), await readKeys());
  // Fehlende Dateien (Fotos/PDFs) holen
  const have = new Set(await blobKeys());
  for (const [id, n] of Object.entries(remote.blobs || {})) {
    if (have.has(id) || !next.files?.[id]) continue;
    const pieces = [];
    let mime = '';
    for (let i = 0; i < n; i++) {
      const b = await fs.getDoc(blobRef(id, i));
      if (!b.exists()) { pieces.length = 0; break; }
      mime = b.data().mime;
      pieces.push(b.data().d);
    }
    if (pieces.length) await putBlob(id, { mime, data: pieces.join('') });
  }
  await applyRemoteState(next);
  local = { base: remote.updatedAt, dirty: false, dirtyAt: 0, blobs: remote.blobs || {}, keys: local.keys };
  await saveLocalMeta();
  setStatus('ok');
  try { onApplied?.(); } catch {}
}

export async function push(force = false, overwrite = false) {
  if (!db || pushing) return;
  if (!force && !local.dirty) return;
  pushing = true;
  const started = Date.now();
  setStatus('läuft');
  try {
    // Erst schauen, ob inzwischen ein anderes Gerät Neueres hochgeladen hat
    const snap = await fs.getDoc(metaRef());
    const remote = snap.exists() ? snap.data() : null;
    if (!overwrite && remote && remote.updatedAt > local.base && remote.device !== deviceId() && remote.updatedAt > local.dirtyAt) {
      pushing = false;
      await pull(remote);
      return;
    }
    const json = JSON.stringify(withoutKeys(state));
    const keys = keysOf(state);
    if (JSON.stringify(keys) !== local.keys) { await fs.setDoc(secretRef(), keys); local.keys = JSON.stringify(keys); }
    const n = Math.max(1, Math.ceil(json.length / CHUNK));
    for (let i = 0; i < n; i++) await fs.setDoc(chunkRef(i), { d: json.slice(i * CHUNK, (i + 1) * CHUNK) });
    // Dateien: neue hochladen, gelöschte entfernen
    const blobs = { ...(remote?.blobs || {}) };
    const wanted = Object.keys(state.files || {});
    for (const id of wanted) {
      if (blobs[id]) continue;
      const b = await getBlob(id);
      if (!b?.data) continue;
      const m = Math.max(1, Math.ceil(b.data.length / CHUNK));
      for (let i = 0; i < m; i++) await fs.setDoc(blobRef(id, i), { mime: b.mime, d: b.data.slice(i * CHUNK, (i + 1) * CHUNK) });
      blobs[id] = m;
    }
    for (const id of Object.keys(blobs)) {
      if (wanted.includes(id)) continue;
      for (let i = 0; i < blobs[id]; i++) { try { await fs.deleteDoc(blobRef(id, i)); } catch {} }
      delete blobs[id];
    }
    const updatedAt = Date.now();
    await fs.setDoc(metaRef(), { updatedAt, n, device: deviceId(), blobs });
    // Übrige alte Stücke des Stands löschen, falls er kleiner geworden ist
    for (let i = n; i < (remote?.n || 0); i++) { try { await fs.deleteDoc(chunkRef(i)); } catch {} }
    // Wurde während des Hochladens weiter gelernt? Dann gleich nochmal.
    const stillDirty = local.dirtyAt > started;
    local = { base: updatedAt, dirty: stillDirty, dirtyAt: stillDirty ? local.dirtyAt : 0, blobs, keys: local.keys };
    await saveLocalMeta();
    setStatus('ok');
    if (stillDirty) schedulePush();
    else setTimeout(applyBackground, 0); // übernommene Hintergrund-Ergebnisse sind jetzt in der Cloud → aufräumen
  } catch (e) {
    setStatus('fehler', friendly(e));
  } finally { pushing = false; }
}

// Alle Daten dieses Kontos aus der Cloud löschen (Recht auf Löschung).
export async function deleteCloudData() {
  if (!db) throw new Error('Keine Verbindung zum Online-Speicher.');
  try { await fs.deleteDoc(fs.doc(db, 'userIndex', uid)); } catch {}
  try { await fs.deleteDoc(secretRef()); } catch {}
  indexUser = null;
  for (const name of ['bgjobs', 'bgresults', 'bgpresence']) {
    const all = await fs.getDocs(fs.collection(db, 'users', uid, name));
    for (const d of all.docs) await fs.deleteDoc(d.ref);
  }
  const snap = await fs.getDoc(metaRef());
  if (!snap.exists()) return;
  const meta = snap.data();
  for (const [id, n] of Object.entries(meta.blobs || {})) for (let i = 0; i < n; i++) await fs.deleteDoc(blobRef(id, i));
  for (let i = 0; i < (meta.n || 0); i++) await fs.deleteDoc(chunkRef(i));
  await fs.deleteDoc(metaRef());
  db = null; // danach nichts mehr hochladen
}
