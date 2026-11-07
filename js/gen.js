// Inhalte einer Lerneinheit erzeugen (Lernzettel, Quiz, Aufgaben).
// Wird von der App UND vom Hintergrund-Dienst (server/background.mjs) benutzt – deshalb ohne Oberfläche.

import { state } from './store.js';
import { generate, AIError } from './ai.js';
import * as P from './prompts.js';

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

export async function genQuiz(exam, unit) {
  const topic = exam.plan?.themen?.[unit.themaIndex] || { titel: unit.titel };
  const prev = state.sessions[unit.id]?.alteFragen || [];
  const res = await generate({ system: P.baseSystem(P.subjectOf(exam)), parts: [{ text: P.quizPrompt(exam, topic, lernzettelText(exam, unit.themaIndex), prev) }], json: true, temperature: 0.7 });
  const fragen = (res.fragen || []).filter((q) => q?.frage && ['mc', 'wahrfalsch', 'eingabe'].includes(q.typ)
    && (q.typ !== 'mc' || (Array.isArray(q.optionen) && q.optionen.length >= 2 && Number.isInteger(q.richtig))));
  if (!fragen.length) throw new AIError('Keine brauchbaren Quizfragen erhalten. Bitte nochmal versuchen.');
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
