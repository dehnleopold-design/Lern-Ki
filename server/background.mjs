// Hintergrund-Dienst: erstellt alles weiter, während die App geschlossen ist.
// Läuft alle paar Minuten über GitHub Actions (.github/workflows/background.yml).
//
// Ablauf:
//  1. Die App legt Aufträge an: users/{uid}/bgjobs/{key} = { type, id }
//     type: exam (Blätter lesen, Lehrerprofil, Lernplan, Lerninhalte) · subject (alte Klausuren + Lehrerprofil)
//           vocab (Vokabelseiten auslesen) · vtest (Testprofil aus alten Vokabeltests) · solve (Arbeitsblatt lösen)
//  2. Dieser Dienst liest den synchronisierten Stand und die hochgeladenen Dateien des Kontos, erzeugt mit dem
//     KI-Schlüssel des Kontos das Fehlende und legt jeden Schritt als Ergebnis ab: users/{uid}/bgresults/{id}
//     (als Liste von Änderungen, die die App nur übernimmt, wenn die Stelle noch leer ist).
//  3. Die App übernimmt die Ergebnisse beim nächsten Öffnen.
// Ist die App gerade offen, pausiert der Dienst (sonst teilen sich beide die Gratis-Limits des Schlüssels).
//
// Achtung: Das Repo ist öffentlich, die Protokolle also auch. Deshalb werden keine Inhalte, Konten oder Schlüssel ausgegeben.

import admin from 'firebase-admin';
import { setState, state } from '../js/store.js';
import * as G from '../js/gen.js';

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

class NotYet extends Error {}
class Paused extends Error {}

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
  return { meta: m, data: JSON.parse(parts.join('')) };
}

// Hochgeladene Dateien (Fotos/PDFs) liegen in Stücken unter users/{uid}/blobs
function blobLoader(uid, meta) {
  return async (fid) => {
    const n = meta.blobs?.[fid];
    if (!n) throw Object.assign(new NotYet('Datei noch nicht in der Cloud.'), { notYet: true });
    let mime = '', data = '';
    for (let i = 0; i < n; i++) {
      const b = await userRef(uid).collection('blobs').doc(`${fid}_${i}`).get();
      if (!b.exists) throw Object.assign(new NotYet('Datei unvollständig.'), { notYet: true });
      mime = b.data().mime; data += b.data().d;
    }
    return { file: { mime, data } };
  };
}

// Cloud-Stand + schon erzeugte, noch nicht übernommene Ergebnisse (dieselbe Logik wie in der App)
async function loadMerged(uid) {
  const cloud = await loadCloud(uid);
  if (!cloud) return null;
  setState(cloud.data);
  const res = await userRef(uid).collection('bgresults').get();
  for (const d of res.docs) {
    const r = d.data();
    try {
      if (r.ops) G.applyOps(state, JSON.parse(r.ops), r.require ? JSON.parse(r.require) : null);
      else if (r.data && !state.sessions[d.id]) state.sessions[d.id] = JSON.parse(r.data);
    } catch {}
  }
  G.setPartLoader(blobLoader(uid, cloud.meta));
  return cloud.meta.updatedAt;
}

async function appOpen(uid) {
  const p = await userRef(uid).collection('bgpresence').doc('app').get();
  return p.exists && (p.data().until || 0) > Date.now();
}

const label = (e) => (e?.status ? `Fehler ${e.status}` : e?.notYet ? 'Datei fehlt noch' : (e?.constructor?.name || 'Fehler'));

// Ein Ergebnis ablegen. ops: Änderungen am Stand, require: Pfad, der noch "in Arbeit" sein muss.
async function writeResult(uid, id, ops, labelText, require = null) {
  const data = { ops: JSON.stringify(ops), label: labelText, at: Date.now(), ...(require ? { require: JSON.stringify(require) } : {}) };
  if (data.ops.length > 900000) throw new Error('Ergebnis zu groß');
  await userRef(uid).collection('bgresults').doc(id).set(data);
}

// ---------------------------------------------------------------- Auftragsarten
async function runExam(ctx, examId) {
  const findExam = () => state.exams.find((x) => x.id === examId);
  let exam = findExam();
  if (!exam) return 'gone';
  let made = 0;
  if (exam.building && !exam.plan) {
    for (const fid of G.examFileIds(exam)) {
      if (state.files[fid]?.digest) continue;
      await ctx.check();
      await G.digestFile(fid);
      await writeResult(ctx.uid, `d_${fid}`, [{ path: ['files', fid, 'digest'], value: state.files[fid].digest, onlyIfEmpty: true }], 'Blatt gelesen');
      made++;
    }
    const subject = state.subjects.find((s) => s.id === exam.subjectId);
    if (G.examNeedsProfile(exam)) {
      await ctx.check();
      await G.buildTeacherProfile(subject);
      await writeResult(ctx.uid, `prof_${subject.id}`, [{ path: ['subjects', { id: subject.id }, 'teacherProfile'], value: subject.teacherProfile, onlyIfEmpty: true }], 'Lehrerprofil');
      made++;
    }
    await ctx.check();
    await G.createPlan(exam);
    await writeResult(ctx.uid, `plan_${examId}`, [
      { path: ['exams', { id: examId }, 'plan'], value: exam.plan },
      { path: ['exams', { id: examId }, 'building'], del: true },
    ], 'Lernplan', ['exams', { id: examId }, 'building']);
    made++;
  }
  // Lerninhalte: erst Lernzettel, dann Quiz + Aufgaben, dann Abschluss
  let failed = 0;
  for (let phase = 0; phase < 3; phase++) {
    for (const u of G.missingPhases(findExam())[phase]) {
      await ctx.check();
      exam = findExam();
      const unit = exam && G.allUnits(exam).find((x) => x.id === u.id);
      if (!unit || unit.status === 'skipped' || G.hasContent(unit)) continue;
      try {
        await G.generateUnit(exam, unit);
        await writeResult(ctx.uid, unit.id, [{ path: ['sessions', unit.id], value: state.sessions[unit.id], onlyIfEmpty: true }], 'Inhalt');
        made++;
      } catch (e) {
        delete state.sessions[unit.id];
        if (e instanceof Paused || [400, 401, 403].includes(e?.status)) throw e;
        failed++;
        console.log(`${ctx.tag}: Ein Inhalt fehlgeschlagen (${label(e)}).`);
      }
    }
  }
  exam = findExam();
  const left = exam.building ? 1 : G.missingPhases(exam).flat().length;
  return { made, failed, left };
}

async function runSubject(ctx, subjectId) {
  const s = state.subjects.find((x) => x.id === subjectId);
  if (!s?.profileBuilding) return 'gone';
  let made = 0;
  for (const fid of s.archive || []) {
    if (!state.files[fid] || state.files[fid].digest) continue;
    await ctx.check();
    await G.digestFile(fid);
    await writeResult(ctx.uid, `d_${fid}`, [{ path: ['files', fid, 'digest'], value: state.files[fid].digest, onlyIfEmpty: true }], 'Alte Klausur gelesen');
    made++;
  }
  await ctx.check();
  await G.buildTeacherProfile(s);
  await writeResult(ctx.uid, `prof_${s.id}`, [
    { path: ['subjects', { id: s.id }, 'teacherProfile'], value: s.teacherProfile },
    { path: ['subjects', { id: s.id }, 'profileBuilding'], del: true },
  ], 'Lehrerprofil', ['subjects', { id: s.id }, 'profileBuilding']);
  return { made: made + 1, failed: 0, left: 0 };
}

async function runVocab(ctx, setId) {
  const set = G.vocabState().sets.find((x) => x.id === setId);
  if (!set?.building) return 'gone';
  await ctx.check();
  await G.buildVocabSet(set);
  const p = (k) => ['vocab', 'sets', { id: setId }, k];
  await writeResult(ctx.uid, `v_${setId}`, [
    ...['words', 'titel', 'sprache', 'plan', 'fileIds', 'pendingFiles'].map((k) => ({ path: p(k), value: set[k] })),
    { path: p('building'), del: true },
  ], 'Vokabeln', p('building'));
  return { made: 1, failed: 0, left: 0 };
}

async function runVocabTest(ctx, sprache) {
  const t = G.vocabState().tests?.[sprache];
  if (!t?.building) return 'gone';
  await ctx.check();
  const subject = await G.buildVocabTestProfile(sprache);
  const ops = [
    { path: ['vocab', 'tests', sprache, 'profil'], value: t.profil },
    { path: ['vocab', 'tests', sprache, 'building'], del: true },
  ];
  if (subject) ops.push({ path: ['subjects', { id: subject.id }, 'teacherProfile'], value: subject.teacherProfile });
  await writeResult(ctx.uid, `t_${sprache}`, ops, 'Testprofil', ['vocab', 'tests', sprache, 'building']);
  return { made: 1, failed: 0, left: 0 };
}

async function runSolve(ctx, itemId) {
  const item = (state.solved || []).find((x) => x.id === itemId);
  if (!item?.building) return 'gone';
  await ctx.check();
  await G.solveSheet(item);
  const p = (k) => ['solved', { id: itemId }, k];
  await writeResult(ctx.uid, `s_${itemId}`, [
    ...['loesung', 'ersteAufgabe', 'annot'].map((k) => ({ path: p(k), value: item[k] })),
    { path: p('building'), del: true },
  ], 'Arbeitsblatt gelöst', p('building'));
  return { made: 1, failed: 0, left: 0 };
}

const RUNNERS = { exam: runExam, subject: runSubject, vocab: runVocab, vtest: runVocabTest, solve: runSolve };

async function runJob(job, n, total) {
  const uid = job.ref.parent.parent.id;
  const info = job.data() || {};
  const type = info.type || 'exam';
  const id = info.id || job.id;
  const tag = `Auftrag ${n}/${total} (${type})`;
  if (await appOpen(uid)) { console.log(`${tag}: App ist gerade offen – Pause.`); return; }
  let known = await loadMerged(uid);
  if (!known) { console.log(`${tag}: Stand noch nicht in der Cloud – nächstes Mal.`); return; }
  if (!(state.settings?.apiKey || state.settings?.provider === 'openai')) {
    await job.ref.delete(); console.log(`${tag}: Kein KI-Schlüssel im Konto – Auftrag gelöscht.`); return;
  }
  const ctx = {
    uid, tag,
    // Vor jedem Schritt: Zeit übrig? App geöffnet? Neuer Stand von einem Gerät?
    async check() {
      if (!timeLeft()) throw new Paused('Zeit aufgebraucht');
      if (await appOpen(uid)) throw new Paused('App geöffnet');
      const meta = await userRef(uid).collection('state').doc('meta').get();
      if (meta.exists && meta.data().updatedAt !== known) known = await loadMerged(uid);
    },
  };
  let res;
  try {
    res = await RUNNERS[type]?.(ctx, id);
  } catch (e) {
    if (e instanceof Paused) { console.log(`${tag}: Pause (${e.message}).`); return; }
    if (e?.notYet) { console.log(`${tag}: Dateien noch nicht hochgeladen – nächstes Mal.`); return; }
    const fatal = [400, 401, 403].includes(e?.status);
    const attempts = (info.attempts || 0) + 1;
    if (fatal || attempts >= MAX_ATTEMPTS) await job.ref.delete();
    else await job.ref.set({ attempts, lastRun: Date.now() }, { merge: true });
    console.log(`${tag}: fehlgeschlagen (${label(e)})${fatal || attempts >= MAX_ATTEMPTS ? ' – aufgegeben' : ' – nächstes Mal nochmal'}.`);
    return;
  }
  if (!res || res === 'gone') {
    if (res === 'gone' || Date.now() - (info.requestedAt || 0) > STALE_MS) { await job.ref.delete(); console.log(`${tag}: nichts (mehr) zu tun – Auftrag gelöscht.`); }
    return;
  }
  const attempts = (info.attempts || 0) + 1;
  if (!res.left || attempts >= MAX_ATTEMPTS) await job.ref.delete();
  else await job.ref.set({ attempts, lastRun: Date.now() }, { merge: true });
  console.log(`${tag}: ${res.made} erstellt, ${res.failed} fehlgeschlagen, ${res.left} offen.`);
}

const jobs = await db.collectionGroup('bgjobs').get();
if (jobs.empty) { console.log('Keine Aufträge.'); process.exit(0); }
let i = 0;
for (const job of jobs.docs) {
  if (!timeLeft()) { console.log('Zeit aufgebraucht – Rest beim nächsten Lauf.'); break; }
  try { await runJob(job, ++i, jobs.size); } catch (e) { console.log(`Auftrag ${i}: abgebrochen (${label(e)}).`); }
}
process.exit(0);
