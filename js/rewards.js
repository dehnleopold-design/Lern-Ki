// Fortschritt & Belohnungen: Lerntage (Serie), Einheiten, Quizze – und was man damit freischaltet.
// Gespeichert in state.stats (wird mit dem Konto synchronisiert).

import { state, save } from './store.js';

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dayBefore = (iso) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); };

// Was man wofür bekommt. need: streak (Tage am Stück), units (Lerneinheiten), quizzes, perfect (Quizze mit 100 %)
export const UNLOCKS = [
  { kind: 'jelly', id: 'pixel', need: { quizzes: 1 }, label: 'Mach dein erstes Quiz' },
  { kind: 'jelly', id: 'regenbogen', need: { perfect: 1 }, label: 'Ein Quiz mit 100 %' },
  { kind: 'skin', id: 'ozean', need: { streak: 3 }, label: '3 Tage am Stück lernen' },
  { kind: 'skin', id: 'pixel', need: { quizzes: 5 }, label: '5 Quizze machen' },
  { kind: 'jelly', id: 'neon', need: { streak: 5 }, label: '5 Tage am Stück lernen' },
  { kind: 'jelly', id: 'streber', need: { units: 10 }, label: '10 Lerneinheiten schaffen' },
  { kind: 'skin', id: 'galaxis', need: { perfect: 3 }, label: '3 Quizze mit 100 %' },
  { kind: 'skin', id: 'futuristisch', need: { streak: 7 }, label: '7 Tage am Stück lernen' },
  { kind: 'skin', id: 'terminal', need: { units: 25 }, label: '25 Lerneinheiten schaffen' },
];
const key = (u) => `${u.kind}:${u.id}`;
// Von Control für dieses Konto freigegeben: alles ist offen (z. B. Admins)
let allOpen = false;
export function setAllUnlocked(v) { allOpen = !!v; }

function allUnits() {
  const out = [];
  for (const e of state.exams || []) for (const sec of e.plan?.abschnitte || []) for (const u of sec.einheiten || []) out.push(u);
  return out;
}

// Beim ersten Mal: bisherigen Fortschritt übernehmen und aktuell genutzte Designs behalten
export function stats() {
  if (!state.stats) {
    const units = allUnits().filter((u) => u.status === 'done');
    const quizzes = units.filter((u) => u.typ === 'quiz');
    state.stats = {
      days: {},
      units: units.length,
      quizzes: quizzes.length,
      perfect: quizzes.filter((u) => u.score === 100).length,
      owned: [state.settings?.skin ? `skin:${state.settings.skin}` : null, state.settings?.jelly ? `jelly:${state.settings.jelly}` : null].filter(Boolean),
      seen: [],
    };
    // Was jetzt schon erreicht ist, gilt als bekannt (keine Feier-Flut beim Update)
    state.stats.seen = UNLOCKS.filter((u) => reached(u)).map(key);
    save();
  }
  // XP gab es anfangs nicht: bisherigen Fortschritt anrechnen
  if (state.stats.xp === undefined) {
    state.stats.xp = (state.stats.units || 0) * 40 + (state.stats.quizzes || 0) * 30 + (state.stats.perfect || 0) * 20;
    save();
  }
  return state.stats;
}

export function streak() {
  const days = stats().days;
  let d = today();
  if (!days[d]) d = dayBefore(d); // heute noch nichts gemacht: Serie von gestern zählt noch
  let n = 0;
  while (days[d]) { n++; d = dayBefore(d); }
  return n;
}

const value = (k) => (k === 'streak' ? streak() : stats()[k] || 0);
function reached(u) { return Object.entries(u.need).every(([k, v]) => value(k) >= v); }

export function isUnlocked(kind, id) {
  const u = UNLOCKS.find((x) => x.kind === kind && x.id === id);
  if (!u || allOpen) return true;
  return stats().owned.includes(key(u)) || reached(u);
}
export function unlockInfo(kind, id) {
  const u = UNLOCKS.find((x) => x.kind === kind && x.id === id);
  if (!u || isUnlocked(kind, id)) return null;
  const [k, v] = Object.entries(u.need)[0];
  return { label: u.label, have: Math.min(value(k), v), need: v };
}

/**
 * Etwas wurde gelernt. type: 'unit' | 'quiz'; perfect: Quiz mit 100 %.
 * Gibt Ereignisse zum Feiern zurück: [{ type: 'perfect'|'unit'|'streak'|'unlock', ... }]
 */
export function recordActivity(type, { perfect = false } = {}) {
  const s = stats();
  const events = [];
  const before = streak();
  const firstToday = !s.days[today()];
  s.days[today()] = true;
  // nur die letzten ~120 Tage aufheben
  const keys = Object.keys(s.days).sort();
  if (keys.length > 120) for (const k of keys.slice(0, keys.length - 120)) delete s.days[k];
  if (type === 'unit') { s.units++; events.push({ type: 'unit' }); }
  if (type === 'quiz') { s.units++; s.quizzes++; if (perfect) { s.perfect++; events.push({ type: 'perfect' }); } }
  const now = streak();
  if (firstToday && now >= 2 && now > before) events.push({ type: 'streak', days: now });
  for (const u of UNLOCKS) if (!s.seen.includes(key(u)) && reached(u)) { s.seen.push(key(u)); events.push({ type: 'unlock', unlock: u }); }
  save();
  return events;
}

// ---------------------------------------------------------------- Ränge & XP
// XP gibt es fürs Lernen: Lerneinheit 40, Quiz 20–100 (je nach Ergebnis), jede korrigierte Aufgabe 10–50 (je nach Punkten).
export const RANKS = [
  { id: 'bronze', name: 'Bronze', min: 0 },
  { id: 'silber', name: 'Silber', min: 500 },
  { id: 'gold', name: 'Gold', min: 1200 },
  { id: 'diamant', name: 'Diamant', min: 2200 },
  { id: 'mythisch', name: 'Mythisch', min: 3600 },
  { id: 'legendaer', name: 'Legendär', min: 5400 },
  { id: 'meister', name: 'Meister', min: 7800 },
  { id: 'pro', name: 'Pro', min: 11000 },
];
export const XP_UNIT = 40;
export const xpForQuiz = (pct) => 20 + Math.round(Math.max(0, Math.min(100, pct || 0)) * 0.8);
export const xpForTask = (got, max) => Math.round(10 + 40 * Math.max(0, Math.min(1, max ? got / max : 0)));

export const xpTotal = () => stats().xp || 0;
export const hasTopRank = () => allOpen;

// Rang zu einer XP-Zahl: Stufe I–III innerhalb des Rangs, Anteil bis zum nächsten Rang
export function rankOf(xp = xpTotal()) {
  if (allOpen) xp = Math.max(xp, RANKS[RANKS.length - 1].min); // von Control freigegeben: höchster Rang
  let index = 0;
  for (let i = 0; i < RANKS.length; i++) if (xp >= RANKS[i].min) index = i;
  const r = RANKS[index], next = RANKS[index + 1] || null;
  const span = next ? next.min - r.min : 0;
  const frac = next ? (xp - r.min) / span : 1;
  return { ...r, index, next, xp, span, frac, step: next ? Math.min(2, Math.floor(frac * 3)) : 0 };
}

export function addXp(n) {
  const s = stats();
  const before = rankOf();
  s.xp = (s.xp || 0) + Math.max(0, Math.round(n));
  save();
  return { before, after: rankOf() };
}
