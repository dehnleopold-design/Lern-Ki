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
