// Hintergrund-Dienst: erstellt fehlende Lernzettel, Quiz und Aufgaben, während die App geschlossen ist.
// Läuft alle paar Minuten über GitHub Actions (.github/workflows/background.yml).
//
// Ablauf:
//  1. Die App legt beim Anlegen einer Klausur (und beim Schließen, falls noch etwas fehlt)
//     einen Auftrag an: users/{uid}/bgjobs/{examId}
//  2. Dieser Dienst liest den synchronisierten Stand des Kontos, erzeugt die fehlenden Inhalte mit dem
//     KI-Schlüssel des Kontos und legt sie einzeln ab: users/{uid}/bgresults/{unitId}
//  3. Die App übernimmt die Ergebnisse beim nächsten Öffnen.
// Die Ergebnisse liegen getrennt vom App-Stand, damit nichts überschrieben wird, falls gleichzeitig gelernt wird.
//
// Achtung: Das Repo ist öffentlich, die Protokolle also auch. Deshalb werden keine Inhalte, Konten oder Schlüssel ausgegeben.

import admin from 'firebase-admin';
import { setState, state } from '../js/store.js';
import { allUnits, hasContent, missingPhases, generateUnit } from '../js/gen.js';

const MAX_MINUTES = Number(process.env.MAX_MINUTES || 40);
const MAX_ATTEMPTS = 4;
const STALE_MS = 24 * 3600 * 1000;
const started = Date.now();
const timeLeft = () => Date.now() - started < MAX_MINUTES * 60000;

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) { console.log('Kein Firebase-Dienstschlüssel hinterlegt (Secret FIREBASE_SERVICE_ACCOUNT) – nichts zu tun.'); process.exit(0); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
const db = admin.firestore();

const userRef = (uid) => db.collection('users').doc(uid);

async function loadCloud(uid) {
  const meta = await userRef(uid).collection('state').doc('meta').get();
  if (!meta.exists) return null;
  const m = meta.data();
  const parts = [];
  for (let i = 0; i < m.n; i++) {
    const c = await userRef(uid).collection('state').doc(`c${i}`).get();
    if (!c.exists) return null; // gerade im Hochladen – nächstes Mal
    parts.push(c.data().d);
  }
  return { updatedAt: m.updatedAt, data: JSON.parse(parts.join('')) };
}

// Cloud-Stand + schon erzeugte, noch nicht übernommene Ergebnisse
async function loadMerged(uid) {
  const cloud = await loadCloud(uid);
  if (!cloud) return null;
  setState(cloud.data);
  const res = await userRef(uid).collection('bgresults').get();
  for (const d of res.docs) {
    if (state.sessions[d.id]) continue;
    try { state.sessions[d.id] = JSON.parse(d.data().data); } catch {}
  }
  return cloud.updatedAt;
}

const label = (e) => (e?.status ? `Fehler ${e.status}` : (e?.constructor?.name || 'Fehler'));

async function runJob(job, n, total) {
  const uid = job.ref.parent.parent.id;
  const info = job.data() || {};
  const tag = `Auftrag ${n}/${total}`;
  let known = await loadMerged(uid);
  const findExam = () => state.exams.find((x) => x.id === job.id);
  if (!known || !findExam()?.plan) {
    if (Date.now() - (info.requestedAt || 0) > STALE_MS) { await job.ref.delete(); console.log(`${tag}: Klausur nicht (mehr) vorhanden – Auftrag gelöscht.`); }
    else console.log(`${tag}: Stand noch nicht in der Cloud – nächstes Mal.`);
    return;
  }
  if (!(state.settings?.apiKey || state.settings?.provider === 'openai')) {
    await job.ref.delete();
    console.log(`${tag}: Kein KI-Schlüssel im Konto – Auftrag gelöscht.`);
    return;
  }
  let made = 0, failed = 0, fatal = false;
  for (let phase = 0; phase < 3 && !fatal; phase++) {
    const units = missingPhases(findExam())[phase];
    for (const u of units) {
      if (!timeLeft()) break;
      // Hat inzwischen ein Gerät etwas hochgeladen (z. B. weil doch in der App erstellt wurde)? Dann neu einlesen.
      const meta = await userRef(uid).collection('state').doc('meta').get();
      if (meta.exists && meta.data().updatedAt !== known) known = await loadMerged(uid);
      const exam = findExam();
      const unit = exam && allUnits(exam).find((x) => x.id === u.id);
      if (!unit || unit.status === 'skipped' || hasContent(unit)) continue;
      try {
        await generateUnit(exam, unit);
        const data = JSON.stringify(state.sessions[unit.id]);
        if (data.length > 900000) throw new Error('zu groß');
        await userRef(uid).collection('bgresults').doc(unit.id).set({ examId: exam.id, data, at: Date.now() });
        made++;
      } catch (e) {
        failed++;
        delete state.sessions[unit.id];
        console.log(`${tag}: Ein Inhalt fehlgeschlagen (${label(e)}).`);
        // Schlüssel ungültig o. Ä. → Weitermachen bringt nichts
        if ([400, 401, 403].includes(e?.status)) { fatal = true; break; }
      }
    }
  }
  const left = missingPhases(findExam()).flat().length;
  if (!left) await job.ref.delete();
  else if ((info.attempts || 0) + 1 >= MAX_ATTEMPTS || fatal) await job.ref.delete();
  else await job.ref.set({ attempts: (info.attempts || 0) + 1, lastRun: Date.now() }, { merge: true });
  console.log(`${tag}: ${made} erstellt, ${failed} fehlgeschlagen, ${left} offen.`);
}

const jobs = await db.collectionGroup('bgjobs').get();
if (jobs.empty) { console.log('Keine Aufträge.'); process.exit(0); }
let i = 0;
for (const job of jobs.docs) {
  if (!timeLeft()) { console.log('Zeit aufgebraucht – Rest beim nächsten Lauf.'); break; }
  try { await runJob(job, ++i, jobs.size); } catch (e) { console.log(`Auftrag ${i}: abgebrochen (${label(e)}).`); }
}
process.exit(0);
