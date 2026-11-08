// Speichert alles lokal im Browser (IndexedDB). Nichts geht an einen eigenen Server.

const LEGACY_DB = 'lernki';
let DB_NAME = LEGACY_DB;
const DB_VERSION = 1;
let dbPromise = null;

function openNamed(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function readAll(db, store) {
  return new Promise((resolve, reject) => {
    const out = [];
    const req = db.transaction(store, 'readonly').objectStore(store).openCursor();
    req.onsuccess = () => { const c = req.result; if (c) { out.push([c.key, c.value]); c.continue(); } else resolve(out); };
    req.onerror = () => reject(req.error);
  });
}

function writeAll(db, store, entries) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    for (const [k, v] of entries) t.objectStore(store).put(v, k);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}

// Jedes Konto bekommt einen eigenen Speicher. Die Daten von vor der Anmeldung (ohne Konto)
// übernimmt das erste Konto, das sich auf diesem Gerät anmeldet.
// Gibt es schon Daten aus der Nutzung ohne Konto? (Dann wird nicht nach Anmeldung gefragt.)
export async function hasLocalProfile() {
  try {
    const db = await openNamed(LEGACY_DB);
    const st = await new Promise((res) => { const r = db.transaction('kv', 'readonly').objectStore('kv').get('state'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); });
    db.close();
    return !!st?.profile;
  } catch { return false; }
}

export async function useAccount(uid) {
  if (dbPromise) { try { (await dbPromise).close(); } catch {} }
  DB_NAME = `lernki-u-${uid}`;
  dbPromise = null;
  let claimed = null;
  try { claimed = localStorage.getItem('lernki-legacy-claimed'); } catch {}
  if (!claimed) {
    try {
      const target = await openNamed(DB_NAME);
      const hasOwn = (await readAll(target, 'kv')).length > 0;
      if (!hasOwn) {
        const legacy = await openNamed(LEGACY_DB);
        const kv = await readAll(legacy, 'kv');
        if (kv.length) {
          await writeAll(target, 'blobs', await readAll(legacy, 'blobs'));
          await writeAll(target, 'kv', kv);
          // Alte Kopie leeren, damit "ohne Konto" danach wirklich leer startet
          await new Promise((res) => { const t = legacy.transaction(['kv', 'blobs'], 'readwrite'); t.objectStore('kv').clear(); t.objectStore('blobs').clear(); t.oncomplete = res; t.onerror = res; });
        }
        legacy.close();
      }
      target.close();
      try { localStorage.setItem('lernki-legacy-claimed', uid); } catch {}
    } catch (e) { console.warn('Übernahme alter Daten fehlgeschlagen', e); }
  }
  state = defaultState();
}

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const req = fn(s);
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const defaultState = () => ({
  version: 1,
  profile: null,
  subjects: [],
  exams: [],
  files: {},      // id -> { id, name, mime, size, kind, subjectId, digest, addedAt }
  sessions: {},   // unitId -> { intro, tasks, answers, answerImages, grading, chats }
  tutor: {},      // examId -> [{ role, text }]
  vocab: { sets: [], tests: {} },
  solved: [],     // gelöste Arbeitsblätter
  timetable: null, // Stundenplan (wird beim ersten Öffnen angelegt)
  examPlan: null,  // Klassenarbeitsplan
  activeExamId: null,
  settings: { provider: 'gemini', apiKey: '', model: '', baseUrl: '', oaKey: '', oaModel: '' },
});

export let state = defaultState();

export async function loadState() {
  try {
    const saved = await tx('kv', 'readonly', (s) => s.get('state'));
    if (saved) state = Object.assign(defaultState(), saved);
  } catch (e) {
    console.error('Laden fehlgeschlagen', e);
  }
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch {}
  return state;
}

let saveTimer = null;
let changeListener = null;
// Die Synchronisierung hört hier mit, wann sich etwas geändert hat.
export function onChange(fn) { changeListener = fn; }
export function save() {
  try { changeListener?.(); } catch {}
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    tx('kv', 'readwrite', (s) => s.put(JSON.parse(JSON.stringify(state)), 'state')).catch((e) =>
      console.error('Speichern fehlgeschlagen', e)
    );
  }, 250);
}

// Sofort speichern, wenn die App in den Hintergrund geht oder geschlossen wird.
function flush() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  tx('kv', 'readwrite', (s) => s.put(JSON.parse(JSON.stringify(state)), 'state')).catch(() => {});
}
if (typeof document !== 'undefined') { // im Hintergrund-Dienst (Node) gibt es kein Fenster
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
}

// Nur für den Hintergrund-Dienst: Stand setzen, ohne zu speichern.
export function setState(next) { state = Object.assign(defaultState(), next); }

export function replaceState(next) {
  state = Object.assign(defaultState(), next);
  save();
}

// Stand von einem anderen Gerät übernehmen (ohne das als eigene Änderung zu melden).
export async function applyRemoteState(next) {
  state = Object.assign(defaultState(), next);
  clearTimeout(saveTimer);
  saveTimer = null;
  await tx('kv', 'readwrite', (s) => s.put(JSON.parse(JSON.stringify(state)), 'state'));
}

export const kvGet = (key) => tx('kv', 'readonly', (s) => s.get(key));
export const kvPut = (key, value) => tx('kv', 'readwrite', (s) => s.put(value, key));
export async function blobKeys() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('blobs', 'readonly').objectStore('blobs').getAllKeys();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const putBlob = (id, value) => tx('blobs', 'readwrite', (s) => s.put(value, id));
export const getBlob = (id) => tx('blobs', 'readonly', (s) => s.get(id));
export const deleteBlob = (id) => tx('blobs', 'readwrite', (s) => s.delete(id));

export async function allBlobs() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const out = {};
    const t = db.transaction('blobs', 'readonly');
    const req = t.objectStore('blobs').openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (c) { out[c.key] = c.value; c.continue(); } else resolve(out);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearAll() {
  await tx('kv', 'readwrite', (s) => s.clear());
  await tx('blobs', 'readwrite', (s) => s.clear());
  state = defaultState();
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
