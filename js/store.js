// Speichert alles lokal im Browser (IndexedDB). Nichts geht an einen eigenen Server.

const DB_NAME = 'lernki';
const DB_VERSION = 1;
let dbPromise = null;

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
export function save() {
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
addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

export function replaceState(next) {
  state = Object.assign(defaultState(), next);
  save();
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
