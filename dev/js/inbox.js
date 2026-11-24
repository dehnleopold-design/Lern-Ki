// Posteingang: Control (Admin) kann eine Klausur aus einem anderen Konto in das eigene Konto schicken.
// Control legt sie unter users/{uid}/inbox/… ab (in Jelly Developer: dev_inbox), Jelly holt sie beim Start ab,
// übernimmt sie mit neuen IDs in den eigenen Stand und löscht den Eintrag danach.
//
// Aufbau: inbox/{tid} = { type: 'exam', from, title, at, n, files: [{ id, n, mime }] }
//         inbox/{tid}_c{i} = { d }            – JSON-Paket in Stücken
//         inbox/{tid}_f{k}_{i} = { d }        – Datei k (Base64) in Stücken

import { firebaseApp } from './auth.js';
import { state, save, putBlob, uid as newId } from './store.js';
import { cloudName } from './env.js';

const V = '10.12.2';

export async function importInbox(user) {
  if (!user?.uid) return [];
  const fs = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`);
  const db = fs.getFirestore(firebaseApp());
  const col = fs.collection(db, 'users', user.uid, cloudName('inbox'));
  let snap;
  try { snap = await fs.getDocs(col); } catch { return []; } // keine Rechte/offline → später nochmal
  const all = new Map(snap.docs.map((d) => [d.id, d]));
  const heads = snap.docs.filter((d) => !d.id.includes('_') && d.data()?.type === 'exam');
  const done = [];
  for (const head of heads) {
    const m = head.data();
    try {
      const json = Array.from({ length: m.n }, (_, i) => all.get(`${head.id}_c${i}`)?.data()?.d ?? null);
      if (json.some((x) => x === null)) continue; // noch nicht vollständig hochgeladen
      const pack = JSON.parse(json.join(''));
      const files = [];
      for (const [k, f] of (m.files || []).entries()) {
        const parts = Array.from({ length: f.n }, (_, i) => all.get(`${head.id}_f${k}_${i}`)?.data()?.d ?? null);
        if (parts.some((x) => x === null)) continue;
        files.push({ id: f.id, mime: f.mime, data: parts.join('') });
      }
      await takeExam(pack, files);
      done.push({ title: m.title || 'Klausur', from: m.from || '' });
      for (const id of all.keys()) if (id === head.id || id.startsWith(`${head.id}_`)) { try { await fs.deleteDoc(fs.doc(col, id)); } catch {} }
    } catch (e) { console.warn('Posteingang', e); }
  }
  return done;
}

// Klausur mit neuen IDs übernehmen: Fach (gleicher Name oder neu), Lernplan, Lerninhalte, Dateien. Fortschritt startet neu.
async function takeExam(pack, files) {
  const ex = JSON.parse(JSON.stringify(pack.exam));
  // Fach: gleiches Fach im eigenen Konto suchen, sonst anlegen
  const name = (pack.subject?.name || 'Fach').trim();
  let subject = state.subjects.find((s) => s.name.trim().toLowerCase() === name.toLowerCase());
  if (!subject) {
    subject = { id: newId(), name, short: pack.subject?.short || name.slice(0, 3).toUpperCase(), color: pack.subject?.color || '#c4b5fd', language: pack.subject?.language || 'de', level: 2, teacherNotes: '', teacherProfile: pack.subject?.teacherProfile || '', archive: [] };
    state.subjects.push(subject);
  }
  // Dateien
  const fileMap = {};
  for (const f of files) {
    const meta = pack.files?.[f.id];
    if (!meta) continue;
    const nid = newId();
    fileMap[f.id] = nid;
    await putBlob(nid, { mime: f.mime || meta.mime, data: f.data });
    state.files[nid] = { ...meta, id: nid, subjectId: subject.id, addedAt: Date.now(), ...(meta.group ? { group: null } : {}) };
  }
  // Seiten-Gruppen (mehrseitige Dokumente) auf die neuen IDs umstellen
  for (const [oldId, nid] of Object.entries(fileMap)) { const g = pack.files[oldId]?.group; if (g && fileMap[g]) state.files[nid].group = fileMap[g]; else delete state.files[nid].group; }
  // Klausur und Einheiten
  const examId = newId();
  const unitMap = {};
  for (const sec of ex.plan?.abschnitte || []) for (const u of sec.einheiten || []) { const nid = newId(); unitMap[u.id] = nid; u.id = nid; u.status = 'open'; delete u.doneAt; }
  ex.id = examId;
  ex.subjectId = subject.id;
  ex.materialIds = (ex.materialIds || []).map((id) => fileMap[id]).filter(Boolean);
  delete ex.building;
  ex.importedFrom = pack.from || '';
  ex.createdAt = Date.now();
  state.exams.push(ex);
  // Lerninhalte (Lernzettel, Quizze, Aufgaben) übernehmen – eigene Antworten leer
  for (const [oldUnit, sess] of Object.entries(pack.sessions || {})) {
    const nid = unitMap[oldUnit];
    if (!nid) continue;
    const s = JSON.parse(JSON.stringify(sess));
    s.examId = examId;
    if (s.antworten) s.antworten = {};
    if ('idx' in s) s.idx = 0;
    delete s.korrektur; delete s.ergebnis; delete s.score;
    state.sessions[nid] = s;
  }
  state.activeExamId = examId;
  save();
}
