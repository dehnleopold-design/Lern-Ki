// Hintergrund-Arbeit für Jelly: erstellt alles weiter, während die App geschlossen ist.
// Läuft in Firebase Cloud Functions (functions/index.js, Rechenzentrum Frankfurt). Die Funktion lädt diese Datei
// und die App-Module (js/…) bei jedem neuen Stand von der Website – Änderungen brauchen also kein neues Deployment.
// Wichtig: Hier keine npm-Pakete importieren, nur relative Pfade. Die Datenbank (firebase-admin) kommt als Parameter.
//
// Ablauf:
//  1. Die App legt Aufträge an: users/{uid}/bgjobs/{key} = { type, id }
//     type: exam (Blätter lesen, Lehrerprofil, Lernplan, Lerninhalte) · subject (alte Klausuren + Lehrerprofil)
//           vocab (Vokabelseiten auslesen) · vtest (Testprofil aus alten Vokabeltests) · solve (Arbeitsblatt lösen)
//  2. Ist die App zu, liest die Funktion Stand und Dateien des Kontos, erzeugt mit dem KI-Schlüssel des Kontos
//     das Fehlende und legt jeden Schritt als Ergebnis ab: users/{uid}/bgresults/{id}
//     (Änderungen, die die App nur übernimmt, wenn die Stelle noch leer bzw. noch "in Arbeit" ist).
//  3. Die App übernimmt die Ergebnisse beim nächsten Öffnen.
// Ist die App offen, wird pausiert (sonst teilen sich App und Funktion die Gratis-Limits des Schlüssels).

import { setState, state } from '../js/store.js';
import * as G from '../js/gen.js';

const MAX_ATTEMPTS = 4;
const RETRY_MS = 10 * 60000;
const STALE_MS = 24 * 3600 * 1000;

class NotYet extends Error {}
class Paused extends Error {}

const label = (e) => (e?.status ? `Fehler ${e.status}` : e?.notYet ? 'Datei fehlt noch' : (e?.constructor?.name || 'Fehler'));

export function makeWorker(db, { deadline, log = console.log }) {
  const userRef = (uid) => db.collection('users').doc(uid);
  const timeLeft = () => Date.now() < deadline;

  async function loadCloud(uid) {
    const meta = await userRef(uid).collection('state').doc('meta').get();
    if (!meta.exists) return null;
    const m = meta.data();
    const parts = [];
    for (let i = 0; i < m.n; i++) {
      const c = await userRef(uid).collection('state').doc(`c${i}`).get();
      if (!c.exists) return null; // gerade im Hochladen – später nochmal
      parts.push(c.data().d);
    }
    return { meta: m, data: JSON.parse(parts.join('')) };
  }

  // Hochgeladene Dateien (Fotos/PDFs) liegen in Stücken unter users/{uid}/blobs
  const blobLoader = (uid, meta) => async (fid) => {
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
          log(`${ctx.tag}: Ein Inhalt fehlgeschlagen (${label(e)}).`);
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

  // Ein Auftrag. Gibt 'paused' zurück, wenn abgebrochen wurde (Zeit um / App offen).
  async function runJob(uid, job, n, total, cursor) {
    const info = job.data() || {};
    const type = info.type || 'exam';
    const id = info.id || job.id;
    const tag = `Auftrag ${n}/${total} (${type})`;
    if (!(state.settings?.apiKey || state.settings?.provider === 'openai')) {
      await job.ref.delete(); log(`${tag}: Kein KI-Schlüssel im Konto – Auftrag gelöscht.`); return;
    }
    const ctx = {
      uid, tag,
      // Vor jedem Schritt: Zeit übrig? App geöffnet? Neuer Stand von einem Gerät?
      async check() {
        if (!timeLeft()) throw new Paused('Zeit aufgebraucht');
        if (await appOpen(uid)) throw new Paused('App geöffnet');
        const meta = await userRef(uid).collection('state').doc('meta').get();
        if (meta.exists && meta.data().updatedAt !== cursor.known) cursor.known = await loadMerged(uid);
      },
    };
    let res;
    const retryLater = async (why, attempts) => {
      if (attempts >= MAX_ATTEMPTS) { await job.ref.delete(); log(`${tag}: ${why} – aufgegeben.`); return; }
      await job.ref.set({ attempts, nextTryAt: Date.now() + RETRY_MS }, { merge: true });
      log(`${tag}: ${why} – in 10 Minuten nochmal.`);
    };
    try {
      res = await RUNNERS[type]?.(ctx, id);
    } catch (e) {
      if (e instanceof Paused) { log(`${tag}: Pause (${e.message}).`); return 'paused'; }
      if (e?.notYet) { await job.ref.set({ nextTryAt: Date.now() + 5 * 60000 }, { merge: true }); log(`${tag}: Dateien noch nicht hochgeladen – später.`); return; }
      if ([400, 401, 403].includes(e?.status)) { await job.ref.delete(); log(`${tag}: ${label(e)} – Schlüssel prüfen, aufgegeben.`); return; }
      await retryLater(`fehlgeschlagen (${label(e)})`, (info.attempts || 0) + 1);
      return;
    }
    if (!res || res === 'gone') {
      if (res === 'gone' || Date.now() - (info.requestedAt || 0) > STALE_MS) { await job.ref.delete(); log(`${tag}: nichts (mehr) zu tun – Auftrag gelöscht.`); }
      return;
    }
    log(`${tag}: ${res.made} erstellt, ${res.failed} fehlgeschlagen, ${res.left} offen.`);
    if (!res.left) await job.ref.delete();
    else await retryLater(`${res.left} offen`, (info.attempts || 0) + 1);
  }

  // Alle fälligen Aufträge eines Kontos. Nur eine Ausführung pro Konto gleichzeitig (Sperre in bgpresence/lease).
  async function processUser(uid) {
    const leaseRef = userRef(uid).collection('bgpresence').doc('lease');
    const runId = Math.random().toString(36).slice(2);
    const got = await db.runTransaction(async (t) => {
      const l = await t.get(leaseRef);
      if (l.exists && (l.data().until || 0) > Date.now()) return false;
      t.set(leaseRef, { until: deadline + 60000, runId });
      return true;
    });
    if (!got) return 'busy';
    let paused = false;
    try {
      if (await appOpen(uid)) return 'open';
      const now = Date.now();
      const jobs = (await userRef(uid).collection('bgjobs').get()).docs.filter((j) => (j.data().nextTryAt || 0) <= now);
      if (!jobs.length) return 'idle';
      const cursor = { known: await loadMerged(uid) };
      if (!cursor.known) { log('Stand noch nicht in der Cloud – später.'); return 'later'; }
      let i = 0;
      for (const job of jobs) {
        if (!timeLeft()) { paused = true; break; }
        if ((await runJob(uid, job, ++i, jobs.length, cursor)) === 'paused') { paused = true; break; }
      }
    } finally {
      await leaseRef.delete().catch(() => {});
    }
    // Zeit aufgebraucht, aber noch Arbeit da? Aufträge anstupsen – das startet sofort die nächste Ausführung.
    if (paused && !(await appOpen(uid))) {
      const left = (await userRef(uid).collection('bgjobs').get()).docs.filter((j) => (j.data().nextTryAt || 0) <= Date.now());
      for (const j of left) await j.ref.set({ poke: Date.now() }, { merge: true });
    }
    return paused ? 'paused' : 'done';
  }

  // Regelmäßiger Durchlauf: alle Konten mit offenen Aufträgen (falls ein Auslöser verpasst wurde).
  async function sweep() {
    const jobs = await db.collectionGroup('bgjobs').get();
    const uids = [...new Set(jobs.docs.map((j) => j.ref.parent.parent.id))];
    for (const uid of uids) {
      if (!timeLeft()) break;
      try { await processUser(uid); } catch (e) { log(`Konto übersprungen (${label(e)}).`); }
    }
    return uids.length;
  }

  return { processUser, sweep };
}
