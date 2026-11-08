// Inhalte einer Lerneinheit erzeugen (Lernzettel, Quiz, Aufgaben).
// Wird von der App UND vom Hintergrund-Dienst (server/background.mjs) benutzt – deshalb ohne Oberfläche.

import { state, uid } from './store.js';
import { generate, AIError } from './ai.js';
import * as P from './prompts.js';
import { isoDate, parseISO, fmtDate, relDay } from './ui.js';

// Woher die Dateien kommen: in der App aus IndexedDB, im Hintergrund-Dienst aus Firestore.
let partLoader = null;
export function setPartLoader(fn) { partLoader = fn; }
const partOf = (id) => { if (!partLoader) throw new Error('Keine Dateiquelle.'); return partLoader(id); };

const subjectById = (id) => state.subjects.find((s) => s.id === id);
export const vocabState = () => (state.vocab ||= { sets: [], tests: {} });

export function allUnits(exam) {
  return (exam.plan?.abschnitte || []).flatMap((s, si) => s.einheiten.map((u) => ({ ...u, _section: si })));
}

export function hasContent(u) {
  const x = state.sessions[u.id];
  return !!(x && (x.lernzettel || x.fragen || x.aufgaben));
}

export function lernzettelText(exam, themaIndex) {
  const sec = (exam.plan?.abschnitte || []).find((x) => x.themaIndex === themaIndex && !x.abschluss);
  const u = sec?.einheiten.find((x) => x.typ === 'lernzettel');
  return u ? state.sessions[u.id]?.lernzettel || null : null;
}

// Fehlende Inhalte in sinnvoller Reihenfolge: erst Lernzettel (die anderen bauen darauf auf), dann Quiz + Aufgaben, dann Abschluss.
export function missingPhases(exam) {
  const todo = allUnits(exam).filter((u) => !hasContent(u) && u.status !== 'skipped');
  return [
    todo.filter((u) => u.typ === 'lernzettel'),
    todo.filter((u) => u.typ === 'quiz' || u.typ === 'aufgaben' || ['verstehen', 'ueben', 'anwenden'].includes(u.typ)),
    todo.filter((u) => u.typ === 'gesamtzettel' || u.typ === 'probeklausur'),
  ];
}

export async function genLernzettel(exam, unit) {
  const overall = unit.typ === 'gesamtzettel';
  const topic = overall ? null : exam.plan?.themen?.[unit.themaIndex];
  const text = await generate({ system: P.baseSystem(P.subjectOf(exam)), parts: [{ text: P.lernzettelPrompt(exam, topic || { titel: unit.titel }, overall) }], temperature: 0.3 });
  state.sessions[unit.id] = { examId: exam.id, lernzettel: text, createdAt: Date.now() };
}

// KI-Modelle setzen die richtige Antwort auffällig oft an dieselbe Stelle (häufig B).
// Deshalb werden die Antwortmöglichkeiten immer zufällig gemischt. Gibt true zurück, wenn etwas gemischt wurde.
export function mixOptions(q) {
  if (q?.typ !== 'mc' || q.mix || !Array.isArray(q.optionen) || !Number.isInteger(q.richtig)) return false;
  const order = q.optionen.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  q.optionen = order.map((i) => q.optionen[i]);
  q.richtig = order.indexOf(q.richtig);
  q.mix = true;
  return true;
}

export async function genQuiz(exam, unit) {
  const topic = exam.plan?.themen?.[unit.themaIndex] || { titel: unit.titel };
  const prev = state.sessions[unit.id]?.alteFragen || [];
  const res = await generate({ system: P.baseSystem(P.subjectOf(exam)), parts: [{ text: P.quizPrompt(exam, topic, lernzettelText(exam, unit.themaIndex), prev) }], json: true, temperature: 0.7 });
  const fragen = (res.fragen || []).filter((q) => q?.frage && ['mc', 'wahrfalsch', 'eingabe'].includes(q.typ)
    && (q.typ !== 'mc' || (Array.isArray(q.optionen) && q.optionen.length >= 2 && Number.isInteger(q.richtig))));
  if (!fragen.length) throw new AIError('Keine brauchbaren Quizfragen erhalten. Bitte nochmal versuchen.');
  fragen.forEach(mixOptions);
  state.sessions[unit.id] = { examId: exam.id, fragen, antworten: {}, idx: 0, alteFragen: [...prev, ...fragen.map((q) => q.frage.slice(0, 100))] };
}

export async function genAufgaben(exam, unit) {
  const prev = Object.values(state.sessions).filter((x) => x.examId === exam.id).flatMap((x) => (x.aufgaben || []).map((a) => a.aufgabe.slice(0, 120)));
  const topic = exam.plan?.themen?.[unit.themaIndex];
  const lz = topic ? lernzettelText(exam, unit.themaIndex) : null;
  const res = await generate({ system: P.baseSystem(P.subjectOf(exam)), parts: [{ text: P.sessionPrompt(exam, unit, prev, { topic, lernzettel: lz }) }], json: true, temperature: 0.7 });
  const aufgaben = (res.aufgaben || []).filter((a) => a?.aufgabe).map((a, i) => ({ ...a, id: a.id || `a${i + 1}`, punkte: Number(a.punkte) || 4 }));
  if (!aufgaben.length) throw new AIError('Keine Aufgaben erhalten. Bitte nochmal versuchen.');
  // startedAt erst beim ersten Öffnen setzen (sonst läuft der Probeklausur-Timer schon ab der Erstellung)
  state.sessions[unit.id] = { examId: exam.id, zeitMinuten: res.zeitMinuten || null, aufgaben, answers: {}, answerImages: {}, grading: null, chats: {}, startedAt: null };
}

export function generateUnit(exam, unit) {
  if (unit.typ === 'lernzettel' || unit.typ === 'gesamtzettel') return genLernzettel(exam, unit);
  if (unit.typ === 'quiz') return genQuiz(exam, unit);
  return genAufgaben(exam, unit);
}


// ================================================================ Material lesen, Lehrerprofil, Lernplan
// Mehrere Bilder können EIN Dokument sein (files[x].group = id der ersten Seite). Liefert die Seiten in Reihenfolge.
export function groupOf(id) {
  const g = state.files[id]?.group || id;
  return Object.values(state.files).filter((x) => (x.group || x.id) === g)
    .sort((a, b) => (a.id === g ? -1 : b.id === g ? 1 : (a.addedAt || 0) - (b.addedAt || 0))).map((x) => x.id);
}
export const isGroupLead = (id) => groupOf(id)[0] === id;

// Liest ein Dokument (alle Seiten zusammen). Die Zusammenfassung steht bei der ersten Seite,
// die anderen Seiten bekommen nur einen Verweis. Gibt die geänderten Datei-ids zurück.
export async function digestFile(id) {
  const f = state.files[id];
  if (!f || f.digest) return [];
  const ids = groupOf(id);
  const lead = ids[0];
  const subject = subjectById(f.subjectId);
  const parts = [{ text: P.digestPrompt(f.kind, ids.length) }];
  for (const x of ids) parts.push(await partOf(x));
  const digest = await generate({ system: P.baseSystem(subject), parts, json: true, temperature: 0.1 });
  state.files[lead].digest = digest;
  for (const x of ids.slice(1)) state.files[x].digest = { teil: lead };
  return ids;
}

// Seite zu einem Dokument hinzugefügt → alles neu lesen
export function resetGroup(id) {
  for (const x of groupOf(id)) if (state.files[x]) state.files[x].digest = null;
}

export async function buildTeacherProfile(subject) {
  subject.teacherProfile = await generate({ system: P.baseSystem(subject), parts: [{ text: P.teacherProfilePrompt(subject) }], temperature: 0.2 });
}

// Dateien, die für die Klausur gelesen werden müssen
export function examFileIds(exam) {
  const subject = subjectById(exam.subjectId);
  const ids = [...(exam.materialIds || [])];
  if (exam.useArchive !== false && subject) ids.push(...(subject.archive || []));
  return ids.filter((id) => state.files[id]);
}

export function examNeedsProfile(exam) {
  const subject = subjectById(exam.subjectId);
  if (!subject || subject.teacherProfile) return false;
  return !!((exam.useArchive !== false && subject.archive?.length) || P.vocabProfileFor(subject));
}

export function learningDays(exam) {
  if (!exam.date) return [];
  const days = [];
  const today = parseISO(isoDate(new Date()));
  const end = parseISO(exam.date);
  const last = end <= today ? today : new Date(end.getTime() - 86400000);
  for (let d = new Date(today); d <= last && days.length < 28; d.setDate(d.getDate() + 1)) {
    const iso = isoDate(d);
    days.push({ iso, label: `${relDay(iso)}, ${fmtDate(iso)}` });
  }
  return days;
}

export async function createPlan(exam) {
  const days = learningDays(exam);
  const plan = await generate({ system: P.baseSystem(subjectById(exam.subjectId)), parts: [{ text: P.planPrompt(exam, days) }], json: true, temperature: 0.3 });
  const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
  const themen = (plan.themen || []).filter((t) => t?.titel).slice(0, 8).map((t) => ({ titel: String(t.titel), beschreibung: t.beschreibung || '', schwerpunkte: t.schwerpunkte || [], tag: isDay(t.tag) ? t.tag : null }));
  if (!themen.length) throw new AIError('Die KI hat keinen brauchbaren Plan geliefert. Bitte nochmal versuchen.');
  const lastDay = days.length ? days[days.length - 1].iso : null;
  const unit = (typ, titel, ziel, tag, themaIndex) => ({ id: uid(), typ, titel, ziel, tag, themaIndex, status: 'open' });
  plan.themen = themen;
  plan.abschnitte = [
    ...themen.map((t, ti) => ({
      titel: t.titel, themaIndex: ti,
      einheiten: [
        unit('lernzettel', `Lernzettel: ${t.titel}`, 'Alles Wichtige zum Thema auf einen Blick – auch als PDF', t.tag, ti),
        unit('quiz', `Quiz: ${t.titel}`, 'Begriffe, Fakten und Zahlen schnell abrufen', t.tag, ti),
        unit('aufgaben', `Anwenden: ${t.titel}`, 'Klausurnahe Aufgaben mit strenger Korrektur', t.tag, ti),
      ],
    })),
    { titel: 'Abschluss', abschluss: true, einheiten: [
      unit('gesamtzettel', 'Gesamt-Lernzettel', 'Die ganze Klausur auf zwei Seiten', lastDay, null),
      unit('probeklausur', 'Probeklassenarbeit', 'Komplette Klassenarbeit im Stil deiner Lehrkraft', lastDay, null),
    ] },
  ];
  delete plan.abschnitte_alt;
  for (const u of allUnits(exam)) delete state.sessions[u.id];
  exam.plan = plan;
  delete exam.building;
}

// ================================================================ Vokabeln
export function buildVocabPlan(set) {
  const today = parseISO(isoDate(new Date()));
  const days = [];
  const end = set.testDate ? parseISO(set.testDate) : new Date(today.getTime() + 6 * 86400000);
  const last = set.testDate ? (end <= today ? today : new Date(end.getTime() - 86400000)) : end;
  for (let d = new Date(today); d <= last && days.length < 21; d.setDate(d.getDate() + 1)) days.push(isoDate(d));
  const ids = set.words.map((w) => w.id);
  const learnDays = days.length > 1 ? days.length - 1 : 1;
  const chunk = Math.max(1, Math.ceil(ids.length / learnDays));
  const plan = days.map((iso, i) => ({ iso, neu: i < learnDays ? ids.slice(i * chunk, (i + 1) * chunk) : [], wdh: [], probe: i === days.length - 1, done: false }));
  plan.forEach((e, i) => {
    const back = [plan[i - 1], plan[i - 3]].filter(Boolean).flatMap((x) => x.neu);
    e.wdh = e.probe && days.length > 1 ? ids : [...new Set(back)].filter((id) => !e.neu.includes(id));
  });
  if (days.length === 1) { plan[0].neu = ids; plan[0].wdh = []; }
  set.plan = plan;
}

const normWord = (x) => String(x || '').toLowerCase().replace(/\s+/g, ' ').trim();

// Liest alle noch offenen Seiten einer Vokabelliste aus (set.pendingFiles) und baut den Lernplan.
export async function buildVocabSet(set, onPage = null) {
  const fresh = !set.words?.length;
  set.words ||= [];
  let added = 0;
  for (const fid of [...(set.pendingFiles || [])]) {
    const res = await generate({ system: P.vocabSystem(), parts: [{ text: P.vocabExtractPrompt() }, await partOf(fid)], json: true, temperature: 0.1 });
    if (fresh && (!set.titel || set.titel === 'Neue Vokabeln') && res.titel) set.titel = res.titel;
    if (fresh && !set.spracheFix && res.sprache) { set.sprache = res.sprache; set.spracheFix = true; }
    for (const v of res.vokabeln || []) {
      if (!v?.wort || !v?.uebersetzung) continue;
      if (set.words.some((x) => normWord(x.w) === normWord(v.wort))) continue;
      set.words.push({ id: uid(), w: String(v.wort).trim(), t: String(v.uebersetzung).trim(), ex: v.beispiel || '', info: v.info || '', box: 0 });
      added++;
    }
    set.pendingFiles = set.pendingFiles.filter((x) => x !== fid);
    if (!set.fileIds.includes(fid)) set.fileIds.push(fid);
    onPage?.(fid);
  }
  if (!set.words.length) throw new AIError('Ich konnte auf den Seiten keine Vokabeln erkennen. Sind die Fotos scharf?');
  set.sprache ||= 'Englisch';
  if (added || !set.plan) buildVocabPlan(set);
  delete set.building;
  delete set.spracheFix;
  return added;
}

// Testprofil aus alten Vokabeltests. Danach auch das Lehrerprofil des passenden Fachs auffrischen.
export async function buildVocabTestProfile(sprache) {
  const t = vocabState().tests[sprache];
  if (!t?.fileIds?.length) { if (t) delete t.building; return null; }
  const parts = [{ text: P.vocabTestProfilePrompt(sprache) }];
  const leads = t.fileIds.filter((fid) => state.files[fid] && isGroupLead(fid));
  for (let i = 0; i < leads.length; i++) {
    const pages = groupOf(leads[i]);
    for (let k = 0; k < pages.length; k++) {
      parts.push({ text: `Test ${i + 1}${pages.length > 1 ? `, Seite ${k + 1} von ${pages.length}` : ''}:` });
      parts.push(await partOf(pages[k]));
    }
  }
  t.profil = await generate({ system: P.vocabSystem(), parts, temperature: 0.2 });
  delete t.building;
  const subject = state.subjects.find((s) => P.vocabSpracheOf(s) === sprache);
  if (subject) await buildTeacherProfile(subject);
  return subject || null;
}

// ================================================================ Arbeitsblatt lösen
export async function solveSheet(item, onStep = null) {
  const subject = subjectById(item.subjectId);
  if (!item.loesung) {
    const parts = [{ text: P.solvePrompt(subject, item.note || '') }];
    for (const id of item.fileIds) parts.push(await partOf(id));
    const text = await generate({ system: P.baseSystem(subject), parts, temperature: 0.2 });
    const first = text.match(/^##\s+(.*)$/m);
    item.loesung = text;
    item.ersteAufgabe = first ? first[1].slice(0, 80) : '';
  }
  onStep?.(1);
  item.annot ||= {};
  for (const fid of item.fileIds) {
    if (!state.files[fid]?.mime?.startsWith('image/') || item.annot[fid]) continue;
    try {
      const res = await generate({ system: P.baseSystem(subject), parts: [{ text: P.annotatePrompt(item.loesung) }, await partOf(fid)], json: true, temperature: 0.1 });
      item.annot[fid] = (res.eintraege || []).filter((e) => Array.isArray(e.box) && e.box.length === 4 && e.box.every((n) => Number.isFinite(Number(n))) && ['text', 'kreuz', 'markieren', 'kreis', 'pruefen'].includes(e.art))
        .map((e) => ({ ...e, box: e.box.map((n) => Math.max(0, Math.min(1000, Number(n)))) }));
    } catch (e) { if (e?.notYet) throw e; console.warn('Eintragen fehlgeschlagen', e?.message); }
  }
  delete item.building;
}

// ================================================================ Hintergrund: offene Aufträge und Ergebnisse
// Was gerade noch erstellt werden muss – daraus macht die App Aufträge für den Hintergrund-Dienst.
export function pendingJobs() {
  const jobs = [];
  const today = isoDate(new Date());
  for (const exam of state.exams) {
    if (exam.date && exam.date < today) continue;
    if (exam.building || (exam.plan && missingPhases(exam).flat().length)) jobs.push({ key: exam.id, type: 'exam', id: exam.id });
  }
  for (const s of state.subjects) if (s.profileBuilding) jobs.push({ key: `p_${s.id}`, type: 'subject', id: s.id });
  for (const set of vocabState().sets) if (set.building) jobs.push({ key: `v_${set.id}`, type: 'vocab', id: set.id });
  for (const [sprache, t] of Object.entries(vocabState().tests || {})) if (t?.building) jobs.push({ key: `t_${sprache}`, type: 'vtest', id: sprache });
  for (const item of state.solved || []) if (item.building) jobs.push({ key: `s_${item.id}`, type: 'solve', id: item.id });
  return jobs;
}

// Pfade in den Stand: Text = Schlüssel, { id } = Eintrag in einer Liste mit dieser id
function step(obj, seg) {
  if (obj == null) return undefined;
  if (seg && typeof seg === 'object') return Array.isArray(obj) ? obj.find((x) => x?.id === seg.id) : undefined;
  return obj[seg];
}
export function getPath(root, path) { return path.reduce(step, root); }

function isEmpty(v, path) {
  if (path[0] === 'sessions') return !(v && (v.lernzettel || v.fragen || v.aufgaben));
  return v == null || v === '' || (Array.isArray(v) && !v.length);
}

/** Ergebnisse des Hintergrund-Dienstes einspielen. Gibt true zurück, wenn sich etwas geändert hat.
 *  require: Pfad, der wahr sein muss (z. B. "wird noch erstellt") – sonst wird nichts überschrieben. */
export function applyOps(root, ops, require = null) {
  if (require && !getPath(root, require)) return false;
  let changed = false;
  for (const op of ops) {
    const parent = getPath(root, op.path.slice(0, -1));
    const key = op.path[op.path.length - 1];
    if (parent == null || typeof key !== 'string') continue;
    if (op.onlyIfEmpty && !isEmpty(parent[key], op.path)) continue;
    if (op.del) { if (key in parent) { delete parent[key]; changed = true; } continue; }
    parent[key] = op.value;
    changed = true;
  }
  return changed;
}
