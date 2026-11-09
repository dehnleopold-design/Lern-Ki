import { state, loadState, save, replaceState, clearAll, allBlobs, putBlob, uid, useAccount, hasLocalProfile } from './store.js';
import { startSync, syncNow, syncStatus, onSyncStatus, deleteCloudData, push, requestJob, backgroundAvailable } from './sync.js';
import { deleteAccount } from './auth.js';
import { authEnabled, initAuth, signInGoogle, signInEmail, registerEmail, resetPassword, signOutUser, currentUser, authErrorText } from './auth.js';
import { generate, aiReady, listGeminiModels, pickDefaultModel, AIError, onAIStatus, FALLBACK_PRESETS, listOpenAIModels, pickFallbackModel, fallbackReady } from './ai.js';
import { addFile, removeFile, filePart, thumbURL, pickFiles } from './files.js';
import * as P from './prompts.js';
import { allUnits, hasContent, lernzettelText, missingPhases, genLernzettel, genQuiz, genAufgaben, generateUnit, mixOptions, setPartLoader, digestFile, groupOf, isGroupLead, resetGroup, buildTeacherProfile, examFileIds, examNeedsProfile, createPlan, buildVocabPlan, buildVocabSet, buildVocabTestProfile, solveSheet, pendingJobs } from './gen.js';
import { gradeLabel, gradeOptions, percentToGrade, reachesTarget, scale } from './grades.js';
import { downloadLernzettel, sheetHTML, SHEET_CSS } from './pdf.js';
import { openFile, fileKindLabel } from './viewer.js';
import { initNotes, viewNotes, viewNotebook } from './notes.js';

setPartLoader(filePart); // App liest Dateien aus dem Gerätespeicher
import { cleanText, jellyTransition } from './ui.js';
import { h, add, md, mdEl, mascot, speech, icon, toast, confirmDialog, isoDate, parseISO, fmtDate, relDay } from './ui.js';

const APP_VERSION = '2.37 (9.11.)';
const app = document.getElementById('app');

// ---------------------------------------------------------------- Konstanten
const DEFAULT_SUBJECTS = [
  ['Deutsch', 'DE', '#93c5fd'], ['Mathe', 'MA', '#fdba74'], ['Englisch', 'EN', '#93c5fd'],
  ['Geography', 'GEO', '#fda4af', 'en'], ['Biologie', 'BIO', '#86efac'], ['Chemie', 'CH', '#86efac'],
  ['Physik', 'PH', '#86efac'], ['Geschichte', 'GE', '#fcd34d'], ['Politik-Gesellschaft-Wirtschaft', 'PGW', '#fda4af'],
  ['Philosophie', 'PHI', '#c4b5fd'], ['Theater', 'TH', '#f0abfc'], ['Sport', 'SP', '#5eead4'], ['Athletik', 'ATH', '#5eead4'],
];
const EXTRA_SUBJECTS = ['Spanisch', 'Französisch', 'Latein', 'Informatik', 'Kunst', 'Musik', 'Religion', 'Ethik', 'Wirtschaft', 'Erdkunde', 'Psychologie', 'Pädagogik'];
const STATES = ['Baden-Württemberg', 'Bayern', 'Berlin', 'Brandenburg', 'Bremen', 'Hamburg', 'Hessen', 'Mecklenburg-Vorpommern', 'Niedersachsen', 'Nordrhein-Westfalen', 'Rheinland-Pfalz', 'Saarland', 'Sachsen', 'Sachsen-Anhalt', 'Schleswig-Holstein', 'Thüringen'];
const SCHOOL_TYPES = ['Gymnasium', 'Stadtteilschule', 'Gesamtschule', 'Realschule', 'Oberschule', 'Berufliche Schule', 'Andere'];
const LEARN_STYLES = ['Kurze Erklärungen', 'Aufgaben selbst lösen', 'Probeklausuren', 'Abfragen lassen', 'Selbst erklären (wie mündlich)', 'Beispiele & Musterlösungen'];
const SECTION_COLORS = ['#a78bfa', '#c084fc', '#818cf8', '#e879f9', '#a5b4fc', '#d8b4fe'];
const UNIT_ICON = { lernzettel: 'file', quiz: 'quiz', aufgaben: 'pencil', gesamtzettel: 'book', probeklausur: 'exam', verstehen: 'book', ueben: 'pencil', anwenden: 'bulb' };
const UNIT_LABEL = { lernzettel: 'Schritt 1 · Lernzettel', quiz: 'Schritt 2 · Quiz', aufgaben: 'Schritt 3 · Anwenden', gesamtzettel: 'Abschluss · Gesamt-Lernzettel', probeklausur: 'Abschluss · Probeklassenarbeit', verstehen: 'Verstehen', ueben: 'Üben', anwenden: 'Anwenden' };
const PALETTE = ['#a78bfa', '#f0abfc', '#93c5fd', '#fcd34d', '#86efac', '#fda4af', '#c4b5fd', '#fdba74'];

// ---------------------------------------------------------------- Routing
let route = { name: 'plan', params: {} };
const ui = { selectedUnit: null, busy: {} };

function go(name, params = {}) {
  // Probeklassenarbeit verlassen, ohne abzugeben: Timer beim nächsten Öffnen wieder von vorn
  if (route.name === 'session') {
    const se = state.sessions[route.params.unitId];
    const ex = examById(route.params.examId);
    const un = ex && allUnits(ex).find((u) => u.id === route.params.unitId);
    if (un?.typ === 'probeklausur' && se && !se.grading && se.startedAt) { se.startedAt = null; save(); }
  }
  route = { name, params };
  render();
  window.scrollTo(0, 0);
}

// ---------- Farben der App (Mehr → Design)
const THEMES = [
  { id: 'lila', name: 'Lila', a: '#8b5cf6', b: '#b794ff' },
  { id: 'indigo', name: 'Indigo', a: '#6366f1', b: '#a5b4fc' },
  { id: 'blau', name: 'Blau', a: '#3b82f6', b: '#93c5fd' },
  { id: 'tuerkis', name: 'Türkis', a: '#0d9488', b: '#5eead4' },
  { id: 'gruen', name: 'Grün', a: '#16a34a', b: '#86efac' },
  { id: 'gold', name: 'Gold', a: '#ca8a04', b: '#fde047' },
  { id: 'orange', name: 'Orange', a: '#ea580c', b: '#fdba74' },
  { id: 'rot', name: 'Rot', a: '#dc2626', b: '#fca5a5' },
  { id: 'pink', name: 'Pink', a: '#db2777', b: '#f9a8d4' },
  { id: 'grau', name: 'Grau', a: '#64748b', b: '#cbd5e1' },
];
const isHex = (c) => /^#[0-9a-f]{6}$/i.test(c || '');
// Helle Hauptfarbe → dunkle Schrift auf Knöpfen, sonst weiß
function inkFor(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#111111' : '#ffffff';
}
function applyTheme() {
  const t = state.settings?.theme;
  const a = isHex(t?.a) ? t.a : THEMES[0].a;
  const b = isHex(t?.b) ? t.b : THEMES[0].b;
  const root = document.documentElement.style;
  if (root.getPropertyValue('--accent') === a && root.getPropertyValue('--accent-2') === b) return;
  root.setProperty('--accent', a);
  root.setProperty('--accent-2', b);
  root.setProperty('--accent-ink', inkFor(a));
}

function designSheet() {
  const cur = () => state.settings.theme || { id: 'lila', a: THEMES[0].a, b: THEMES[0].b };
  const body = h('div');
  const setTheme = (t) => { state.settings.theme = t; save(); render(); draw(); };
  const draw = () => {
    const t = cur();
    // Beim Ziehen nur anwenden (Farbwähler bleibt offen), beim Loslassen alles neu zeichnen
    const live = (k) => (e) => { state.settings.theme = { ...cur(), id: 'eigen', [k]: e.target.value }; save(); applyTheme(); };
    const done = () => { render(); draw(); };
    const a = h('input', { type: 'color', value: t.a, oninput: live('a'), onchange: done });
    const b = h('input', { type: 'color', value: t.b, oninput: live('b'), onchange: done });
    body.replaceChildren(
      h('div', { class: 'label' }, 'Farbschema'),
      h('div', { class: 'theme-grid' }, THEMES.map((x) => h('button', { class: `theme-opt ${t.id === x.id ? 'on' : ''}`, onclick: () => setTheme({ id: x.id, a: x.a, b: x.b }) },
        h('span', { class: 'theme-dot', style: { background: `linear-gradient(135deg, ${x.a} 50%, ${x.b} 50%)` } }), x.name))),
      h('div', { class: 'label' }, 'Eigene Farben'),
      h('label', { class: 'color-row' }, a, h('span', {}, h('strong', {}, 'Hauptfarbe'), h('div', { class: 'muted small' }, 'Knöpfe, aktive Reiter, Fortschritt'))),
      h('label', { class: 'color-row' }, b, h('span', {}, h('strong', {}, 'Zweitfarbe'), h('div', { class: 'muted small' }, 'Hervorhebungen, Schrift auf dunklen Flächen'))),
      h('div', { class: 'label' }, 'Vorschau'),
      h('div', { class: 'theme-preview' }, h('button', { class: 'btn primary small' }, 'Knopf'), h('span', { class: 'chip active' }, 'Aktiv'), h('span', { class: 'chip-static prep' }, icon('sparkles', 14), 'Hinweis'), progressRing(64, 44)),
      t.id !== 'lila' ? h('button', { class: 'btn ghost block', onclick: () => { delete state.settings.theme; save(); render(); draw(); } }, 'Zurück zu Lila') : null);
  };
  draw();
  sheet('Design', [body]);
}

function render() {
  applyTheme();
  app.replaceChildren();
  if (!state.profile && !['onboarding', 'login'].includes(route.name)) route = { name: 'onboarding', params: {} };
  const views = { login: viewLogin, onboarding: viewOnboarding, prepare: viewPrepare, plan: viewPlan, pick: viewPick, vocab: viewVocab, solve: viewSolveNew, solved: viewSolved, vnew: viewVocabNew, vset: viewVocabSet, vwords: viewVocabWords, vplan: viewVocabPlan, vquiz: viewVocabQuiz, vtests: viewVocabTests, files: viewFiles, week: viewWeek, wimport: viewWeekImport, todo: viewTodos, notes: viewNotes, notebook: viewNotebook, calendar: viewCalendar, newExam: viewNewExam, session: viewSession, subjects: viewSubjects, subject: viewSubject, tutor: viewTutor, settings: viewSettings };
  const v = (views[route.name] || viewPlan)(route.params);
  add(app, v);
}

function tabbar(active) {
  const tab = (name, ic, label) => h('button', { class: `tab ${active === name ? 'active' : ''}`, onclick: () => go(name), 'aria-label': label }, icon(ic, 22), h('span', {}, label));
  // Kamera-Knopf in der Mitte: öffnet sofort die Kamera, das Foto landet in "Blatt lösen"
  const cam = h('button', { class: `tab ${active === 'solve' ? 'active' : ''}`, 'aria-label': 'Arbeitsblatt scannen', onclick: () => {
    startSolve();
    pickFiles({ accept: 'image/*', capture: 'environment', multiple: false }).then(async (files) => {
      for (const f of files) { try { nsv.fileIds.push(await addFile(f, { kind: 'sheet', subjectId: nsv.subjectId })); } catch (e) { toast(errorMsg(e), 'error'); } }
      if (route.name === 'solve') render();
    });
  } }, icon('camera', 22), h('span', {}, 'Scannen'));
  return h('nav', { class: 'tabbar' }, tab('plan', 'route', 'Prüfung'), tab('subjects', 'library', 'Fächer'), cam, tab('vocab', 'languages', 'Vokabeln'), tab('todo', 'checkc', 'To-dos'), tab('week', 'calendar', 'Pläne'), tab('settings', 'gear', 'Mehr'));
}

function topbar({ back, close, title, progress }) {
  return h('header', { class: 'topbar' },
    back ? h('button', { class: 'iconbtn', onclick: back, 'aria-label': 'Zurück' }, icon('back')) : h('span', { class: 'iconbtn-spacer' }),
    progress !== undefined
      ? h('div', { class: 'progress' }, h('div', { class: 'progress-fill', style: { width: `${Math.round(progress * 100)}%` } }))
      : h('div', { class: 'topbar-title' }, title || ''),
    close ? h('button', { class: 'iconbtn', onclick: close, 'aria-label': 'Schließen' }, icon('close')) : h('span', { class: 'iconbtn-spacer' }));
}

const subjectById = (id) => state.subjects.find((s) => s.id === id);
const examById = (id) => state.exams.find((e) => e.id === id);

function subjectBadge(s, size = 40) {
  return h('span', { class: 'badge', style: { background: `${s.color}22`, color: s.color, borderColor: s.color, width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size / 3.4)}px` } }, s.short || s.name.slice(0, 2).toUpperCase());
}

function makeSubject(name, short, color, language = 'de') {
  return { id: uid(), name, short: short || name.replace(/[^A-Za-zÄÖÜäöü]/g, '').slice(0, 3).toUpperCase(), color: color || PALETTE[state.subjects.length % PALETTE.length], language, level: 2, teacherNotes: '', teacherProfile: '', archive: [] };
}

// Bei Überlastung ohne Ersatz-Anbieter: direkt zum Einrichten führen.
function fallbackTip(msg) {
  if (fallbackReady() || state.settings.provider === 'openai' || !/überlastet|Limit/i.test(msg || '')) return null;
  return h('div', { class: 'fb-tip' },
    h('p', { class: 'small' }, 'Jelly kann im Moment nur Google fragen. Mit einem kostenlosen Ersatz-Anbieter (z. B. Groq) geht es weiter, wenn Google überlastet ist.'),
    h('button', { class: 'btn block', onclick: () => sheet('KI-Verbindung', [aiSetupBlock(false)]) }, icon('zap', 18), 'Ersatz-Anbieter einrichten'));
}

// Mehrere Dateien auf einmal? Fragen, ob sie Seiten EINES Dokuments sind (z. B. eine Klausur mit 3 Seiten).
async function askTogether(n, one, many) {
  if (n < 2) return false;
  return confirmDialog(`Gehören diese ${n} Dateien zu ${one} (mehrere Seiten)?`, `Ja, ${one}`, many, 'primary');
}

// Lädt Dateien hoch. together: alle als Seiten eines Dokuments. into: an ein bestehendes Dokument anhängen.
async function uploadPages(files, { kind, subjectId = null, together = false, into = null }) {
  let lead = into ? groupOf(into)[0] : null;
  const ids = [];
  for (const f of files) {
    try {
      const id = await addFile(f, { kind, subjectId, group: lead });
      if ((together || into) && !lead) lead = id;
      ids.push(id);
    } catch (e) { toast(errorMsg(e), 'error'); }
  }
  if (into && ids.length) resetGroup(lead);
  return ids;
}

async function removeGroup(id) {
  for (const x of groupOf(id)) await removeFile(x);
}

const archiveCountOf = (s) => (s.archive || []).filter((fid) => state.files[fid] && isGroupLead(fid)).length;
const pagesLabel = (id) => { const n = groupOf(id).length; return n > 1 ? `${n} Seiten` : '1 Seite'; };

function errorMsg(e) {
  return e instanceof AIError || e instanceof Error ? e.message : String(e);
}

// ================================================================ ONBOARDING (Fragebogen)
let draft = null;

function viewOnboarding() {
  if (!draft) {
    const p = state.profile;
    draft = {
      step: 0,
      name: p?.name || ui.suggestName || '', grade: p?.grade || '', schoolType: p?.schoolType || 'Gymnasium', state: p?.state || '',
      subjects: state.subjects.length ? state.subjects.map((s) => s.name) : DEFAULT_SUBJECTS.map((s) => s[0]),
      english: state.subjects.length ? state.subjects.filter((s) => s.language === 'en').map((s) => s.name) : ['Geography'],
      levels: Object.fromEntries(state.subjects.map((s) => [s.name, s.level])),
      minutesPerDay: p?.minutesPerDay || 30, learnStyles: p?.learnStyles || ['Aufgaben selbst lösen', 'Probeklausuren'],
      feedbackStyle: p?.feedbackStyle || 'hart', gradeScale: p?.gradeScale || '1-6', custom: '',
    };
  }
  const d = draft;
  const editing = !!state.profile;
  const chip = (label, active, onclick) => h('button', { class: `chip ${active ? 'active' : ''}`, onclick }, label);
  const rerender = () => render();
  const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const steps = [
    {
      q: editing ? 'Lass uns dein Profil aktualisieren.' : 'Hi! Ich bin Jelly. Bevor wir loslegen, stelle ich dir ein paar Fragen – damit dein Lernplan wirklich zu dir passt.',
      body: () => h('div', { class: 'stack center' }, h('p', { class: 'muted' }, 'Dauert ca. 2 Minuten. Alles bleibt auf deinem Gerät.')),
      ok: () => true,
    },
    {
      q: 'Wie soll ich dich nennen?',
      body: () => h('input', { class: 'input big', placeholder: 'Dein Vorname', value: d.name, oninput: (e) => { d.name = e.target.value; } }),
      ok: () => d.name.trim().length > 0,
    },
    {
      q: 'In welche Klasse gehst du – und auf welche Schulform?',
      body: () => h('div', { class: 'stack' },
        h('div', { class: 'label' }, 'Klassenstufe'),
        h('div', { class: 'chips' }, [5, 6, 7, 8, 9, 10, 11, 12, 13].map((g) => chip(String(g), d.grade === g, () => { d.grade = g; rerender(); }))),
        h('div', { class: 'label' }, 'Schulform'),
        h('div', { class: 'chips' }, SCHOOL_TYPES.map((t) => chip(t, d.schoolType === t, () => { d.schoolType = t; rerender(); })))),
      ok: () => !!d.grade,
    },
    {
      q: 'In welchem Bundesland ist deine Schule? (Wichtig für Operatoren und Bewertung.)',
      body: () => h('div', { class: 'list' }, STATES.map((s) => h('button', { class: `list-item ${d.state === s ? 'active' : ''}`, onclick: () => { d.state = s; rerender(); } }, s))),
      ok: () => !!d.state,
    },
    {
      q: 'Welche Fächer hast du? Tippe an, was nicht passt. Fehlende kannst du unten ergänzen – auch später noch.',
      body: () => {
        const all = [...new Set([...DEFAULT_SUBJECTS.map((s) => s[0]), ...d.subjects, ...EXTRA_SUBJECTS])];
        return h('div', { class: 'stack' },
          h('div', { class: 'chips' }, all.map((n) => chip(n, d.subjects.includes(n), () => { d.subjects = toggle(d.subjects, n); rerender(); }))),
          h('div', { class: 'row gap' },
            h('input', { class: 'input', placeholder: 'Anderes Fach …', value: d.custom, oninput: (e) => { d.custom = e.target.value; } }),
            h('button', { class: 'btn small', onclick: () => { const n = d.custom.trim(); if (n && !d.subjects.includes(n)) d.subjects.push(n); d.custom = ''; rerender(); } }, 'Hinzufügen')));
      },
      ok: () => d.subjects.length > 0,
    },
    {
      q: 'In welchen Fächern ist die Unterrichtssprache Englisch? Dort bekommst du Aufgaben und Korrektur auf Englisch – inklusive Sprachkorrektur.',
      body: () => h('div', { class: 'chips' }, d.subjects.map((n) => chip(n, d.english.includes(n), () => { d.english = toggle(d.english, n); rerender(); }))),
      ok: () => true,
    },
    {
      q: 'Sei ehrlich: Wie gut bist du gerade in den Fächern?',
      body: () => h('div', { class: 'stack' }, d.subjects.map((n) => h('div', { class: 'level-row' },
        h('span', {}, n),
        h('div', { class: 'seg' }, [[1, 'schwach'], [2, 'mittel'], [3, 'stark']].map(([v, l]) =>
          h('button', { class: `seg-btn ${(d.levels[n] || 2) === v ? 'active' : ''}`, onclick: () => { d.levels[n] = v; rerender(); } }, l)))))),
      ok: () => true,
    },
    {
      q: 'Wie viel Zeit hast du an einem normalen Tag zum Lernen für eine Klausur?',
      body: () => h('div', { class: 'list' }, [15, 30, 45, 60, 90].map((m) => h('button', { class: `list-item ${d.minutesPerDay === m ? 'active' : ''}`, onclick: () => { d.minutesPerDay = m; rerender(); } }, `${m} Minuten`))),
      ok: () => true,
    },
    {
      q: 'Wie lernst du am besten? (Mehrfachauswahl)',
      body: () => h('div', { class: 'chips' }, LEARN_STYLES.map((s) => chip(s, d.learnStyles.includes(s), () => { d.learnStyles = toggle(d.learnStyles, s); rerender(); }))),
      ok: () => d.learnStyles.length > 0,
    },
    {
      q: 'Wie soll ich dich korrigieren?',
      body: () => h('div', { class: 'list' },
        h('button', { class: `list-item tall ${d.feedbackStyle === 'hart' ? 'active' : ''}`, onclick: () => { d.feedbackStyle = 'hart'; rerender(); } },
          h('strong', {}, 'Schonungslos ehrlich'), h('span', { class: 'muted' }, 'Kein Schönreden, jeder Fehler wird benannt, keine Gnadenpunkte.')),
        h('button', { class: `list-item tall ${d.feedbackStyle === 'mild' ? 'active' : ''}`, onclick: () => { d.feedbackStyle = 'mild'; rerender(); } },
          h('strong', {}, 'Direkt, aber ermutigend'), h('span', { class: 'muted' }, 'Fehler werden genauso benannt, nur freundlicher verpackt.'))),
      ok: () => true,
    },
    {
      q: 'Welche Notenskala nutzt deine Schule?',
      body: () => h('div', { class: 'list' },
        h('button', { class: `list-item ${d.gradeScale === '1-6' ? 'active' : ''}`, onclick: () => { d.gradeScale = '1-6'; rerender(); } }, 'Noten 1–6'),
        h('button', { class: `list-item ${d.gradeScale === '0-15' ? 'active' : ''}`, onclick: () => { d.gradeScale = '0-15'; rerender(); } }, 'Punkte 0–15 (Oberstufe)')),
      ok: () => true,
    },
  ];

  if (!editing || !aiReady()) {
    steps.push({
      q: 'Letzter Schritt: Verbinde mich mit einer KI. Mit Google Gemini ist das kostenlos.',
      body: () => aiSetupBlock(true, () => render()),
      ok: () => true,
      nextLabel: () => (aiReady() ? 'Weiter' : 'Später einrichten'),
    });
  }

  const step = steps[d.step];
  const finish = () => {
    state.profile = { name: d.name.trim(), grade: d.grade, schoolType: d.schoolType, state: d.state, minutesPerDay: d.minutesPerDay, learnStyles: d.learnStyles, feedbackStyle: d.feedbackStyle, gradeScale: d.gradeScale };
    // Fächer abgleichen: neue anlegen, bestehende behalten (inkl. Archiv), abgewählte ohne Klausuren entfernen
    const keep = [];
    for (const name of d.subjects) {
      let s = state.subjects.find((x) => x.name === name);
      if (!s) {
        const preset = DEFAULT_SUBJECTS.find((x) => x[0] === name);
        s = makeSubject(name, preset?.[1], preset?.[2]);
      }
      if (!s.langSet) s.language = d.english.includes(name) ? 'en' : 'de';
      s.level = d.levels[name] || s.level || 2;
      keep.push(s);
    }
    for (const s of state.subjects) if (!keep.includes(s) && state.exams.some((e) => e.subjectId === s.id)) keep.push(s);
    state.subjects = keep;
    save();
    draft = null;
    go('plan');
  };

  return h('div', { class: 'screen' },
    topbar({ back: d.step > 0 ? () => { d.step--; render(); } : editing ? () => { draft = null; go('settings'); } : null, close: editing ? () => { draft = null; go('settings'); } : null, progress: (d.step + 1) / steps.length }),
    h('main', { class: 'content narrow' },
      speech(step.q),
      h('div', { class: 'step-body' }, step.body())),
    h('footer', { class: 'footer' },
      h('button', {
        class: 'btn primary block',
        onclick: () => {
          if (!step.ok()) { toast('Bitte erst auswählen bzw. ausfüllen.'); return; }
          if (d.step < steps.length - 1) { d.step++; render(); } else finish();
        },
      }, step.nextLabel ? step.nextLabel() : d.step === steps.length - 1 ? 'Fertig' : d.step === 0 ? 'Los geht’s' : 'Weiter')));
}

// ================================================================ KI-Einrichtung (wiederverwendbar)
let cachedModels = null;
function aiSetupBlock(compact = false, onChange = null) {
  const s = state.settings;
  const wrap = h('div', { class: 'stack' });
  const draw = () => {
    wrap.replaceChildren(
      h('div', { class: 'seg' },
        h('button', { class: `seg-btn ${s.provider === 'gemini' ? 'active' : ''}`, onclick: () => { s.provider = 'gemini'; save(); draw(); } }, 'Google Gemini (empfohlen)'),
        h('button', { class: `seg-btn ${s.provider === 'openai' ? 'active' : ''}`, onclick: () => { s.provider = 'openai'; save(); draw(); } }, 'Anderer Anbieter')),
      s.provider === 'gemini' ? geminiBlock() : openaiBlock(),
      s.provider === 'gemini' && !compact ? fallbackBlock() : null);
  };
  const geminiBlock = () => {
    const status = h('div', { class: 'muted small' }, s.apiKey && s.model ? `Verbunden · Modell: ${s.model}` : '');
    const select = h('select', { class: 'input', onchange: (e) => { s.model = e.target.value; save(); status.textContent = `Modell: ${s.model}`; } });
    const fillSelect = (models) => {
      select.replaceChildren(...models.map((m) => h('option', { value: m.id, selected: m.id === s.model }, `${m.label} (${m.id})`)));
    };
    if (cachedModels) fillSelect(cachedModels);
    else if (s.model) fillSelect([{ id: s.model, label: s.model }]);
    const keyInput = h('input', { class: 'input', type: 'password', autocomplete: 'off', placeholder: 'API-Schlüssel einfügen (beginnt meist mit AIza…)', value: s.apiKey, oninput: (e) => { s.apiKey = e.target.value.trim(); save(); } });
    const testBtn = h('button', {
      class: 'btn',
      onclick: async () => {
        if (!s.apiKey) { toast('Erst den Schlüssel einfügen.'); return; }
        testBtn.disabled = true; testBtn.textContent = 'Prüfe …';
        try {
          const models = await listGeminiModels(s.apiKey);
          if (!models.length) throw new Error('Keine passenden Modelle gefunden.');
          if (!models.some((m) => m.id === s.model)) s.model = pickDefaultModel(models);
          cachedModels = models;
          s.models = models;
          fillSelect(models);
          save();
          status.textContent = `✓ Verbunden · ${models.length} Modelle · gewählt: ${s.model}`;
          toast('KI verbunden!', 'ok');
          onChange?.();
        } catch (e) { status.textContent = errorMsg(e); toast(errorMsg(e), 'error'); }
        testBtn.disabled = false; testBtn.textContent = 'Schlüssel prüfen & Modelle laden';
      },
    }, 'Schlüssel prüfen & Modelle laden');
    return h('div', { class: 'stack' },
      h('ol', { class: 'howto' },
        h('li', {}, 'Öffne ', h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener' }, 'aistudio.google.com/apikey'), ' und melde dich mit einem Google-Konto an.'),
        h('li', {}, '„API-Schlüssel erstellen“ tippen und den Schlüssel kopieren.'),
        h('li', {}, 'Hier einfügen und prüfen.')),
      !compact ? h('p', { class: 'muted small' }, 'Wichtig: Laut Googles Bedingungen muss der Kontoinhaber volljährig sein – ggf. erstellt ein Elternteil den Schlüssel. Für Nutzer in der EU nutzt Google die Eingaben laut seinen Bedingungen nicht zur Produktverbesserung, auch in der kostenlosen Stufe. Trotzdem: keine Namen oder Noten anderer Personen hochladen.') : null,
      keyInput, testBtn, h('div', { class: 'label' }, 'Modell'), select, status,
      compact ? h('p', { class: 'muted small' }, 'Hinweis: Google verlangt Volljährigkeit für den API-Schlüssel – ggf. macht das ein Elternteil. Für Nutzer in der EU nutzt Google die Eingaben laut seinen Bedingungen nicht zur Produktverbesserung.') : null);
  };
  // Ersatz-Anbieter für Überlastung
  const fallbackBlock = () => {
    s.fb ||= { on: false, preset: 'groq', baseUrl: FALLBACK_PRESETS.groq.baseUrl, key: '', model: '' };
    const f = s.fb;
    const box = h('div', { class: 'stack fb-box' });
    const status = h('div', { class: 'muted small' }, f.on && f.model ? `✓ Aktiv · ${FALLBACK_PRESETS[f.preset]?.label || ''} · ${f.model}` : 'Noch nicht eingerichtet.');
    const sel = h('select', { class: 'input', onchange: (e) => { f.model = e.target.value; save(); } });
    if (f.model) add(sel, h('option', { value: f.model, selected: true }, f.model));
    const keyIn = h('input', { class: 'input', type: 'password', autocomplete: 'off', placeholder: 'API-Schlüssel des Ersatz-Anbieters', value: f.key, oninput: (e) => { f.key = e.target.value.trim(); save(); } });
    const test = h('button', { class: 'btn', onclick: async () => {
      if (!f.key) return toast('Erst den Schlüssel einfügen.');
      test.disabled = true; test.textContent = 'Prüfe …';
      try {
        const ids = await listOpenAIModels(f.baseUrl, f.key);
        if (!ids.length) throw new Error('Keine Modelle gefunden.');
        if (!ids.includes(f.model)) f.model = pickFallbackModel(ids);
        sel.replaceChildren(...ids.map((id) => h('option', { value: id, selected: id === f.model }, id)));
        f.on = true; save();
        status.textContent = `✓ Aktiv · ${FALLBACK_PRESETS[f.preset].label} · ${f.model}`;
        toast('Ersatz-Anbieter verbunden.', 'ok');
      } catch (e) { status.textContent = errorMsg(e); toast(errorMsg(e), 'error'); }
      test.disabled = false; test.textContent = 'Schlüssel prüfen & Modelle laden';
    } }, 'Schlüssel prüfen & Modelle laden');
    add(box,
      h('h3', {}, 'Ersatz bei Überlastung'),
      h('p', { class: 'muted small' }, 'Sind alle Gemini-Modelle überlastet, fragt Jelly automatisch hier nach – ohne Warten. Kostenlos mit eigenem Schlüssel. Fotos gehen, PDFs kann nur Gemini.'),
      h('div', { class: 'seg' }, Object.entries(FALLBACK_PRESETS).map(([k, v]) => h('button', { class: `seg-btn ${f.preset === k ? 'active' : ''}`, onclick: () => { if (f.preset !== k) { f.preset = k; f.baseUrl = v.baseUrl; f.model = ''; f.key = ''; f.on = false; save(); draw(); } } }, v.label))),
      h('p', { class: 'small' }, 'Schlüssel holen: ', h('a', { href: FALLBACK_PRESETS[f.preset].keyUrl, target: '_blank', rel: 'noopener' }, FALLBACK_PRESETS[f.preset].keyUrl.replace('https://', ''))),
      keyIn, test, h('div', { class: 'label' }, 'Modell'), sel, status,
      f.on ? h('button', { class: 'btn ghost small', onclick: () => { f.on = false; save(); draw(); } }, 'Ersatz ausschalten') : null);
    return box;
  };
  const openaiBlock = () => h('div', { class: 'stack' },
    h('p', { class: 'muted small' }, 'Für OpenAI-kompatible Schnittstellen (z. B. Groq, OpenRouter, lokale Server wie Ollama/LM Studio). Achtung: PDFs kann hier nur Gemini lesen – Fotos funktionieren, wenn das Modell Bilder versteht.'),
    h('div', { class: 'label' }, 'Basis-URL'),
    h('input', { class: 'input', placeholder: 'z. B. https://api.groq.com/openai/v1', value: s.baseUrl, oninput: (e) => { s.baseUrl = e.target.value.trim(); save(); } }),
    h('div', { class: 'label' }, 'API-Schlüssel'),
    h('input', { class: 'input', type: 'password', value: s.oaKey, oninput: (e) => { s.oaKey = e.target.value.trim(); save(); } }),
    h('div', { class: 'label' }, 'Modellname'),
    h('input', { class: 'input', placeholder: 'Modell-ID laut Anbieter', value: s.oaModel, oninput: (e) => { s.oaModel = e.target.value.trim(); save(); } }));
  draw();
  return wrap;
}

// ================================================================ PLAN (Startseite)
function activeExam() {
  let e = examById(state.activeExamId);
  if (!e && state.exams.length) {
    e = [...state.exams].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'))[0];
    state.activeExamId = e.id;
  }
  return e;
}

const STEP_NAME = { lernzettel: 'Lernzettel', quiz: 'Quiz', aufgaben: 'Anwendungsaufgaben', gesamtzettel: 'Gesamt-Lernzettel', probeklausur: 'Probeklassenarbeit' };

function stepInfo(u) {
  const x = state.sessions[u.id];
  if (u.status === 'skipped') return 'Übersprungen';
  if (u.status === 'done') {
    if (u.typ === 'quiz') return `Erledigt · ${u.score ?? '–'} % richtig`;
    if (u.score !== undefined) return `Erledigt · ${u.score} % der Punkte`;
    return 'Erledigt';
  }
  if (!x || !(x.lernzettel || x.fragen || x.aufgaben)) return 'Wird beim Öffnen erstellt';
  if (x.fragen && x.idx > 0) return `Angefangen · Frage ${Math.min(x.idx + 1, x.fragen.length)}/${x.fragen.length}`;
  if (x.aufgaben && Object.values(x.answers || {}).some((v) => v?.trim())) return 'Angefangen';
  if (x.fragen) return `${x.fragen.length} Fragen · bereit`;
  if (x.aufgaben) return `${x.aufgaben.length} Aufgaben · ${x.aufgaben.reduce((n, a) => n + (a.punkte || 0), 0)} Punkte · bereit`;
  return 'Bereit';
}

function progressRing(pct, size = 64) {
  const r = 26, c = 2 * Math.PI * r;
  return h('div', { class: 'ring', style: { width: `${size}px`, height: `${size}px` }, html:
    `<svg viewBox="0 0 64 64" width="100%" height="100%"><circle cx="32" cy="32" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="7"/>
     <circle cx="32" cy="32" r="${r}" fill="none" stroke="var(--accent)" stroke-width="7" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}" transform="rotate(-90 32 32)"/></svg>
     <span>${pct}%</span>` });
}

// Reiter "Prüfung": Lernplan der aktuellen Klausur oder alle Termine (Klassenarbeits-/Klausurplan)
function planSeg() {
  ui.planTab ??= 'lernplan';
  return h('div', { class: 'seg plan-seg' },
    h('button', { class: `seg-btn ${ui.planTab === 'lernplan' ? 'active' : ''}`, onclick: () => { ui.planTab = 'lernplan'; render(); } }, 'Lernplan'),
    h('button', { class: `seg-btn ${ui.planTab === 'termine' ? 'active' : ''}`, onclick: () => { ui.planTab = 'termine'; render(); } }, 'Termine'));
}

function viewTermine() {
  const main = h('main', { class: 'content narrow' }, planSeg());
  const screen = h('div', { class: 'screen with-tabs' },
    h('header', { class: 'topbar' }, topLeft('plan'), h('div', { class: 'topbar-title' }, 'Prüfungstermine'),
      h('button', { class: 'iconbtn', 'aria-label': 'Menü', onclick: () => examPlanMenu() }, icon('more'))),
    main, tabbar('plan'));
  drawExamPlan(main);
  return screen;
}

function viewPlan() {
  if (ui.planTab === 'termine') return viewTermine();
  const exam = activeExam();
  const screen = h('div', { class: 'screen with-tabs' });
  if (!exam) {
    add(screen,
      h('header', { class: 'topbar' }, h('span', { class: 'iconbtn-spacer' }), h('div', { class: 'topbar-title' }, `Hi ${state.profile.name}!`), h('span', { class: 'iconbtn-spacer' })),
      h('main', { class: 'content narrow center' },
        planSeg(),
        mascot(140),
        h('h1', { class: 'display' }, 'Welche Klausur steht an?'),
        (() => { const next = allExamDates().filter((x) => daysUntil(x.date) >= 0 && !x.examId).slice(0, 3); return next.length ? [h('div', { class: 'label' }, 'Anstehende Prüfungen'), h('div', { class: 'menu' }, next.map(examRow))] : null; })(),
        h('p', { class: 'muted' }, 'Leg eine Klausur an, lade deine Arbeitsblätter hoch – ich baue dir daraus Lernzettel, Quizze, Aufgaben und eine Probeklassenarbeit.'),
        h('button', { class: 'btn primary', onclick: () => startNewExam() }, 'Klausur anlegen')),
      tabbar('plan'));
    return screen;
  }

  if (exam.building && !exam.plan) {
    add(screen,
      h('header', { class: 'topbar' }, h('span', { class: 'iconbtn-spacer' }), h('div', { class: 'topbar-title' }, subjectById(exam.subjectId)?.name || 'Klausur'), h('button', { class: 'iconbtn', 'aria-label': 'Klausuren', onclick: () => examSheet() }, icon('more'))),
      h('main', { class: 'content narrow center' },
        planSeg(),
        mascot(130),
        h('h1', { class: 'display' }, 'Dein Plan entsteht gerade'),
        h('p', { class: 'muted' }, ui.busy[`prep:${exam.id}`] ? 'Jelly liest deine Unterlagen …' : backgroundAvailable() ? 'Jelly arbeitet im Hintergrund daran, sobald die App geschlossen ist.' : 'Tippe auf „Weitermachen“, damit Jelly den Plan fertig baut.'),
        h('button', { class: 'btn primary', onclick: () => go('prepare', { examId: exam.id }) }, 'Hier weitermachen')),
      tabbar('plan'));
    return screen;
  }
  const subject = subjectById(exam.subjectId);
  const units = allUnits(exam);
  const secs = exam.plan?.abschnitte || [];
  const current = units.find((u) => u.status === 'open' || !u.status);
  const relevant = units.filter((u) => u.status !== 'skipped');
  const done = relevant.filter((u) => u.status === 'done').length;
  const pct = relevant.length ? Math.round((done / relevant.length) * 100) : 0;
  const missing = units.filter((u) => !hasContent(u) && u.status !== 'skipped').length;
  const open = (u) => go('session', { examId: exam.id, unitId: u.id });

  const header = h('header', { class: 'topbar' },
    h('button', { class: 'iconbtn', onclick: () => go('tutor'), 'aria-label': 'Tutor-Chat' }, icon('chat', 22)),
    h('button', { class: 'exam-switch', onclick: () => examSheet() }, h('span', {}, exam.plan?.titel || `${subject?.name} Klausur`), icon('updown', 16)),
    h('button', { class: 'iconbtn', onclick: () => examMenu(exam), 'aria-label': 'Menü' }, icon('more', 22)));

  // --- Übersicht (bewusst reduziert; Details im Menü)
  let countdown = 'Freies Lernen';
  if (exam.date) {
    const diff = Math.round((parseISO(exam.date) - parseISO(isoDate(new Date()))) / 86400000);
    countdown = diff > 1 ? `Noch ${diff} Tage` : diff === 1 ? 'Morgen ist es so weit' : diff === 0 ? 'Heute ist die Klausur' : 'Klausur vorbei';
  }
  const hero = h('section', { class: 'hero' },
    h('div', { class: 'hero-top' },
      h('div', { class: 'hero-left' },
        h('div', { class: 'hero-count' }, countdown),
        h('div', { class: 'muted small' }, `${subject?.name || ''} · Ziel ${gradeLabel(exam.targetGrade)}`)),
      progressRing(pct, 64)),
    current
      ? h('button', { class: 'btn primary block next-btn', onclick: () => open(current) }, h('span', { class: 'next-title' }, current.titel), icon('play', 18))
      : h('div', { class: 'all-done' }, 'Alles erledigt – viel Erfolg!'),
    missing ? h('button', { class: 'link-small', onclick: () => go('prepare', { examId: exam.id }) }, `${missing} Inhalt(e) noch nicht fertig · jetzt erstellen`) : null,
    exam.plan && !exam.plan.themen ? h('div', { class: 'warn small' }, 'Alter Plan – über ⋯ → „Plan neu erstellen“ bekommst du Lernzettel, Quiz und Abschluss.') : null);

  // --- Kacheln: Lernzettel / Quiz / Aufgaben (Thema wird danach gewählt) + Abschluss
  const tiles = h('div', { class: 'tiles' });
  const hasTopics = !!exam.plan?.themen;
  if (hasTopics) {
    for (const typ of ['lernzettel', 'quiz', 'aufgaben']) {
      const list = units.filter((u) => u.typ === typ && u.status !== 'skipped');
      const doneN = list.filter((u) => u.status === 'done').length;
      const isNow = current && current.typ === typ;
      add(tiles, h('button', { class: `tile-btn ${isNow ? 'now' : ''}`, onclick: () => go('pick', { examId: exam.id, typ }) },
        h('span', { class: 'tile-ico' }, icon(UNIT_ICON[typ], 22)),
        h('span', { class: 'tile-name' }, { lernzettel: 'Lernzettel', quiz: 'Quiz', aufgaben: 'Aufgaben' }[typ]),
        h('span', { class: 'tile-sub' }, `${doneN}/${list.length} Themen`),
        h('span', { class: 'tile-bar' }, h('i', { style: { width: `${list.length ? Math.round((doneN / list.length) * 100) : 0}%` } }))));
    }
  }
  const fin = secs.find((x) => x.abschluss);
  if (fin) {
    for (const u of fin.einheiten) {
      add(tiles, h('button', { class: `tile-btn final st-${u.status || 'open'}`, id: u.typ === 'probeklausur' ? 'final' : null, onclick: () => open(u) },
        h('span', { class: 'tile-ico' }, icon(u.status === 'done' ? 'check' : UNIT_ICON[u.typ] || 'exam', 22)),
        h('span', { class: 'tile-name' }, STEP_NAME[u.typ] || u.titel),
        h('span', { class: 'tile-sub' }, stepInfo(u))));
    }
  }
  // Alte Pläne ohne Themen-Struktur: einfache Liste
  const legacy = !hasTopics && units.length ? h('div', { class: 'menu' }, units.map((u) => menuRow(UNIT_ICON[u.typ] || 'pencil', u.titel, stepInfo(u), () => open(u)))) : null;

  add(screen, header,
    h('main', { class: 'content narrow' }, planSeg(), hero,
      units.length ? [tiles, legacy] : h('div', { class: 'card' }, h('p', {}, 'Für diese Klausur gibt es noch keinen Plan.'), h('button', { class: 'btn primary', onclick: () => rebuildPlan(exam) }, 'Plan erstellen'))),
    tabbar('plan'));
  return screen;
}

// Themenauswahl nach Tippen auf Lernzettel / Quiz / Anwendungsaufgaben
function viewPick({ examId, typ }) {
  const exam = examById(examId);
  if (!exam) { go('plan'); return h('div'); }
  const secs = (exam.plan?.abschnitte || []).filter((x) => !x.abschluss);
  const current = allUnits(exam).find((u) => u.status === 'open' || !u.status);
  const intro = { lernzettel: 'Wähle ein Thema – der Lernzettel ist auch als PDF speicherbar.', quiz: 'Kurze Fragen zu Begriffen, Fakten und Zahlen.', aufgaben: 'Klausurnahe Aufgaben mit strenger Korrektur.' }[typ];
  let lastDay;
  const rows = [];
  secs.forEach((sec, n) => {
    const u = sec.einheiten.find((x) => x.typ === typ);
    if (!u) return;
    const day = u.tag || null;
    if (day !== lastDay) { rows.push(h('div', { class: 'road-day' }, day ? `${relDay(day)} · ${fmtDate(day)}` : 'Ohne festen Tag')); lastDay = day; }
    rows.push(h('div', { class: `pick-row st-${u.status || 'open'} ${current && u.id === current.id ? 'is-current' : ''}` },
      h('button', { class: 'pick-main', onclick: () => go('session', { examId, unitId: u.id }) },
        h('span', { class: 'topic-num' }, u.status === 'done' ? icon('check', 16) : String(n + 1)),
        h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, sec.titel), h('span', { class: 'menu-sub' }, stepInfo(u))),
        current && u.id === current.id ? h('span', { class: 'now' }, 'Jetzt') : icon('chev', 18)),
      h('button', { class: 'iconbtn small', 'aria-label': 'Optionen', onclick: () => sectionMenu(exam, sec) }, icon('more', 18))));
  });
  return h('div', { class: 'screen' },
    topbar({ back: () => go('plan'), title: STEP_NAME[typ] }),
    h('main', { class: 'content narrow' },
      h('div', { class: 'pick-head' }, h('span', { class: 'tile-ico big' }, icon(UNIT_ICON[typ], 26)), h('h1', { class: 'display' }, STEP_NAME[typ]), h('p', { class: 'muted' }, intro)),
      h('div', { class: 'pick-list' }, rows)));
}

function sheet(title, children) {
  const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } },
    h('div', { class: 'sheet' }, h('div', { class: 'sheet-title' }, title), ...children));
  add(document.body, overlay);
  return overlay;
}

function setUnitStatus(exam, ids, status) {
  for (const sec of exam.plan?.abschnitte || []) for (const u of sec.einheiten) {
    if (!ids.includes(u.id)) continue;
    if (status === 'skipped' && u.status === 'done') continue;
    u.status = status;
  }
  save();
}

function sectionMenu(exam, sec) {
  const ids = sec.einheiten.map((u) => u.id);
  const anySkipped = sec.einheiten.some((u) => u.status === 'skipped');
  const anyOpen = sec.einheiten.some((u) => u.status === 'open' || !u.status);
  const o = sheet(sec.titel, [
    exam.plan?.themen?.[sec.themaIndex]?.beschreibung ? h('p', { class: 'muted' }, exam.plan.themen[sec.themaIndex].beschreibung) : null,
    h('div', { class: 'label' }, 'Einzelne Schritte'),
    h('div', { class: 'list' }, sec.einheiten.map((u) => h('div', { class: 'list-item' },
      h('span', {}, STEP_NAME[u.typ] || u.titel, h('span', { class: 'muted small' }, ` · ${stepInfo(u)}`)),
      u.status === 'done' ? h('span', { class: 'muted small' }, '✓')
        : h('button', { class: 'btn small ghost', onclick: () => { setUnitStatus(exam, [u.id], u.status === 'skipped' ? 'open' : 'skipped'); o.remove(); render(); } }, u.status === 'skipped' ? 'Aufnehmen' : 'Überspringen')))),
    h('div', { class: 'list' },
      anyOpen && !sec.abschluss ? h('button', { class: 'list-item', onclick: () => { setUnitStatus(exam, ids, 'skipped'); o.remove(); render(); } }, h('span', { class: 'row gap' }, icon('skip', 18), 'Ganzes Thema überspringen')) : null,
      anySkipped ? h('button', { class: 'list-item', onclick: () => { setUnitStatus(exam, sec.einheiten.filter((u) => u.status === 'skipped').map((u) => u.id), 'open'); o.remove(); render(); } }, 'Ganzes Thema wieder aufnehmen') : null,
      h('button', { class: 'list-item', onclick: async () => {
        o.remove();
        if (!(await confirmDialog('Alle Inhalte dieses Themas (Lernzettel, Quiz, Aufgaben) neu erstellen lassen? Antworten gehen verloren.', 'Neu erstellen'))) return;
        for (const u of sec.einheiten) delete state.sessions[u.id];
        save(); go('prepare', { examId: exam.id });
      } }, h('span', { class: 'row gap' }, icon('refresh', 18), 'Inhalte neu erstellen'))),
  ]);
}

function nextOpenUnit(exam, afterId) {
  const units = allUnits(exam);
  const i = units.findIndex((u) => u.id === afterId);
  return units.slice(i + 1).find((u) => u.status === 'open' || !u.status) || null;
}

function menuRow(ic, label, sub, onclick, cls = '') {
  return h('button', { class: `menu-row ${cls}`, onclick },
    h('span', { class: 'menu-ico' }, icon(ic, 20)),
    h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, label), sub ? h('span', { class: 'menu-sub' }, sub) : null),
    icon('chev', 18));
}

function overviewSheet(exam) {
  sheet('Überblick', [
    exam.plan?.themenUebersicht ? mdEl(exam.plan.themenUebersicht) : h('p', { class: 'muted' }, 'Noch kein Überblick vorhanden.'),
    exam.plan?.luecken?.length ? h('div', { class: 'warn' }, h('strong', {}, 'Lücken im Material'), h('ul', {}, exam.plan.luecken.map((l) => h('li', {}, l)))) : null,
    exam.weaknesses?.length ? h('div', {}, h('div', { class: 'label' }, 'Deine Schwächen (werden gezielt trainiert)'), h('ul', {}, exam.weaknesses.slice(-10).map((w) => h('li', {}, w)))) : null,
    exam.lastResult ? h('p', { class: 'muted small' }, `Letztes Ergebnis: ${exam.lastResult.percent} % ≈ ${gradeLabel(exam.lastResult.grade)} (Schätzung)`) : null,
  ]);
}

function examSheet() {
  const sorted = [...state.exams].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  const o = sheet('Deine Klausuren', [
    h('div', { class: 'list' }, sorted.map((e) => {
      const s = subjectById(e.subjectId);
      return h('button', { class: `list-item ${e.id === state.activeExamId ? 'active' : ''}`, onclick: () => { state.activeExamId = e.id; ui.selectedUnit = null; save(); o.remove(); render(); } },
        h('span', { class: 'row gap' }, s ? subjectBadge(s, 32) : null, h('span', {}, e.plan?.titel || `${s?.name} Klausur`)),
        h('span', { class: 'muted small' }, e.date ? `${fmtDate(e.date)} · ${relDay(e.date)}` : 'ohne Datum'));
    })),
    h('button', { class: 'btn primary block', onclick: () => { o.remove(); startNewExam(); } }, h('span', { class: 'row gap center' }, icon('plus'), 'Neue Klausur')),
  ]);
}

function examMenu(exam) {
  const missing = allUnits(exam).filter((u) => !hasContent(u) && u.status !== 'skipped').length;
  const o = sheet(exam.plan?.titel || 'Klausur', [
    h('div', { class: 'menu' },
      menuRow('info', 'Überblick', 'Was drankommt, Lücken, Schwächen', () => { o.remove(); overviewSheet(exam); }),
      menuRow('flag', 'Zum Abschluss', 'Gesamt-Lernzettel & Probeklassenarbeit', () => { o.remove(); document.getElementById('final')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }),
      missing ? menuRow('zap', 'Fehlende Inhalte erstellen', `${missing} noch nicht vorbereitet`, () => { o.remove(); go('prepare', { examId: exam.id }); }) : null),
    h('div', { class: 'menu' },
      menuRow('upload', 'Material & Themen', 'Blätter hinzufügen, Themen ändern', () => { o.remove(); editExamMaterial(exam); }),
      menuRow('clock', 'Datum & Zielnote', null, () => { o.remove(); changeDate(exam); }),
      menuRow('refresh', 'Plan neu erstellen', 'Alles wird neu vorbereitet', async () => { o.remove(); if (await confirmDialog('Plan neu erstellen? Fortschritt in diesem Plan geht verloren, deine Schwächen-Liste bleibt.', 'Neu erstellen')) rebuildPlan(exam); })),
    h('div', { class: 'menu' },
      menuRow('trash', 'Klausur löschen', null, async () => {
        o.remove();
        if (!(await confirmDialog('Diese Klausur samt Plan löschen? Hochgeladenes Material wird ebenfalls gelöscht.', 'Löschen'))) return;
        for (const id of exam.materialIds || []) await removeFile(id);
        for (const u of allUnits(exam)) delete state.sessions[u.id];
        delete state.tutor[exam.id];
        state.exams = state.exams.filter((e) => e.id !== exam.id);
        state.activeExamId = null; save(); render();
      }, 'danger')),
  ]);
}

function changeDate(exam) {
  const dateIn = h('input', { class: 'input', type: 'date', value: exam.date || '' });
  const gradeSel = h('select', { class: 'input' }, gradeOptions().map((g) => h('option', { value: g, selected: g === exam.targetGrade }, gradeLabel(g))));
  const o = sheet('Datum & Zielnote', [
    h('div', { class: 'label' }, 'Datum (leer = ohne Datum)'), dateIn,
    h('div', { class: 'label' }, 'Zielnote'), gradeSel,
    h('p', { class: 'muted small' }, 'Tipp: Nach einer Datumsänderung „Plan neu erstellen“, damit die Tage passen.'),
    h('button', { class: 'btn primary block', onclick: () => { exam.date = dateIn.value || null; exam.targetGrade = Number(gradeSel.value); save(); o.remove(); render(); } }, 'Speichern'),
  ]);
}

// ================================================================ WARTE-BILDSCHIRM (Video + Fortschritt)
const DEFAULT_WAIT_VIDEO = 'https://youtu.be/Ca-O9wsea9Y';

export function youtubeId(url) {
  const m = String(url || '').match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

// Lädt einmalig die offizielle YouTube-Player-Schnittstelle (nötig, um Abspielfehler zu erkennen).
let ytApi = null;
function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!ytApi) {
    ytApi = new Promise((resolve, reject) => {
      window.onYouTubeIframeAPIReady = () => resolve(window.YT);
      const sc = document.createElement('script');
      sc.src = 'https://www.youtube.com/iframe_api';
      sc.onerror = () => { ytApi = null; reject(new Error('YouTube nicht erreichbar')); };
      document.head.append(sc);
    });
  }
  return ytApi;
}

function waitVideo() {
  const v = state.settings.waitVideo ?? DEFAULT_WAIT_VIDEO;
  const id = youtubeId(v);
  if (!id) return null;
  let allowed = false;
  try { allowed = localStorage.getItem('lernki-yt-ok') === '1'; } catch {}
  if (!allowed) {
    // Zwei-Klick-Lösung: Erst nach Antippen wird YouTube (Google) kontaktiert.
    const ph = h('div', { class: 'video-consent' },
      h('div', { class: 'strong' }, 'Video beim Warten'),
      h('p', { class: 'muted small' }, 'Beim Abspielen lädt YouTube (Google) das Video – dabei wird deine IP-Adresse an Google übertragen.'),
      h('div', { class: 'row gap wrap center' },
        h('button', { class: 'btn small primary', onclick: () => { ph.replaceWith(loadVideo(id)); } }, icon('play', 16), 'Abspielen'),
        h('button', { class: 'btn small ghost', onclick: () => { try { localStorage.setItem('lernki-yt-ok', '1'); } catch {} ph.replaceWith(loadVideo(id)); } }, 'Immer abspielen')));
    return ph;
  }
  return loadVideo(id);
}

function loadVideo(id) {
  const holder = h('div');
  const wrap = h('div', { class: 'video-wrap' }, holder);
  const giveUp = (why) => {
    wrap.replaceWith(h('div', { class: 'video-fallback' }, mascot(64, 'side'),
      h('div', {}, h('strong', {}, 'Video lässt sich nicht abspielen'),
        h('div', { class: 'muted small' }, `${why} Anderes Video: Einstellungen → „Video beim Warten“.`))));
  };
  loadYouTubeApi().then((YT) => {
    if (!holder.isConnected) return;
    new YT.Player(holder, {
      videoId: id,
      host: 'https://www.youtube-nocookie.com',
      playerVars: { autoplay: 1, mute: 1, playsinline: 1, loop: 1, playlist: id, rel: 0, modestbranding: 1 },
      events: {
        onReady: (e) => { try { e.target.mute(); e.target.playVideo(); } catch {} },
        onError: (e) => giveUp([100].includes(e.data) ? 'Das Video gibt es nicht mehr.' : 'YouTube erlaubt das Einbetten hier nicht (z. B. Länder- oder Rechtesperre).'),
      },
    });
  }).catch(() => giveUp('YouTube ist gerade nicht erreichbar.'));
  return wrap;
}

// Liefert ein Panel mit Video, Überschrift, Fortschrittsbalken, Schritt-Liste und Statuszeile.
function waitPanel(title) {
  const bar = h('div', { class: 'progress-fill', style: { width: '3%' } });
  const list = h('ol', { class: 'steps' });
  const status = h('div', { class: 'wait-status' });
  const errBox = h('div');
  let steps = [];
  const draw = () => {
    list.replaceChildren(...steps.map((st) => h('li', { class: `step st-${st.state}` },
      h('span', { class: 'step-dot' }, st.state === 'done' ? icon('check', 14) : st.state === 'run' ? h('span', { class: 'spinner' }) : null),
      h('span', {}, st.label))));
    const done = steps.filter((x) => x.state === 'done').length;
    const running = steps.some((x) => x.state === 'run') ? 0.5 : 0;
    bar.style.width = `${Math.max(3, Math.round(((done + running) / Math.max(1, steps.length)) * 100))}%`;
  };
  const el = h('div', { class: 'wait' },
    waitVideo(),
    h('div', { class: 'wait-card' },
      h('div', { class: 'row gap' }, mascot(52, 'think'), h('div', { class: 'wait-title' }, title)),
      h('div', { class: 'progress' }, bar),
      list, status, errBox));
  onAIStatus((msg) => { status.textContent = msg; });
  return {
    el, errBox,
    setSteps(labels) { steps = labels.map((label) => ({ label, state: 'wait' })); draw(); },
    addSteps(labels) { const start = steps.length; steps.push(...labels.map((label) => ({ label, state: 'wait' }))); draw(); return start; },
    mark(i, st) { if (steps[i]) steps[i].state = st; draw(); },
    run(i) { steps.forEach((x, j) => { if (j < i) x.state = 'done'; }); if (steps[i]) steps[i].state = 'run'; draw(); },
    done(i) { if (steps[i]) steps[i].state = 'done'; draw(); },
    fail(i) { if (steps[i]) steps[i].state = 'fail'; draw(); },
  };
}

// ================================================================ NEUE KLAUSUR (Ablauf wie in den Screenshots)
let nx = null;

function startNewExam(subjectId = null, date = undefined, extra = {}) {
  nx = { step: subjectId ? (date ? 2 : 1) : 0, subjectId, date, targetGrade: scale() === '0-15' ? 13 : 1, materialIds: [], topicsText: extra.topicsText || '', useArchive: true, customDate: false, planItem: extra.planItem || null };
  go('newExam');
}

function editExamMaterial(exam) {
  nx = { step: 4, editId: exam.id, subjectId: exam.subjectId, date: exam.date, targetGrade: exam.targetGrade, materialIds: [...(exam.materialIds || [])], topicsText: exam.topicsText || '', useArchive: exam.useArchive !== false };
  go('newExam');
}

function viewNewExam() {
  if (!nx) { startNewExam(); return h('div'); }
  const subject = subjectById(nx.subjectId);
  const cancel = () => { nx = null; go('plan'); };
  const back = () => { if (nx.editId || nx.step === 0) cancel(); else { nx.step = nx.step === 4 ? 2 : nx.step - 1; render(); } };
  const total = 5;
  const bar = (i) => topbar({ back, close: cancel, progress: (i + 1) / total });

  // 0: Fach
  if (nx.step === 0) {
    return h('div', { class: 'screen' }, bar(0),
      h('main', { class: 'content narrow' },
        h('p', { class: 'muted small center' }, 'Der Lernplan wird mithilfe von KI erstellt.'),
        speech('In welchem Fach schreibst du die Klausur?'),
        h('div', { class: 'label' }, 'Deine Fächer'),
        h('div', { class: 'list' }, state.subjects.map((s) => h('button', { class: 'list-item big', onclick: () => { nx.subjectId = s.id; nx.step = 1; render(); } }, h('span', { class: 'row gap' }, subjectBadge(s), s.name)))),
        h('button', { class: 'btn ghost block', onclick: () => addSubjectDialog((s) => { nx.subjectId = s.id; nx.step = 1; render(); }) }, h('span', { class: 'row gap center' }, icon('plus'), 'Fach fehlt? Hinzufügen'))));
  }

  // 1: Datum
  if (nx.step === 1) {
    const today = new Date();
    const opt = (label, offset) => { const d = new Date(today); d.setDate(d.getDate() + offset); const iso = isoDate(d); return h('button', { class: 'list-item big', onclick: () => { nx.date = iso; nx.step = 2; render(); } }, h('span', {}, label), h('span', { class: 'muted' }, fmtDate(iso))); };
    const dateInput = h('input', { class: 'input', type: 'date', min: isoDate(today) });
    return h('div', { class: 'screen' }, bar(1),
      h('main', { class: 'content narrow' },
        speech(`Wann schreibst du deine ${subject?.name}-Klausur?`),
        h('div', { class: 'list' }, opt('Heute', 0), opt('Morgen', 1), opt('In 2 Tagen', 2), opt('In 3 Tagen', 3),
          nx.customDate
            ? h('div', { class: 'list-item big' }, dateInput, h('button', { class: 'btn small', onclick: () => { if (!dateInput.value) return toast('Bitte Datum wählen.'); nx.date = dateInput.value; nx.step = 2; render(); } }, 'OK'))
            : h('button', { class: 'list-item big', onclick: () => { nx.customDate = true; render(); } }, h('span', {}, 'Datum wählen'), icon('chev'))),
        h('button', { class: 'link-btn', onclick: () => { nx.date = null; nx.step = 2; render(); } }, 'Kein Datum, ich lerne nur')));
  }

  // 2: Zielnote
  if (nx.step === 2) {
    const opts = gradeOptions();
    const wheel = h('div', { class: 'wheel' }, opts.map((g) => h('button', { class: `wheel-item ${g === nx.targetGrade ? 'active' : ''}`, onclick: () => { nx.targetGrade = g; render(); } }, String(g))));
    setTimeout(() => wheel.querySelector('.active')?.scrollIntoView({ block: 'center' }), 0);
    return h('div', { class: 'screen' }, bar(2),
      h('main', { class: 'content narrow' },
        speech('Welche Note wollen wir erreichen?'),
        wheel,
        h('div', { class: 'center' }, h('button', { class: 'pill', onclick: () => { state.profile.gradeScale = scale() === '0-15' ? '1-6' : '0-15'; nx.targetGrade = scale() === '0-15' ? 13 : 1; save(); render(); } }, scale() === '0-15' ? 'Punkte 0–15 ⌄' : 'Notenskala 1–6 ⌄'))),
      h('footer', { class: 'footer' }, h('button', { class: 'btn light block', onclick: () => { nx.step = 3; render(); } }, `Ziel: ${nx.targetGrade}`)));
  }

  // 3: Gespeichert + Personalisieren
  if (nx.step === 3) {
    const d = nx.date ? parseISO(nx.date) : null;
    return h('div', { class: 'screen' }, topbar({ back, close: cancel }),
      h('main', { class: 'content narrow center' },
        h('div', { class: 'cal-wrap' }, mascot(110),
          h('div', { class: 'cal' }, h('div', { class: 'cal-head' }, d ? d.toLocaleDateString('de-DE', { month: 'long' }) : 'Freies'),
            h('div', { class: 'cal-day' }, d ? String(d.getDate()) : '∞'), h('div', { class: 'cal-wd' }, d ? d.toLocaleDateString('de-DE', { weekday: 'long' }) : 'Lernen')),
          h('div', { class: 'cal-check' }, icon('check', 28))),
        h('h1', { class: 'display' }, 'Deine Klausur ist notiert'),
        h('div', { class: 'row gap center wrap muted' }, subject ? subjectBadge(subject, 28) : null, subject?.name, '·', nx.date ? relDay(nx.date) : 'ohne Datum', '·', `Ziel ${gradeLabel(nx.targetGrade)}`),
        h('h2', { class: 'display small-display' }, 'Lass uns deinen Plan personalisieren'),
        h('p', { class: 'muted' }, 'Füge deine Arbeitsblätter, Lernzettel und Hefteinträge hinzu – ich lese alles genau und stimme die Aufgaben darauf ab.')),
      h('footer', { class: 'footer' }, h('button', { class: 'btn primary block', onclick: () => { nx.step = 4; render(); } }, 'Material hinzufügen')));
  }

  // 4: Material
  if (nx.step === 4) {
    const grid = h('div', { class: 'grid3' });
    const drawGrid = async () => {
      const tiles = [];
      for (const id of nx.materialIds) {
        const f = state.files[id];
        if (!f || !isGroupLead(id)) continue;
        const url = await thumbURL(id);
        const n = groupOf(id).length;
        tiles.push(h('div', { class: 'tile filled' },
          url ? h('img', { src: url, alt: f.name, onclick: () => openFile(id) }) : h('div', { class: 'tile-file', onclick: () => openFile(id) }, icon('file', 34), h('span', {}, f.name)),
          f.digest ? h('span', { class: 'tile-ok' }, icon('check', 14)) : null,
          n > 1 ? h('span', { class: 'tile-pages' }, `${n} S.`) : null,
          h('button', { class: 'tile-addpage', 'aria-label': 'Seite hinzufügen', title: 'Weitere Seite zu diesem Blatt', onclick: async () => {
            const files = await pickFiles({ accept: 'image/*,application/pdf,.pdf' });
            if (!files.length) return;
            nx.materialIds.push(...(await uploadPages(files, { kind: 'material', subjectId: nx.subjectId, into: id })));
            drawGrid();
          } }, icon('plus', 14)),
          h('button', { class: 'tile-del', 'aria-label': 'Entfernen', onclick: async () => { const ids = groupOf(id); nx.materialIds = nx.materialIds.filter((x) => !ids.includes(x)); await removeGroup(id); drawGrid(); } }, icon('close', 16))));
      }
      const addTile = (label, opts) => h('button', { class: 'tile', onclick: async () => {
        const files = await pickFiles(opts);
        if (!files.length) return;
        const together = await askTogether(files.length, 'einem Blatt', 'Verschiedene Blätter');
        nx.materialIds.push(...(await uploadPages(files, { kind: 'material', subjectId: nx.subjectId, together })));
        drawGrid();
      } }, icon(opts.capture ? 'camera' : 'plus', 30), h('span', { class: 'small muted' }, label));
      tiles.push(addTile('Foto aufnehmen', { accept: 'image/*', capture: 'environment', multiple: false }), addTile('Dateien / PDF', {}));
      grid.replaceChildren(...tiles);
    };
    drawGrid();
    const archiveCount = subject ? archiveCountOf(subject) : 0;
    return h('div', { class: 'screen' }, bar(3),
      h('main', { class: 'content narrow' },
        speech(`Welche Themen kommen in deiner ${subject?.name}-Klausur dran?`),
        h('div', { class: 'label' }, 'Lernmaterial hinzufügen (Arbeitsblätter, Lernzettel, Heft, Buchseiten)'),
        grid,
        h('p', { class: 'muted small' }, 'Mehrseitiges Blatt einzeln fotografiert? Tippe auf das + an der Kachel, um weitere Seiten anzuhängen.'),
        h('div', { class: 'label' }, 'Themen & Notizen (optional, aber hilfreich)'),
        h('textarea', { class: 'input', rows: 5, placeholder: 'Ein Thema pro Zeile – dann gibt es genau diese Themen:\nKlimazonen\nMonsun\nKlimadiagramme auswerten\n\nNotizen in ganzen Sätzen, z. B.: Die Lehrerin legt Wert auf Fachbegriffe.', value: nx.topicsText, oninput: (e) => { nx.topicsText = e.target.value; } }),
        h('p', { class: 'muted small' }, 'Pro Thema gibt es einen Lernzettel, ein Quiz und Aufgaben. Deine Notizen haben bei allem Vorrang.'),
        h('label', { class: 'check-row' },
          h('input', { type: 'checkbox', checked: nx.useArchive, onchange: (e) => { nx.useArchive = e.target.checked; } }),
          h('span', {}, `Alte Klausuren aus dem ${subject?.name}-Archiv nutzen (${archiveCount} vorhanden)`)),
        archiveCount === 0 ? h('p', { class: 'muted small' }, 'Tipp: Unter „Fächer“ kannst du alte Klausuren hochladen. Dann lerne ich den Stil deiner Lehrkraft.') : null),
      h('footer', { class: 'footer' }, h('button', { class: 'btn primary block', onclick: () => {
        if (!aiReady()) { toast('Bitte zuerst die KI einrichten (Einstellungen).', 'error'); return; }
        if (!nx.materialIds.length && !nx.topicsText.trim() && !archiveCount) { toast('Lade Material hoch oder nenne zumindest die Themen.'); return; }
        nx.step = 5; render();
      } }, nx.editId ? 'Speichern & Plan aktualisieren' : 'Weiter')));
  }

  // 5: Verarbeitung
  if (nx.step === 5) {
    startExamBuild();
    return h('div');
  }
  return h('div');
}

// Klausur sofort speichern und dann aufbauen (Blätter lesen, Lehrerprofil, Lernplan, Inhalte).
// Geht die App zu, macht der Hintergrund-Dienst an derselben Stelle weiter.
function startExamBuild() {
  let exam = nx.editId ? examById(nx.editId) : null;
  if (!exam) {
    exam = { id: uid(), subjectId: nx.subjectId, createdAt: Date.now(), weaknesses: [] };
    state.exams.push(exam);
  } else {
    for (const u of allUnits(exam)) delete state.sessions[u.id];
    exam.plan = null;
  }
  Object.assign(exam, { date: nx.date ?? null, targetGrade: nx.targetGrade, materialIds: nx.materialIds, topicsText: nx.topicsText, useArchive: nx.useArchive, building: true });
  state.activeExamId = exam.id;
  const item = nx.planItem && xp().items.find((it) => it.id === nx.planItem);
  if (item) item.examId = exam.id; // Eintrag im Klassenarbeitsplan ↔ Lernplan
  else linkExamsToPlan();
  ui.planTab = 'lernplan';
  save();
  nx = null;
  ui.selectedUnit = null;
  queueJob({ key: exam.id, type: 'exam', id: exam.id });
  go('prepare', { examId: exam.id });
}

function rebuildPlan(exam) {
  for (const u of allUnits(exam)) delete state.sessions[u.id];
  exam.plan = null;
  exam.building = true;
  save();
  queueJob({ key: exam.id, type: 'exam', id: exam.id });
  go('prepare', { examId: exam.id });
}

// ---------- Inhalte erzeugen (einzeln beim Öffnen oder alle vorab) ----------
// Zwei Anfragen gleichzeitig: schneller, aber noch im Rahmen der kostenlosen Limits.
async function pool(items, limit, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

// Erstellt alle noch fehlenden Inhalte: erst Lernzettel (die anderen bauen darauf auf), dann Quiz + Aufgaben, dann Abschluss.
async function prepareAll(exam, panel) {
  const [phase1, phase2, phase3] = missingPhases(exam);
  const ordered = [...phase1, ...phase2, ...phase3];
  const label = (u) => ({ lernzettel: 'Lernzettel', quiz: 'Quiz', aufgaben: 'Anwendungsaufgaben', gesamtzettel: 'Gesamt-Lernzettel', probeklausur: 'Probeklassenarbeit' }[u.typ] || 'Einheit')
    + (u.themaIndex !== null && u.themaIndex !== undefined && exam.plan?.themen?.[u.themaIndex] ? `: ${exam.plan.themen[u.themaIndex].titel}` : '');
  const start = panel.addSteps(ordered.map(label));
  const idx = new Map(ordered.map((u, k) => [u.id, start + k]));
  let failed = 0;
  const one = async (u) => {
    if (hasContent(u)) { panel.mark(idx.get(u.id), 'done'); return; }
    if (ui.busy[u.id]) { panel.mark(idx.get(u.id), 'done'); return; } // wird gerade schon beim Öffnen erstellt
    panel.mark(idx.get(u.id), 'run');
    ui.busy[u.id] = true;
    try { await generateUnit(exam, u); save(); panel.mark(idx.get(u.id), 'done'); } catch (e) { failed++; panel.mark(idx.get(u.id), 'fail'); console.warn(e); }
    finally {
      delete ui.busy[u.id];
      // Ist die Einheit gerade geöffnet, sofort anzeigen
      if (route.name === 'session' && route.params.unitId === u.id) { delete ui.busy[`err:${u.id}`]; const here = route; (hasContent(u) ? jellyTransition(() => { if (route === here) render(); }) : render()); }
    }
  };
  await pool(phase1, 2, one);
  await pool(phase2, 2, one);
  await pool(phase3, 2, one);
  return failed;
}

// ---------- Hintergrund (läuft über GitHub Actions, siehe server/background.mjs) ----------
function bgHint() {
  return h('div', { class: 'card bg-hint row gap' }, icon('sparkles', 20),
    h('p', { class: 'small', style: { margin: 0 } }, 'Du kannst die App jetzt schließen. Jelly macht im Hintergrund weiter, sobald sie zu ist. Beim nächsten Öffnen ist alles da.'));
}

// Gibt dem Hintergrund-Dienst einen Auftrag (nur mit Konto + Sync). Er legt erst los, wenn die App zu ist.
function queueJob(job) {
  if (!backgroundAvailable()) return false;
  push(true).catch(() => {}).finally(() => requestJob(job));
  return true;
}

// Beim Verlassen der App: Alles, was noch fehlt, übernimmt der Hintergrund-Dienst.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden' || !backgroundAvailable()) return;
  for (const job of pendingJobs()) requestJob(job);
});

function viewPrepare({ examId }) {
  const exam = examById(examId);
  if (!exam) { go('plan'); return h('div'); }
  const panel = waitPanel(exam.building ? 'Ich lese deine Unterlagen und baue deinen Plan …' : 'Ich bereite alle fehlenden Inhalte vor …');
  const screen = h('div', { class: 'screen' }, topbar({ close: () => go('plan') }),
    h('main', { class: 'content narrow' }, panel.el, backgroundAvailable() ? bgHint() : h('p', { class: 'muted small center' }, 'Du kannst das auch abbrechen – Fehlendes wird dann beim Öffnen erstellt.')));
  const key = `prep:${examId}`;
  if (!ui.busy[key]) {
    ui.busy[key] = true;
    (async () => {
      try {
        if (exam.building) {
          const subject = subjectById(exam.subjectId);
          const ids = examFileIds(exam).filter((id) => !state.files[id]?.digest && isGroupLead(id));
          const needProfile = examNeedsProfile(exam);
          const k = panel.addSteps([
            ...ids.map((id) => `${state.files[id]?.kind === 'archive' ? 'Alte Klausur' : 'Lese'}: ${state.files[id]?.name || 'Datei'}`),
            ...(needProfile ? ['Stil deiner Lehrkraft analysieren'] : []),
            'Themen & Lernplan erstellen']);
          let n = k;
          for (const id of ids) { panel.mark(n, 'run'); await digestFile(id); save(); panel.mark(n++, 'done'); }
          if (needProfile && !subject.teacherProfile) { panel.mark(n, 'run'); await buildTeacherProfile(subject); save(); panel.mark(n++, 'done'); }
          else if (needProfile) panel.mark(n++, 'done');
          panel.mark(n, 'run');
          if (exam.building) { await createPlan(exam); save(); }
          panel.mark(n, 'done');
        }
        const failed = await prepareAll(exam, panel);
        toast(failed ? `${failed} Inhalt(e) konnten nicht vorbereitet werden – sie werden beim Öffnen erstellt.` : 'Alles fertig vorbereitet!', failed ? 'info' : 'ok');
        if (route.name === 'prepare') jellyTransition(() => go('plan'));
      } catch (e) {
        panel.errBox.replaceChildren(h('div', { class: 'card warn' }, h('p', {}, errorMsg(e)), fallbackTip(errorMsg(e)),
          h('p', { class: 'muted small' }, 'Schon Gelesenes ist gespeichert – beim nächsten Versuch geht es dort weiter.'),
          h('div', { class: 'row gap center' }, h('button', { class: 'btn', onclick: () => render() }, 'Nochmal versuchen'), h('button', { class: 'btn ghost', onclick: () => go('plan') }, 'Zurück'))));
      } finally { delete ui.busy[key]; }
    })();
  }
  return screen;
}

// ================================================================ LERNEINHEIT
let timerHandle = null;

function viewSession({ examId, unitId }) {
  clearInterval(timerHandle);
  const exam = examById(examId);
  const unit = exam && allUnits(exam).find((u) => u.id === unitId);
  if (!unit) { go('plan'); return h('div'); }
  const subject = subjectById(exam.subjectId);
  const sess = state.sessions[unitId];
  const backTo = () => (exam.plan?.themen && ['lernzettel', 'quiz', 'aufgaben'].includes(unit.typ) ? go('pick', { examId, typ: unit.typ }) : go('plan'));
  const screen = h('div', { class: 'screen' }, topbar({ back: backTo, title: unit.titel }));
  const main = h('main', { class: 'content narrow' });
  add(screen, main);
  if (unit.typ === 'lernzettel' || unit.typ === 'gesamtzettel') { viewLernzettel(main, exam, unit); return screen; }
  if (unit.typ === 'quiz') { viewQuiz(main, exam, unit); return screen; }

  if (!sess?.aufgaben) {
    pending(main, unitId, unit.typ === 'probeklausur' ? 'Ich baue dir eine Probeklassenarbeit im Stil deiner Lehrkraft …' : 'Ich denke mir Anwendungsaufgaben aus – im Stil deiner Lehrkraft …',
      ['Material & Lehrerprofil auswerten', 'Aufgaben formulieren'], () => genAufgaben(exam, unit));
    return screen;
  }
  if (!sess.startedAt) { sess.startedAt = Date.now(); save(); }

  const graded = !!sess.grading;
  if (graded) add(main, resultSummary(exam, unit, sess));

  if (sess.input) add(main, h('section', { class: 'card' }, h('div', { class: 'label' }, 'Kurz-Input'), mdEl(sess.input)));

  if (unit.typ === 'probeklausur' && sess.zeitMinuten && !graded) {
    const tEl = h('div', { class: 'timer' }, icon('clock', 18), h('span', {}));
    const tick = () => {
      const left = sess.zeitMinuten * 60 - Math.floor((Date.now() - sess.startedAt) / 1000);
      tEl.lastChild.textContent = left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} übrig` : 'Zeit abgelaufen – gib ab!';
      tEl.classList.toggle('over', left <= 0);
    };
    tick();
    timerHandle = setInterval(() => { if (!tEl.isConnected) clearInterval(timerHandle); else tick(); }, 1000);
    add(main, tEl);
  }

  const totalMax = sess.aufgaben.reduce((s, a) => s + (a.punkte || 0), 0);
  if (!graded) add(main, h('p', { class: 'muted small' }, `${sess.aufgaben.length} Aufgaben · ${totalMax} Punkte. Schreib so, wie du es in der Klausur tun würdest. Handschriftliches kannst du fotografieren.`));

  sess.aufgaben.forEach((a, idx) => add(main, taskCard(exam, sess, a, idx)));

  if (!graded) {
    const submit = h('button', { class: 'btn primary block', onclick: async () => {
      const empty = sess.aufgaben.filter((a) => !sess.answers[a.id]?.trim() && !(sess.answerImages[a.id] || []).length).length;
      if (empty && !(await confirmDialog(`${empty} Aufgabe(n) sind leer und werden mit 0 Punkten bewertet. Trotzdem abgeben?`, 'Abgeben'))) return;
      submit.disabled = true; submit.textContent = 'Korrigiere streng …';
      const panel = waitPanel('Ich korrigiere – streng wie deine Lehrkraft …');
      panel.setSteps(['Antworten lesen', 'Punkte vergeben & Fehler markieren']);
      panel.run(1);
      const overlay = h('div', { class: 'overlay center wait-overlay' }, h('div', { class: 'content narrow' }, panel.el));
      add(document.body, overlay);
      let graded = false;
      try { await gradeSession(exam, unit, sess); graded = true; } catch (e) { toast(errorMsg(e), 'error'); }
      const finish = () => { overlay.remove(); render(); };
      if (graded) jellyTransition(finish); else finish();
    } }, 'Abgeben & korrigieren lassen');
    add(main, submit);
  } else {
    add(main, h('div', { class: 'stack' },
      h('button', { class: 'btn primary block', onclick: () => { markDone(exam, unit.id, sess); backTo(); } }, 'Einheit abschließen'),
      h('button', { class: 'btn ghost block', onclick: async () => { if (await confirmDialog('Neue Aufgaben zu dieser Einheit erstellen? Die aktuellen Antworten werden verworfen.', 'Neue Aufgaben')) { markDone(exam, unit.id, sess, true); delete state.sessions[unit.id]; save(); render(); } } }, h('span', { class: 'row gap center' }, icon('refresh', 18), 'Neue Aufgaben zum selben Ziel'))));
  }
  return screen;
}

function taskCard(exam, sess, a, idx) {
  const graded = !!sess.grading;
  const res = sess.grading?.ergebnisse?.find((r) => r.id === a.id);
  const card = h('section', { class: `card task ${res ? `verdict-${res.urteil}` : ''}` });
  add(card, 
    h('div', { class: 'task-head' },
      h('span', { class: 'strong' }, `Aufgabe ${idx + 1}`),
      h('span', { class: 'tag' }, `AFB ${a.afb || '–'}`),
      h('span', { class: 'tag' }, res ? `${res.punkte}/${res.maxPunkte ?? a.punkte} P.` : `${a.punkte} P.`),
      a.minuten ? h('span', { class: 'tag' }, `~${a.minuten} Min.`) : null),
    a.material ? h('div', { class: 'material' }, h('div', { class: 'label' }, 'Material'), mdEl(a.material)) : null,
    mdEl(a.aufgabe, 'md task-text'));

  if (!graded) {
    add(card, h('textarea', { class: 'input answer', rows: 6, placeholder: 'Deine Antwort …', value: sess.answers[a.id] || '', oninput: (e) => { sess.answers[a.id] = e.target.value; save(); } }));
  } else {
    add(card, h('div', { class: 'answer-view' }, h('div', { class: 'label' }, 'Deine Antwort'), h('div', { class: 'pre' }, sess.answers[a.id] || '(leer)')));
  }

  const photos = h('div', { class: 'photos' });
  const drawPhotos = async () => {
    const ids = sess.answerImages[a.id] || [];
    const items = [];
    for (const id of ids) {
      const url = await thumbURL(id);
      items.push(h('div', { class: 'photo' }, url ? h('img', { src: url, onclick: () => openFile(id) }) : null,
        !graded ? h('button', { class: 'tile-del', onclick: async () => { sess.answerImages[a.id] = ids.filter((x) => x !== id); await removeFile(id); save(); drawPhotos(); } }, icon('close', 14)) : null));
    }
    if (!graded) items.push(h('button', { class: 'btn small ghost', onclick: async () => {
      const files = await pickFiles({ accept: 'image/*', multiple: true });
      for (const f of files) {
        try { const id = await addFile(f, { kind: 'answer', subjectId: exam.subjectId }); (sess.answerImages[a.id] ||= []).push(id); } catch (e) { toast(errorMsg(e), 'error'); }
      }
      save(); drawPhotos();
    } }, h('span', { class: 'row gap' }, icon('camera', 18), 'Foto der Lösung')));
    photos.replaceChildren(...items);
  };
  drawPhotos();
  add(card, photos);

  if (res) {
    add(card, 
      h('div', { class: 'feedback' }, mdEl(res.feedback || '')),
      res.fehler?.length ? h('div', { class: 'errors' }, h('div', { class: 'label' }, 'Fehler'), res.fehler.map((f) => h('div', { class: 'error-item' },
        f.zitat ? h('div', { class: 'quote' }, `„${f.zitat}“`) : null, h('div', {}, h('strong', {}, 'Problem: '), f.problem || ''), f.korrektur ? h('div', {}, h('strong', {}, 'Richtig: '), f.korrektur) : null))) : null,
      res.fehlt?.length ? h('div', { class: 'missing' }, h('div', { class: 'label' }, 'Hat gefehlt'), h('ul', {}, res.fehlt.map((x) => h('li', {}, x)))) : null,
      h('details', { class: 'details' }, h('summary', {}, 'Musterlösung'), mdEl(res.musterloesung || '')),
      h('details', { class: 'details' }, h('summary', {}, 'Erwartungshorizont'), h('ul', {}, (a.erwartung || []).map((x) => h('li', {}, x)))),
      followupChat(exam, sess, a, res));
  }
  return card;
}

function followupChat(exam, sess, task, res) {
  const msgs = (sess.chats[task.id] ||= []);
  const box = h('div', { class: 'chat compact' });
  const list = h('div', { class: 'chat-list' });
  const draw = () => {
    list.replaceChildren(
      h('div', { class: 'msg model' }, mdEl(`**Nachfrage:** ${res.nachfrage || 'Was genau war dein Fehler?'}`)),
      ...msgs.map((m) => h('div', { class: `msg ${m.role}` }, m.role === 'model' ? mdEl(m.text) : m.text)));
  };
  draw();
  const input = h('textarea', { class: 'input', rows: 2, placeholder: 'Antworte auf die Nachfrage …' });
  const send = h('button', { class: 'iconbtn send', 'aria-label': 'Senden', onclick: async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const history = [{ role: 'model', text: res.nachfrage || '' }, ...msgs];
    msgs.push({ role: 'user', text });
    draw();
    send.disabled = true;
    try {
      const reply = await generate({ system: P.followupSystem(exam, task, sess, res), parts: [{ text }], history, temperature: 0.4 });
      msgs.push({ role: 'model', text: reply });
    } catch (e) { msgs.pop(); input.value = text; toast(errorMsg(e), 'error'); }
    save(); draw(); send.disabled = false;
  } }, icon('send'));
  add(box, list, h('div', { class: 'chat-input' }, input, send));
  return box;
}

async function gradeSession(exam, unit, sess) {
  const subject = subjectById(exam.subjectId);
  const parts = [{ text: P.gradePrompt(exam, sess) }];
  for (const a of sess.aufgaben) {
    for (const id of sess.answerImages[a.id] || []) {
      parts.push({ text: `Foto der handschriftlichen Lösung zu Aufgabe ${a.id}:` });
      parts.push(await filePart(id));
    }
  }
  const g = await generate({ system: P.baseSystem(subject), parts, json: true, temperature: 0.1 });
  // Punkte absichern (nie über Maximum)
  for (const r of g.ergebnisse || []) {
    const t = sess.aufgaben.find((a) => a.id === r.id);
    r.maxPunkte = t ? t.punkte : Number(r.maxPunkte) || 0;
    r.punkte = Math.max(0, Math.min(Number(r.punkte) || 0, r.maxPunkte));
  }
  const max = sess.aufgaben.reduce((s, a) => s + a.punkte, 0);
  const got = (g.ergebnisse || []).reduce((s, r) => s + r.punkte, 0);
  g.percent = max ? Math.round((got / max) * 100) : 0;
  g.got = got; g.max = max;
  g.grade = percentToGrade(g.percent);
  sess.grading = g;
  const weak = g.gesamt?.schwaechen || [];
  exam.weaknesses = [...new Set([...(exam.weaknesses || []), ...weak])].slice(-30);
  exam.lastResult = { percent: g.percent, grade: g.grade, at: Date.now(), unit: unit.titel };
  save();
}

function resultSummary(exam, unit, sess) {
  const g = sess.grading;
  const ok = reachesTarget(g.grade, exam.targetGrade);
  return h('section', { class: `card summary ${ok ? 'good' : 'bad'}` },
    h('div', { class: 'row between' },
      h('div', {}, h('div', { class: 'big-num' }, `${g.got}/${g.max}`), h('div', { class: 'muted small' }, `${g.percent} % · Punkte`)),
      h('div', { class: 'right' }, h('div', { class: 'big-num' }, `≈ ${g.grade}`), h('div', { class: 'muted small' }, `Ziel: ${gradeLabel(exam.targetGrade)}`))),
    h('p', { class: 'muted small' }, 'Notenschätzung nach gängigem Schlüssel – deine Schule kann abweichen.'),
    g.gesamt?.kommentar ? mdEl(g.gesamt.kommentar) : null,
    g.gesamt?.schwaechen?.length ? h('div', {}, h('div', { class: 'label' }, 'Schwächen (werden ab jetzt gezielt trainiert)'), h('ul', {}, g.gesamt.schwaechen.map((x) => h('li', {}, x)))) : null,
    g.gesamt?.staerken?.length ? h('div', {}, h('div', { class: 'label' }, 'Stärken'), h('ul', {}, g.gesamt.staerken.map((x) => h('li', {}, x)))) : null);
}

function markDone(exam, unitId, sess, keepOpen = false) {
  for (const sec of exam.plan?.abschnitte || []) for (const u of sec.einheiten) if (u.id === unitId) {
    if (sess?.grading) u.score = sess.grading.percent;
    if (!keepOpen) u.status = 'done';
  }
  ui.selectedUnit = null;
  save();
}

// ================================================================ LERNZETTEL & QUIZ
// Startet eine KI-Erzeugung einmal, zeigt solange den Warte-Bildschirm und bei Fehlern "Nochmal".
function pending(main, key, title, steps, producer) {
  const err = ui.busy[key] ? null : ui.busy[`err:${key}`];
  if (err) {
    add(main, h('div', { class: 'card warn' }, h('p', {}, err), fallbackTip(err)),
      h('button', { class: 'btn primary block', onclick: () => { delete ui.busy[`err:${key}`]; render(); } }, 'Nochmal versuchen'));
    return;
  }
  const panel = waitPanel(title);
  panel.setSteps(steps);
  panel.run(steps.length - 1);
  add(main, panel.el);
  if (backgroundAvailable()) add(main, bgHint());
  if (ui.busy[key]) return;
  ui.busy[key] = true;
  const here = route; // nur neu zeichnen, wenn man noch auf derselben Seite ist
  let ok = false;
  producer()
    .then(() => { ok = true; save(); })
    .catch((e) => { ui.busy[`err:${key}`] = errorMsg(e); })
    .finally(() => { delete ui.busy[key]; if (route === here) (ok ? jellyTransition(() => { if (route === here) render(); }) : render()); });
}

function ensureSheetCSS() {
  if (document.getElementById('sheet-css')) return;
  add(document.head, h('style', { id: 'sheet-css', html: SHEET_CSS }));
}

const dmy = (iso) => { const d = parseISO(iso); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`; };

function sheetHead(exam, subject, topic) {
  const p = state.profile || {};
  const themen = (exam.plan?.themen || []).map((t) => t.titel);
  const klasse = `Klasse ${p.grade || '?'} / ${p.schoolType === 'Gymnasium' ? 'Gy' : p.schoolType || ''}`;
  if (!topic) {
    return {
      title: `Lernzettel: ${subject?.name || ''} ${exam.date ? 'Klausur' : ''}`.trim(),
      subtitle: `${exam.date ? `Themen für die Klausur (${dmy(exam.date)})` : 'Themen'} | ${themen.join(' & ')}`,
      meta: [klasse, `Fach: ${subject?.name || ''}`, subject?.teacher ? `Lehrkraft: ${subject.teacher}` : ''].filter(Boolean),
      footer: `${subject?.name || ''} Lernzettel – Gesamt`,
    };
  }
  return {
    title: `Lernzettel: ${topic.titel}`,
    subtitle: `${subject?.name || ''}${exam.date ? ` | Klausur am ${dmy(exam.date)}` : ''}${topic.schwerpunkte?.length ? ` | ${topic.schwerpunkte.slice(0, 3).join(', ')}` : ''}`,
    meta: [klasse, `Thema: ${topic.titel}`, subject?.teacher ? `Lehrkraft: ${subject.teacher}` : ''].filter(Boolean),
    footer: `${subject?.name || ''} Lernzettel – ${topic.titel}`,
  };
}

function viewLernzettel(main, exam, unit) {
  ensureSheetCSS();
  const subject = subjectById(exam.subjectId);
  const overall = unit.typ === 'gesamtzettel';
  const topic = overall ? null : exam.plan?.themen?.[unit.themaIndex];
  const sess = state.sessions[unit.id];
  if (!sess?.lernzettel) {
    pending(main, unit.id, overall ? 'Ich fasse die ganze Klausur auf einem Lernzettel zusammen …' : `Ich schreibe deinen Lernzettel zu „${topic?.titel || unit.titel}“ …`,
      ['Material & Lehrerprofil auswerten', 'Lernzettel schreiben'], () => genLernzettel(exam, unit));
    return;
  }
  const head = sheetHead(exam, subject, overall ? null : topic || { titel: unit.titel });
  const dl = h('button', { class: 'btn', onclick: async () => {
    dl.disabled = true; const old = dl.textContent; dl.textContent = 'Erstelle PDF …';
    try { await downloadLernzettel(head, sess.lernzettel); } catch (e) { toast(errorMsg(e), 'error'); }
    dl.disabled = false; dl.textContent = old;
  } }, icon('download', 18), 'Als PDF speichern');
  const next = nextOpenUnit(exam, unit.id);
  add(main,
    h('article', { class: 'lernzettel', html: sheetHTML(head, sess.lernzettel) }),
    h('div', { class: 'row gap wrap center' }, dl,
      h('button', { class: 'btn ghost', onclick: async () => { if (await confirmDialog('Lernzettel neu schreiben lassen?', 'Neu schreiben')) { delete state.sessions[unit.id]; save(); render(); } } }, icon('refresh', 18), 'Neu schreiben')),
    h('button', { class: 'btn primary block', onclick: () => {
      setUnitStatus(exam, [unit.id], 'done');
      if (next && !overall) go('session', { examId: exam.id, unitId: next.id });
      else { if (next) ui.selectedUnit = next.id; go('plan'); }
    } }, overall ? 'Gelesen' : next && next.typ === 'quiz' ? 'Gelesen – weiter zum Quiz' : 'Gelesen'));
}

// Antwortvergleich fürs Eingabe-Quiz: Groß/Klein, Leerzeichen, Komma/Punkt, kleine Tippfehler, Zahlen mit 1 % Toleranz.
// Antwortvergleich: Groß/Klein, Leerzeichen, Satzzeichen egal; Akzente zählen (é ≠ e).
// Normaler Modus: kleine Tippfehler ok, Zahlen mit 1 % Toleranz. Strenger Modus (Vokabeln): Schreibweise muss stimmen.
function normAnswer(x) {
  return String(x ?? '').normalize('NFC').toLowerCase().replace(/ß/g, 'ss').replace(/,/g, '.').replace(/[^\p{L}\p{N}.\-]/gu, '');
}
function numOf(x) {
  const m = String(x ?? '').replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function checkInput(value, answers, strict = false) {
  const v = normAnswer(value);
  if (!v) return false;
  return (answers || []).some((ans) => {
    const n1 = numOf(value), n2 = numOf(ans);
    if (!strict && n2 !== null && /^-?[\d.]+[\p{L}°%/]*$/u.test(normAnswer(ans))) return n1 !== null && Math.abs(n1 - n2) <= Math.max(Math.abs(n2) * 0.01, 1e-9);
    const a = normAnswer(ans);
    return v === a || (!strict && a.length > 5 && lev(v, a) <= 1);
  });
}
const correctText = (q) => q.typ === 'mc' ? q.optionen[q.richtig] : q.typ === 'wahrfalsch' ? (q.richtig ? 'Wahr' : 'Falsch') : `${(q.antworten || [])[0] || ''}${q.einheit ? ` ${q.einheit}` : ''}`;

// Allgemeiner Quiz-Ablauf (eine Frage nach der anderen, sofortiges Feedback).
// opts: { strict, verdict(pct) → Text, actions(pct, right, total) → Elemente unter dem Ergebnis }
function runQuiz(main, sess, opts = {}) {
  const qs = sess.fragen;
  // Schon erstellte Quizze: noch nicht beantwortete Fragen nachträglich mischen
  if (qs.reduce((n, q, i) => n + (!sess.antworten?.[i] && mixOptions(q) ? 1 : 0), 0)) save();
  const total = qs.length;
  if (sess.idx >= total) {
    const right = qs.filter((_, i) => sess.antworten[i]?.correct).length;
    const pct = Math.round((right / total) * 100);
    const wrong = qs.map((q, i) => ({ q, a: sess.antworten[i] })).filter((x) => !x.a?.correct);
    add(main,
      h('section', { class: `card summary ${pct >= 75 ? 'good' : 'bad'}` },
        h('div', { class: 'row between' }, h('div', {}, h('div', { class: 'big-num' }, `${right}/${total}`), h('div', { class: 'muted small' }, 'richtig')), h('div', { class: 'big-num' }, `${pct} %`)),
        h('p', {}, opts.verdict ? opts.verdict(pct) : '')),
      wrong.length ? h('section', { class: 'card' }, h('div', { class: 'label' }, 'Das musst du dir merken'),
        h('ul', { class: 'wrong-list' }, wrong.map(({ q, a }) => h('li', {}, h('div', {}, q.frage), h('div', { class: 'small' }, h('span', { class: 'bad-text' }, `Deine Antwort: ${a?.label ?? '–'}`), ' · ', h('strong', {}, `Richtig: ${correctText(q)}`)), q.erklaerung ? h('div', { class: 'muted small' }, q.erklaerung) : null)))) : null,
      opts.actions ? opts.actions(pct, right, total) : null);
    return;
  }
  const i = sess.idx;
  const q = qs[i];
  const ans = sess.antworten[i];
  const answer = (label, correct, value) => { sess.antworten[i] = { label, correct, value }; save(); render(); };
  const body = h('div', { class: 'quiz-body' });
  if (q.typ === 'mc') {
    add(body, h('div', { class: 'quiz-options' }, q.optionen.map((o, oi) => {
      const st = ans ? (oi === q.richtig ? 'right' : ans.value === oi ? 'wrong' : 'dim') : '';
      return h('button', { class: `quiz-opt ${st}`, disabled: !!ans, onclick: () => answer(o, oi === q.richtig, oi) }, h('span', { class: 'opt-letter' }, 'ABCD'[oi] || '•'), h('span', {}, cleanText(o)));
    })));
  } else if (q.typ === 'wahrfalsch') {
    add(body, h('div', { class: 'quiz-options two' }, [[true, 'Wahr'], [false, 'Falsch']].map(([v, l]) => {
      const st = ans ? (v === !!q.richtig ? 'right' : ans.value === v ? 'wrong' : 'dim') : '';
      return h('button', { class: `quiz-opt ${st}`, disabled: !!ans, onclick: () => answer(l, v === !!q.richtig, v) }, h('span', {}, l));
    })));
  } else {
    const inp = h('input', { class: `input big ${ans ? (ans.correct ? 'right' : 'wrong') : ''}`, placeholder: 'Deine Antwort', value: ans?.label || '', disabled: !!ans, autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', onkeydown: (e) => { if (e.key === 'Enter') btn.click(); } });
    const btn = h('button', { class: 'btn primary', onclick: () => { if (!inp.value.trim()) return; answer(inp.value.trim(), checkInput(inp.value, q.antworten, opts.strict), inp.value.trim()); } }, 'Prüfen');
    add(body, h('div', { class: 'row gap' }, inp, q.einheit ? h('span', { class: 'muted' }, q.einheit) : null, ans ? null : btn));
    if (!ans) setTimeout(() => inp.focus(), 50);
  }
  if (ans) {
    add(body, h('div', { class: `quiz-feedback ${ans.correct ? 'right' : 'wrong'}` },
      h('strong', {}, ans.correct ? 'Richtig!' : q.typ === 'eingabe' ? `Falsch – richtig ist: ${correctText(q)}` : 'Falsch.'),
      q.erklaerung ? h('div', {}, cleanText(q.erklaerung)) : null,
      !ans.correct && q.typ === 'eingabe' ? h('button', { class: 'link-small', onclick: () => { ans.correct = true; save(); render(); } }, 'Meine Antwort war doch richtig') : null));
  }
  add(main,
    h('div', { class: 'quiz-top' }, h('div', { class: 'progress' }, h('div', { class: 'progress-fill', style: { width: `${Math.round((i / total) * 100)}%` } })), h('span', { class: 'muted small' }, `${i + 1}/${total}`)),
    h('section', { class: 'card quiz-card' },
      h('div', { class: 'label' }, q.typ === 'wahrfalsch' ? 'Wahr oder falsch?' : q.typ === 'eingabe' ? 'Antwort eintippen' : 'Wähle die richtige Antwort'),
      h('div', { class: 'quiz-q' }, cleanText(q.frage)), body),
    ans ? h('button', { class: 'btn primary block', onclick: () => { sess.idx = i + 1; save(); render(); } }, i + 1 < total ? 'Weiter' : 'Ergebnis ansehen') : null);
}

function viewQuiz(main, exam, unit) {
  const topic = exam.plan?.themen?.[unit.themaIndex] || { titel: unit.titel };
  const sess = state.sessions[unit.id];
  if (!sess?.fragen) {
    pending(main, unit.id, `Ich stelle dir ein Quiz zu „${topic.titel}“ zusammen …`, ['Lernzettel lesen', 'Fragen ausdenken'], () => genQuiz(exam, unit));
    return;
  }
  const next = nextOpenUnit(exam, unit.id);
  runQuiz(main, sess, {
    verdict: (pct) => (pct === 100 ? 'Alles richtig. Die Fakten sitzen.' : pct >= 75 ? 'Solide – schau dir die Fehler unten trotzdem an.' : 'Das sitzt noch nicht. Lies den Lernzettel nochmal und mach das Quiz erneut, bevor du an die Aufgaben gehst.'),
    actions: (pct) => [
      h('button', { class: 'btn primary block', onclick: () => {
        for (const sec of exam.plan.abschnitte) for (const u of sec.einheiten) if (u.id === unit.id) { u.status = 'done'; u.score = pct; }
        if (pct < 70) exam.weaknesses = [...new Set([...(exam.weaknesses || []), `Fakten/Begriffe zu „${topic.titel}“ unsicher (Quiz ${pct} %)`])].slice(-30);
        save();
        if (next && next.themaIndex === unit.themaIndex) go('session', { examId: exam.id, unitId: next.id }); else go('pick', { examId: exam.id, typ: 'quiz' });
      } }, next?.typ === 'aufgaben' && next.themaIndex === unit.themaIndex ? 'Weiter zu den Anwendungsaufgaben' : 'Fertig'),
      h('div', { class: 'row gap wrap center' },
        h('button', { class: 'btn ghost', onclick: () => { sess.antworten = {}; sess.idx = 0; save(); render(); } }, 'Gleiches Quiz nochmal'),
        h('button', { class: 'btn ghost', onclick: () => { state.sessions[unit.id] = { alteFragen: sess.alteFragen }; save(); render(); } }, icon('refresh', 18), 'Neue Fragen')),
    ],
  });
}

// ================================================================ FÄCHER & KLAUSUR-ARCHIV
function addSubjectDialog(onDone) {
  const name = h('input', { class: 'input', placeholder: 'Name des Fachs' });
  let lang = 'de';
  const seg = h('div', { class: 'seg' });
  const drawSeg = () => seg.replaceChildren(
    h('button', { class: `seg-btn ${lang === 'de' ? 'active' : ''}`, onclick: () => { lang = 'de'; drawSeg(); } }, 'Unterricht auf Deutsch'),
    h('button', { class: `seg-btn ${lang === 'en' ? 'active' : ''}`, onclick: () => { lang = 'en'; drawSeg(); } }, 'auf Englisch'));
  drawSeg();
  const o = sheet('Fach hinzufügen', [name, seg, h('button', { class: 'btn primary block', onclick: () => {
    const n = name.value.trim();
    if (!n) return toast('Bitte einen Namen eingeben.');
    if (state.subjects.some((s) => s.name.toLowerCase() === n.toLowerCase())) return toast('Das Fach gibt es schon.');
    const s = makeSubject(n, null, null, lang);
    state.subjects.push(s); save(); o.remove();
    onDone ? onDone(s) : render();
  } }, 'Hinzufügen')]);
  setTimeout(() => name.focus(), 50);
}

function viewSubjects() {
  return h('div', { class: 'screen with-tabs' },
    h('header', { class: 'topbar' }, h('span', { class: 'iconbtn-spacer' }), h('div', { class: 'topbar-title' }, 'Fächer'), h('button', { class: 'iconbtn', onclick: () => addSubjectDialog(), 'aria-label': 'Fach hinzufügen' }, icon('plus'))),
    h('main', { class: 'content narrow' },
      h('button', { class: 'solve-cta', onclick: () => startSolve() },
        h('span', { class: 'tile-ico' }, icon('grad', 24)),
        h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, 'Arbeitsblatt lösen'), h('span', { class: 'menu-sub' }, 'Blatt einscannen – Jelly löst alle Aufgaben mit Lösungsweg')),
        icon('chev', 18)),
      solvedList().length ? h('div', { class: 'menu' }, solvedList().slice(0, 4).map((x) => menuRow('checkc', x.titel, x.ersteAufgabe || 'Gelöstes Blatt', () => go('solved', { id: x.id })))) : null,
      h('div', { class: 'label' }, 'Deine Fächer'),
      h('div', { class: 'menu' }, state.subjects.map((s) => h('button', { class: 'menu-row', onclick: () => go('subject', { id: s.id }) },
        subjectBadge(s, 38),
        h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, s.name), h('span', { class: 'menu-sub' }, `${archiveCountOf(s) ? `${archiveCountOf(s)} alte Klausuren` : 'Noch keine alten Klausuren'}${P.langInfo(s).teach !== 'de' ? ` · ${P.LANG_NAMES[P.langInfo(s).teach]}` : ''}`)),
        icon('chev', 18)))),
      h('button', { class: 'link-small', onclick: () => addSubjectDialog() }, icon('plus', 16), 'Fach hinzufügen')),
    tabbar('subjects'));
}

function viewSubject({ id }) {
  const s = subjectById(id);
  if (!s) { go('subjects'); return h('div'); }
  const archiveList = h('div', { class: 'list' });
  const drawArchive = () => {
    archiveList.replaceChildren(...(s.archive || []).filter((fid) => state.files[fid] && isGroupLead(fid)).map((fid) => {
      const f = state.files[fid];
      const st = ui.busy[fid] ? 'liest …' : f.digest ? '✓ gelesen' : 'noch nicht gelesen';
      return h('div', { class: 'list-item' },
        h('button', { class: 'row gap file-open', onclick: () => openFile(fid) }, icon('file', 20), h('span', { class: 'stack-tight' }, h('span', {}, f.digest?.titel || f.name), h('span', { class: 'muted small' }, `${pagesLabel(fid)} · ${st}`))),
        h('span', { class: 'row gap' },
          !f.digest && !ui.busy[fid] ? h('button', { class: 'btn small', onclick: () => readArchive() }, 'Lesen') : null,
          h('button', { class: 'iconbtn', 'aria-label': 'Seite hinzufügen', title: 'Seite hinzufügen', onclick: async () => {
            const files = await pickFiles({ accept: 'image/*,application/pdf,.pdf' });
            if (!files.length) return;
            const added = await uploadPages(files, { kind: 'archive', subjectId: s.id, into: fid });
            s.archive.push(...added); save(); drawArchive();
            if (added.length) { toast(`Seite${added.length > 1 ? 'n' : ''} hinzugefügt – ich lese die Klausur neu.`, 'ok'); readArchive(); }
          } }, icon('plus', 18)),
          h('button', { class: 'iconbtn', 'aria-label': 'Löschen', onclick: async () => {
            if (!(await confirmDialog(`Diese Klausur (${pagesLabel(fid)}) aus dem Archiv löschen?`, 'Löschen'))) return;
            const ids = groupOf(fid);
            s.archive = s.archive.filter((x) => !ids.includes(x)); await removeGroup(fid); save(); render();
          } }, icon('trash', 18))));
    }));
    if (!(s.archive || []).length) add(archiveList, h('p', { class: 'muted small' }, 'Noch keine alten Klausuren.'));
  };
  // Liest ungelesene alte Klausuren und baut das Lehrerprofil neu. Geht die App zu, macht der Hintergrund weiter.
  const readArchive = async () => {
    if (!aiReady()) return toast('Bitte zuerst die KI einrichten.', 'error');
    const key = `prof:${s.id}`;
    if (ui.busy[key]) return;
    s.profileBuilding = true; save();
    queueJob({ key: `p_${s.id}`, type: 'subject', id: s.id });
    ui.busy[key] = true;
    profileBox.replaceChildren(h('p', { class: 'muted' }, 'Analysiere den Stil deiner Lehrkraft …'));
    try {
      for (const fid of s.archive || []) {
        if (state.files[fid]?.digest) continue;
        ui.busy[fid] = true; drawArchive();
        try { await digestFile(fid); save(); } finally { delete ui.busy[fid]; drawArchive(); }
      }
      if ((s.archive || []).some((fid) => state.files[fid]?.digest) || P.vocabProfileFor(s)) { await buildTeacherProfile(s); toast('Lehrerprofil aktualisiert.', 'ok'); }
      delete s.profileBuilding; save();
    } catch (e) { toast(errorMsg(e), 'error'); }
    delete ui.busy[key];
    drawProfile();
  };
  const profileBox = h('div');
  const drawProfile = (editing = false) => {
    if (editing) {
      const ta = h('textarea', { class: 'input', rows: 14, value: s.teacherProfile || '' });
      profileBox.replaceChildren(ta, h('div', { class: 'row gap' },
        h('button', { class: 'btn primary', onclick: () => { s.teacherProfile = ta.value; save(); drawProfile(); } }, 'Speichern'),
        h('button', { class: 'btn ghost', onclick: () => drawProfile() }, 'Abbrechen')));
      return;
    }
    profileBox.replaceChildren(
      h('div', { class: 'label' }, 'Name der Lehrkraft'),
      h('input', { class: 'input', placeholder: 'z. B. Frau Müller', value: s.teacher || '', onchange: (e) => { s.teacher = e.target.value.trim(); save(); } }),
      h('p', { class: 'muted small' }, 'Steht dann oben auf deinen Lernzetteln. Der Name wird nicht an die KI geschickt.'),
      s.profileBuilding && !ui.busy[`prof:${s.id}`] ? h('p', { class: 'muted small' }, backgroundAvailable() ? 'Jelly arbeitet im Hintergrund am Lehrerprofil.' : 'Das Lehrerprofil ist noch nicht fertig.') : null,
      s.teacherProfile ? mdEl(s.teacherProfile) : h('p', { class: 'muted small' }, 'Wird automatisch erstellt, sobald alte Klausuren oder Vokabeltests gelesen wurden.'),
      P.vocabProfileFor(s) ? h('p', { class: 'muted small' }, `Enthält auch das Profil deiner ${P.vocabSpracheOf(s)}-Vokabeltests.`) : null,
      h('div', { class: 'row gap wrap' },
        s.archive?.length || P.vocabProfileFor(s) ? h('button', { class: 'btn small', onclick: () => readArchive() }, s.profileBuilding ? 'Jetzt hier erstellen' : 'Neu erstellen') : null,
        h('button', { class: 'btn small ghost', onclick: () => drawProfile(true) }, 'Bearbeiten')));
  };
  drawArchive(); drawProfile();

  const upload = async () => {
    const files = await pickFiles();
    if (!files.length) return;
    const together = await askTogether(files.length, 'einer Klausur', 'Einzelne Klausuren');
    const added = await uploadPages(files, { kind: 'archive', subjectId: s.id, together });
    (s.archive ||= []).push(...added);
    save(); drawArchive();
    if (added.length) readArchive();
  };
  const fold = (ic, title, sub, body, openFold = false) => h('details', { class: 'fold', open: openFold },
    h('summary', {}, h('span', { class: 'menu-ico' }, icon(ic, 20)), h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, title), sub ? h('span', { class: 'menu-sub' }, sub) : null), h('span', { class: 'fold-chev' }, icon('chev', 18))),
    h('div', { class: 'fold-body' }, body));

  return h('div', { class: 'screen' },
    topbar({ back: () => go('subjects'), title: '' }),
    h('main', { class: 'content narrow' },
      h('div', { class: 'subject-hero' }, subjectBadge(s, 56), h('h1', { class: 'display' }, s.name), P.langInfo(s).teach !== 'de' ? h('span', { class: 'chip-static' }, `Unterricht auf ${P.LANG_NAMES[P.langInfo(s).teach]}`) : null),
      h('button', { class: 'btn primary block', onclick: () => startNewExam(s.id) }, icon('plus', 18), 'Klausur anlegen'),
      h('div', { class: 'folds' },
        fold('layers', 'Alte Klausuren', `${archiveCountOf(s)} hochgeladen`, [
          h('p', { class: 'muted small' }, 'Am besten korrigierte Klausuren (mit Rotstift & Punkten). Daraus lerne ich den Stil deiner Lehrkraft.'),
          archiveList,
          h('button', { class: 'btn block', onclick: upload }, icon('upload', 18), 'Klausuren hochladen')]),
        fold('checkc', 'Gelöste Arbeitsblätter', `${solvedList().filter((x) => x.subjectId === s.id).length} Blätter`, [
          h('div', { class: 'menu' }, solvedList().filter((x) => x.subjectId === s.id).map((x) => menuRow('file', x.titel, x.ersteAufgabe || '', () => go('solved', { id: x.id })))),
          h('button', { class: 'btn block', onclick: () => startSolve(s.id) }, icon('camera', 18), 'Arbeitsblatt lösen')]),
        fold('user', 'Lehrerprofil', [s.teacher, s.teacherProfile ? 'Profil erstellt' : 'Noch kein Profil'].filter(Boolean).join(' · '), [profileBox]),
        P.vocabSpracheOf(s) ? (() => { const sp = P.vocabSpracheOf(s); const n = vocab().tests[sp]?.fileIds?.length || 0; return h('div', { class: 'menu' }, menuRow('layers', 'Vokabeltests', n ? `${n} alte Tests · fließen ins Lehrerprofil ein` : 'Alte Vokabeltests hochladen', () => go('vtests', { sprache: sp }))); })() : null,
        fold('gear', 'Fach-Einstellungen', null, [
          h('div', { class: 'label' }, 'Name'),
          h('input', { class: 'input', value: s.name, onchange: (e) => { if (e.target.value.trim()) { s.name = e.target.value.trim(); save(); } } }),
          h('div', { class: 'label' }, 'Unterrichtssprache'),
          h('div', { class: 'seg seg-wrap' }, [['de', 'Deutsch'], ['en', 'Englisch'], ['es', 'Spanisch'], ['fr', 'Französisch']].map(([v, l]) => h('button', { class: `seg-btn ${P.langInfo(s).teach === v ? 'active' : ''}`, onclick: () => { s.language = v; s.langSet = true; save(); render(); } }, l))),
          P.langInfo(s).fach ? h('p', { class: 'muted small' }, `Sprachfach erkannt: Lernzettel kommen gemischt (Erklärungen auf Deutsch, Beispiele auf ${P.LANG_NAMES[P.langInfo(s).fach]}).`) : null,
          h('div', { class: 'label' }, 'Dein Stand'),
          h('div', { class: 'seg' }, [[1, 'schwach'], [2, 'mittel'], [3, 'stark']].map(([v, l]) => h('button', { class: `seg-btn ${s.level === v ? 'active' : ''}`, onclick: () => { s.level = v; save(); render(); } }, l))),
          h('div', { class: 'label' }, 'Was weißt du über deine Lehrkraft?'),
          h('textarea', { class: 'input', rows: 3, placeholder: 'z. B. „Achtet sehr auf Fachbegriffe, will immer eine Einleitung“', value: s.teacherNotes || '', oninput: (e) => { s.teacherNotes = e.target.value; save(); } }),
          h('button', { class: 'btn ghost block danger-text', onclick: async () => {
            if (state.exams.some((e) => e.subjectId === s.id)) return toast('Lösche zuerst die Klausuren dieses Fachs.', 'error');
            if (!(await confirmDialog(`${s.name} samt Archiv löschen?`, 'Löschen'))) return;
            for (const fid of s.archive || []) await removeFile(fid);
            state.subjects = state.subjects.filter((x) => x.id !== s.id); save(); go('subjects');
          } }, 'Fach löschen')]))));
}

// ================================================================ ARBEITSBLATT LÖSEN
const solvedList = () => (state.solved ||= []);
let nsv = null;

function startSolve(subjectId = null) {
  nsv = { subjectId: subjectId || state.subjects[0]?.id || null, fileIds: [], note: '', links: '' };
  go('solve');
}

function viewSolveNew() {
  if (!nsv) { startSolve(); return h('div'); }
  const cancel = async () => { for (const id of nsv.fileIds) await removeFile(id); nsv = null; go('subjects'); };
  if (nsv.processing) { startSolveBuild(); return h('div'); }
  const grid = h('div', { class: 'grid3' });
  const draw = async () => {
    const tiles = [];
    for (const id of nsv.fileIds) {
      const url = await thumbURL(id);
      tiles.push(h('div', { class: 'tile filled' }, url ? h('img', { src: url, onclick: () => openFile(id) }) : h('div', { class: 'tile-file', onclick: () => openFile(id) }, icon('file', 30), h('span', {}, state.files[id]?.name || '')),
        h('button', { class: 'tile-del', onclick: async () => { nsv.fileIds = nsv.fileIds.filter((x) => x !== id); await removeFile(id); draw(); } }, icon('close', 16))));
    }
    const addTile = (label, opts) => h('button', { class: 'tile', onclick: async () => {
      for (const f of await pickFiles(opts)) { try { nsv.fileIds.push(await addFile(f, { kind: 'sheet', subjectId: nsv.subjectId })); } catch (e) { toast(errorMsg(e), 'error'); } }
      draw();
    } }, icon(opts.capture ? 'camera' : 'plus', 28), h('span', { class: 'small muted' }, label));
    tiles.push(addTile('Foto aufnehmen', { accept: 'image/*', capture: 'environment', multiple: false }), addTile('Scan / PDF', {}));
    grid.replaceChildren(...tiles);
  };
  draw();
  return h('div', { class: 'screen' }, topbar({ back: cancel, title: 'Blatt lösen' }),
    h('main', { class: 'content narrow' },
      speech('Scanne ein Arbeitsblatt ein oder füge einen Link ein – ich löse alle Aufgaben und erkläre dir den Weg.'),
      h('div', { class: 'label' }, 'Fach'),
      h('div', { class: 'chips' }, state.subjects.map((sub) => h('button', { class: `chip ${nsv.subjectId === sub.id ? 'active' : ''}`, onclick: () => { nsv.subjectId = sub.id; render(); } }, sub.name))),
      h('div', { class: 'label' }, 'Seiten'),
      grid,
      h('div', { class: 'label' }, 'Links (optional, z. B. LEIFIphysik)'),
      (() => {
        const ta = h('textarea', { class: 'input', rows: 2, placeholder: 'Link von der Lehrkraft hier einfügen – auch mehrere', value: nsv.links, oninput: (e) => { nsv.links = e.target.value; } });
        const paste = navigator.clipboard?.readText ? h('button', { class: 'btn small ghost', onclick: async () => {
          try { const t = await navigator.clipboard.readText(); if (t) { nsv.links = [nsv.links, t].filter(Boolean).join('\n'); ta.value = nsv.links; } } catch { toast('Einfügen nicht erlaubt – tippe lang ins Feld und wähle „Einfügen“.'); }
        } }, icon('download', 16), 'Aus Zwischenablage einfügen') : null;
        return h('div', { class: 'stack' }, ta, paste, h('p', { class: 'muted small' }, 'Jelly öffnet die Seiten selbst. Nicht möglich sind Seiten mit Login oder Bezahlschranke, Videos und rein interaktive Übungen – dann lieber einen Screenshot hochladen.'));
      })(),
      h('div', { class: 'label' }, 'Hinweis (optional)'),
      h('input', { class: 'input', placeholder: 'z. B. „nur Aufgabe 2–4“ oder „M3 ist auf der Rückseite“', value: nsv.note, oninput: (e) => { nsv.note = e.target.value; } })),
    h('footer', { class: 'footer' }, h('button', { class: 'btn primary block', onclick: () => {
      if (!aiReady()) return toast('Bitte zuerst die KI einrichten (Mehr → KI-Verbindung).', 'error');
      if (!nsv.fileIds.length && !parseLinks(nsv.links).length) return toast('Bitte eine Seite fotografieren oder einen Link einfügen.');
      nsv.processing = true; render();
    } }, 'Blatt lösen')));
}

// Links aus einem Text holen (eingefügt aus Safari, Mail, Teams …). Ohne https:// wird es ergänzt.
function parseLinks(text) {
  const found = String(text || '').match(/(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(de|com|org|net|info|eu|at|ch)\/[^\s<>"']*)/gi) || [];
  return [...new Set(found.map((u) => u.replace(/[).,;]+$/, '')).map((u) => (/^https?:/i.test(u) ? u : `https://${u}`)))].slice(0, 20);
}

function startSolveBuild() {
  const subject = subjectById(nsv.subjectId);
  const item = { id: uid(), subjectId: nsv.subjectId, fileIds: [...nsv.fileIds], links: parseLinks(nsv.links), note: nsv.note.trim(), loesung: null, titel: `${subject?.name || 'Blatt'} · ${new Date().toLocaleDateString('de-DE')}`, ersteAufgabe: '', chat: [], createdAt: Date.now(), annot: {}, building: true };
  solvedList().unshift(item);
  save();
  nsv = null;
  queueJob({ key: `s_${item.id}`, type: 'solve', id: item.id });
  go('solved', { id: item.id });
}

const SVG_CROSS = '<svg viewBox="0 0 10 10" preserveAspectRatio="none"><path d="M1.5 1.5 L8.5 8.5 M8.5 1.5 L1.5 8.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/></svg>';
const SVG_CHECK = '<svg viewBox="0 0 10 10"><path d="M1.5 5.5 L4 8 L8.8 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';

function annotatedPage(fid, entries, show) {
  const wrap = h('div', { class: `annot-wrap ${show ? '' : 'hide-ink'}` });
  const img = h('img', { alt: 'Arbeitsblatt' });
  add(wrap, img);
  const layer = h('div', { class: 'annot-layer' });
  add(wrap, layer);
  const pos = (b) => ({ top: `${b[0] / 10}%`, left: `${b[1] / 10}%`, height: `${(b[2] - b[0]) / 10}%`, width: `${(b[3] - b[1]) / 10}%` });
  const texts = [];
  for (const e of entries) {
    const st = pos(e.box);
    if (e.art === 'text') { const t = h('div', { class: 'ink ink-text', style: st }, cleanText(e.text || '')); texts.push([t, e.box]); add(layer, t); }
    else if (e.art === 'kreuz') add(layer, h('div', { class: 'ink ink-cross', style: st, html: SVG_CROSS }));
    else if (e.art === 'markieren') add(layer, h('div', { class: 'ink ink-mark', style: st }));
    else if (e.art === 'kreis') add(layer, h('div', { class: 'ink ink-circle', style: st }));
    else if (e.art === 'pruefen') {
      add(layer, h('div', { class: `ink ink-check ${e.ok ? 'ok' : 'bad'}`, style: { top: st.top, height: st.height, left: `${Math.min(97, e.box[3] / 10)}%` }, html: e.ok ? SVG_CHECK : SVG_CROSS }));
      if (!e.ok && e.text) { const t = h('div', { class: 'ink ink-text ink-fix', style: { ...st, top: `${e.box[2] / 10}%` } }, cleanText(e.text)); texts.push([t, e.box]); add(layer, t); }
    }
  }
  // Schriftgröße an die Zeilenhöhe im Foto anpassen
  // Schriftgröße: klein und gleichmäßig (nach Blattbreite), höchstens so hoch wie das Feld
  const fit = () => {
    const W = img.clientWidth, H = img.clientHeight;
    if (!W || !H) return;
    const base = W * 0.0105;
    for (const [t, b] of texts) {
      const boxH = ((b[2] - b[0]) / 1000) * H;
      t.style.fontSize = `${Math.max(6, Math.min(base, boxH * 0.75))}px`;
    }
  };
  img.onload = fit;
  if (window.ResizeObserver) new ResizeObserver(fit).observe(wrap);
  thumbURL(fid).then((u) => { if (u) img.src = u; });
  return wrap;
}

// Jede "## Aufgabe …" wird ein eigener Block; die Lösung ist zum Selbsttesten erst zugeklappt.
function solvedSheet(item, openAll) {
  const lines = item.loesung.split(/\r?\n/);
  const sections = [];
  let pre = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(/^##\s+(.*)$/);
    if (m) { cur = { title: m[1], body: [] }; sections.push(cur); } else if (cur) cur.body.push(line); else pre.push(line);
  }
  const doc = h('div', { class: 'sheet-doc' });
  if (pre.join('').trim()) add(doc, h('div', { html: md(pre.join('\n')) }));
  for (const sec of sections) {
    add(doc, h('div', { class: 'solve-task' },
      h('div', { html: md(`## ${sec.title}`) }),
      h('details', { class: 'solve-sol', open: openAll }, h('summary', {}, h('span', { class: 'when-closed' }, 'Lösung zeigen'), h('span', { class: 'when-open' }, 'Lösung verbergen')), h('div', { html: md(sec.body.join('\n')) }))));
  }
  if (!sections.length) add(doc, h('div', { html: md(item.loesung) }));
  return doc;
}

function viewSolved({ id }) {
  ensureSheetCSS();
  const item = solvedList().find((x) => x.id === id);
  if (!item) { go('subjects'); return h('div'); }
  const subject = subjectById(item.subjectId);
  if (item.building) {
    const main = h('main', { class: 'content narrow' });
    pending(main, `s:${item.id}`, 'Ich löse dein Arbeitsblatt …', ['Blatt lesen & Aufgaben lösen', 'Lösungen aufs Blatt schreiben'], () => solveSheet(item, () => save()));
    return h('div', { class: 'screen' }, topbar({ back: () => go('subjects'), title: 'Blatt lösen' }), main);
  }
  ui.solveOpen ??= false;
  const head = { title: `Lösungen: ${subject?.name || 'Arbeitsblatt'}`, subtitle: `${item.ersteAufgabe || ''}`, meta: [`Klasse ${state.profile?.grade || '?'}`, new Date(item.createdAt).toLocaleDateString('de-DE')], footer: `${subject?.name || ''} – Lösungen Arbeitsblatt` };
  const dl = h('button', { class: 'btn', onclick: async () => {
    dl.disabled = true; const old = dl.textContent; dl.textContent = 'Erstelle PDF …';
    try { await downloadLernzettel(head, item.loesung); } catch (e) { toast(errorMsg(e), 'error'); }
    dl.disabled = false; dl.textContent = old;
  } }, icon('download', 18), 'PDF');

  // Nachfragen
  const list = h('div', { class: 'chat-list' });
  const drawChat = () => list.replaceChildren(...item.chat.map((m) => h('div', { class: `msg ${m.role}` }, m.role === 'model' ? mdEl(m.text) : m.text)));
  drawChat();
  const input = h('textarea', { class: 'input', rows: 2, placeholder: 'Frag Jelly zu diesem Blatt …' });
  const send = h('button', { class: 'iconbtn send', 'aria-label': 'Senden', onclick: async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const history = item.chat.slice(-16);
    item.chat.push({ role: 'user', text });
    drawChat(); send.disabled = true;
    try { item.chat.push({ role: 'model', text: await generate({ system: P.solveChatSystem(subject, item), parts: [{ text }], history, temperature: 0.4 }) }); }
    catch (e) { item.chat.pop(); input.value = text; toast(errorMsg(e), 'error'); }
    save(); drawChat(); send.disabled = false;
  } }, icon('send'));

  return h('div', { class: 'screen' },
    topbar({ back: () => go('subjects'), title: 'Lösungen' }),
    h('main', { class: 'content narrow' },
      h('div', { class: 'row gap wrap center' },
        h('button', { class: 'btn primary', onclick: () => { ui.solveOpen = !ui.solveOpen; render(); } }, ui.solveOpen ? 'Alle zuklappen' : 'Alle aufdecken'),
        dl,
        h('button', { class: 'btn ghost', onclick: () => {
          const o = sheet('Blatt', [h('div', { class: 'menu' },
            menuRow('refresh', 'Nochmal lösen lassen', 'Gleiche Seiten, neue Lösung', async () => {
              o.remove();
              nsv = { subjectId: item.subjectId, fileIds: [...item.fileIds], note: item.note || '', processing: true };
              solvedList().splice(solvedList().indexOf(item), 1); save(); go('solve');
            }),
            menuRow('trash', 'Löschen', null, async () => {
              o.remove();
              if (!(await confirmDialog('Dieses gelöste Blatt löschen?', 'Löschen'))) return;
              for (const fid of item.fileIds) await removeFile(fid);
              state.solved = solvedList().filter((x) => x.id !== item.id); save(); go('subjects');
            }, 'danger'))]);
        } }, icon('more', 18))),
      (() => {
        const imgs = item.fileIds.filter((fid) => state.files[fid]?.mime?.startsWith('image/'));
        const hasAnnot = imgs.some((fid) => item.annot?.[fid]?.length);
        ui.solveView ??= 'blatt';
        const view = hasAnnot ? ui.solveView : 'text';
        const seg = imgs.length ? h('div', { class: 'seg' },
          h('button', { class: `seg-btn ${view === 'blatt' ? 'active' : ''}`, onclick: () => { ui.solveView = 'blatt'; render(); } }, 'Auf dem Blatt'),
          h('button', { class: `seg-btn ${view === 'text' ? 'active' : ''}`, onclick: () => { ui.solveView = 'text'; render(); } }, 'Ausführlich')) : null;
        if (imgs.length && !hasAnnot && ui.solveView === 'blatt') {
          const btn = h('button', { class: 'btn primary block', onclick: async () => {
            btn.disabled = true; btn.textContent = 'Schreibe Lösungen aufs Blatt …';
            try { for (const f of imgs) if (!item.annot?.[f]?.length) delete item.annot[f]; await solveSheet(item); save(); } catch (e) { toast(errorMsg(e), 'error'); }
            render();
          } }, 'Lösungen aufs Blatt schreiben');
          return [seg, h('p', { class: 'muted small center' }, 'Für dieses Blatt gibt es noch keine Einträge auf dem Foto.'), btn, h('article', { class: 'lernzettel solve' }, solvedSheet(item, ui.solveOpen))];
        }
        if (view === 'blatt') {
          ui.inkShow ??= true;
          return [seg,
            h('div', { class: 'row gap center' }, h('button', { class: 'btn small', onclick: () => { ui.inkShow = !ui.inkShow; render(); } }, ui.inkShow ? 'Lösungen ausblenden' : 'Lösungen einblenden')),
            h('p', { class: 'muted small center' }, 'Die Position der Einträge ist geschätzt – bei schrägen Fotos kann sie etwas verrutschen. Alles Wichtige steht unter „Ausführlich“.'),
            ...imgs.filter((fid) => item.annot?.[fid]).map((fid) => {
              const page = annotatedPage(fid, item.annot[fid], ui.inkShow);
              const box = h('div', { class: `annot-scroll ${ui.inkZoom ? 'zoomed' : ''}` }, page);
              const zoomBtn = h('button', { class: 'zoom-btn', 'aria-label': 'Vergrößern', onclick: () => { ui.inkZoom = !ui.inkZoom; box.classList.toggle('zoomed', ui.inkZoom); zoomBtn.replaceChildren(icon(ui.inkZoom ? 'minus' : 'plus', 20)); } }, icon(ui.inkZoom ? 'minus' : 'plus', 20));
              return h('div', { class: 'annot-holder' }, box, zoomBtn);
            })];
        }
        return [seg, h('p', { class: 'muted small center' }, 'Versuch jede Aufgabe erst selbst, dann aufdecken. Die KI kann sich irren – bei Zweifeln nachfragen.'),
          h('article', { class: 'lernzettel solve' }, solvedSheet(item, ui.solveOpen))];
      })(),
      (item.links || []).length ? h('div', { class: 'menu' }, item.links.map((u) => h('a', { class: 'menu-row', href: u, target: '_blank', rel: 'noopener' }, h('span', { class: 'menu-ico' }, icon('route', 20)), h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, 'Webseite öffnen'), h('span', { class: 'menu-sub link-sub' }, u.replace(/^https?:\/\//, '')))))) : null,
      h('div', { class: 'menu' }, item.fileIds.filter((fid) => state.files[fid]).map((fid, i) => menuRow(state.files[fid].mime?.startsWith('image/') ? 'image' : 'file', item.fileIds.length > 1 ? `Original Seite ${i + 1} ansehen` : 'Original ansehen', state.files[fid].name, () => openFile(fid)))),
      h('section', { class: 'card stack' }, h('div', { class: 'label' }, 'Nachfragen'), list, h('div', { class: 'chat-input' }, input, send))));
}

// ================================================================ VOKABELN
const vocab = () => (state.vocab ||= { sets: [], tests: {} });
const vsetById = (id) => vocab().sets.find((x) => x.id === id);
const LANGS = ['Englisch', 'Spanisch', 'Französisch', 'Latein', 'Italienisch', 'Russisch'];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Alle akzeptierten Schreibweisen: "der Bahnhof; die Station" → beide, auch ohne Artikel/Klammern.
function variants(s) {
  const out = new Set();
  const parts = String(s || '').split(/[;,/]|\s+oder\s+|\s+or\s+/i).map((x) => x.trim()).filter(Boolean);
  for (const p of [String(s || '').trim(), ...parts]) {
    if (!p) continue;
    out.add(p);
    out.add(p.replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim());
    out.add(p.replace(/[()]/g, ''));
    out.add(p.replace(/^(to|the|a|an|der|die|das|ein|eine|el|la|los|las|un|una|le|les|l'|une|il|lo|gli)\s+/i, '').trim());
  }
  return [...out].filter(Boolean);
}

function vocabStats(set) {
  const total = set.words.length;
  const sure = set.words.filter((w) => (w.box || 0) >= 3).length;
  const wrong = set.words.filter((w) => (w.wrong || 0) > 0 && (w.box || 0) < 3).length;
  return { total, sure, wrong, pct: total ? Math.round((sure / total) * 100) : 0 };
}

function todaysEntry(set) {
  const today = isoDate(new Date());
  return (set.plan || []).find((e) => !e.done && e.iso <= today) || (set.plan || []).find((e) => !e.done) || null;
}

// Schnelles Quiz ohne KI: Eintippen (beide Richtungen) und Multiple Choice.
function makeVocabQuiz(set, words) {
  const all = set.words;
  return shuffle(words).map((w) => {
    const toForeign = Math.random() < 0.6;
    const useMc = all.length >= 4 && Math.random() < 0.35;
    const prompt = toForeign ? `Übersetze ins ${set.sprache}: „${w.t}“` : `Was heißt „${w.w}“?`;
    const expl = [w.ex ? `Beispiel: ${w.ex}` : '', w.info || ''].filter(Boolean).join(' · ');
    if (useMc) {
      const others = shuffle(all.filter((x) => x.id !== w.id)).slice(0, 3);
      const opts = shuffle([w, ...others]);
      return { wid: w.id, typ: 'mc', frage: prompt, optionen: opts.map((x) => (toForeign ? x.w : x.t)), richtig: opts.findIndex((x) => x.id === w.id), erklaerung: expl };
    }
    return { wid: w.id, typ: 'eingabe', frage: prompt, antworten: variants(toForeign ? w.w : w.t), loesung: toForeign ? w.w : w.t, erklaerung: expl };
  });
}

// Ergebnis in die Lernkartei übernehmen (Box 0–5): richtig = eine Box höher, falsch = zurück auf 0.
function applyVocabResults(set, sess) {
  if (sess.applied) return;
  sess.fragen.forEach((q, i) => {
    const w = set.words.find((x) => x.id === q.wid);
    if (!w) return;
    const ok = !!sess.antworten[i]?.correct;
    w.box = ok ? Math.min(5, (w.box || 0) + 1) : 0;
    if (ok) w.right = (w.right || 0) + 1; else w.wrong = (w.wrong || 0) + 1;
  });
  sess.applied = true;
  save();
}

function viewVocab() {
  const v = vocab();
  const screen = h('div', { class: 'screen with-tabs' },
    h('header', { class: 'topbar' }, h('span', { class: 'iconbtn-spacer' }), h('div', { class: 'topbar-title' }, 'Vokabeln'), h('button', { class: 'iconbtn', 'aria-label': 'Neue Vokabeln', onclick: () => startVocabNew() }, icon('plus'))));
  if (!v.sets.length) {
    add(screen, h('main', { class: 'content narrow center' },
      mascot(130),
      h('h1', { class: 'display' }, 'Vokabeln lernen'),
      h('p', { class: 'muted' }, 'Fotografiere eine Vokabelseite – ich lese sie aus, mache dir ein Quiz und einen Lernplan bis zum Test.'),
      h('button', { class: 'btn primary', onclick: () => startVocabNew() }, icon('camera', 18), 'Vokabelseite hochladen'),
      h('button', { class: 'link-small', onclick: () => pickTestLanguage() }, 'Alte Vokabeltests hochladen')), tabbar('vocab'));
    return screen;
  }
  const sets = [...v.sets].sort((a, b) => (a.testDate || '9999').localeCompare(b.testDate || '9999'));
  add(screen, h('main', { class: 'content narrow' },
    h('div', { class: 'menu' }, sets.map((set) => {
      const st = vocabStats(set);
      return h('button', { class: 'menu-row', onclick: () => go('vset', { id: set.id }) },
        h('span', { class: 'menu-ico' }, icon('languages', 20)),
        h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, set.titel), h('span', { class: 'menu-sub' }, set.building ? 'Jelly liest die Seiten …' : `${set.sprache} · ${st.total} Vokabeln · ${st.pct} % sicher${set.testDate ? ` · Test ${relDay(set.testDate).toLowerCase()}` : ''}`)),
        progressRing(st.pct, 40));
    })),
    h('button', { class: 'btn primary block', onclick: () => startVocabNew() }, icon('camera', 18), 'Neue Vokabelseite'),
    h('div', { class: 'menu' }, menuRow('layers', 'Alte Vokabeltests', 'Damit sich die Probe-Tests an deiner Lehrkraft orientieren', () => pickTestLanguage()))),
    tabbar('vocab'));
  return screen;
}

function pickTestLanguage() {
  const langs = [...new Set([...vocab().sets.map((x) => x.sprache), ...Object.keys(vocab().tests), ...LANGS])];
  const o = sheet('Welche Sprache?', [h('div', { class: 'menu' }, langs.map((l) => menuRow('languages', l, `${vocab().tests[l]?.fileIds?.length || 0} Tests`, () => { o.remove(); go('vtests', { sprache: l }); })))]);
}

// ---------- Neue Vokabelliste
let nv = null;
function startVocabNew(addTo = null) {
  nv = { fileIds: [], testDate: '', addTo };
  go('vnew');
}

function viewVocabNew() {
  if (!nv) { startVocabNew(); return h('div'); }
  const cancel = async () => { for (const id of nv.fileIds) await removeFile(id); nv = null; go('vocab'); };
  if (nv.processing) { startVocabBuild(); return h('div'); }
  const grid = h('div', { class: 'grid3' });
  const draw = async () => {
    const tiles = [];
    for (const id of nv.fileIds) {
      const url = await thumbURL(id);
      tiles.push(h('div', { class: 'tile filled' }, url ? h('img', { src: url, onclick: () => openFile(id) }) : h('div', { class: 'tile-file', onclick: () => openFile(id) }, icon('file', 30), h('span', {}, state.files[id]?.name || '')),
        h('button', { class: 'tile-del', onclick: async () => { nv.fileIds = nv.fileIds.filter((x) => x !== id); await removeFile(id); draw(); } }, icon('close', 16))));
    }
    const addTile = (label, opts) => h('button', { class: 'tile', onclick: async () => {
      for (const f of await pickFiles(opts)) { try { nv.fileIds.push(await addFile(f, { kind: 'vocab', subjectId: null })); } catch (e) { toast(errorMsg(e), 'error'); } }
      draw();
    } }, icon(opts.capture ? 'camera' : 'plus', 28), h('span', { class: 'small muted' }, label));
    tiles.push(addTile('Foto aufnehmen', { accept: 'image/*', capture: 'environment', multiple: false }), addTile('Fotos / PDF', {}));
    grid.replaceChildren(...tiles);
  };
  draw();
  const existing = nv.addTo ? vsetById(nv.addTo) : null;
  return h('div', { class: 'screen' }, topbar({ back: cancel, title: existing ? 'Seiten hinzufügen' : 'Neue Vokabeln' }),
    h('main', { class: 'content narrow' },
      speech(existing ? `Welche Seiten sollen zu „${existing.titel}“ dazu?` : 'Lade deine Vokabelseite hoch – ich lese alles aus.'),
      grid,
      existing ? null : h('div', { class: 'stack' },
        h('div', { class: 'label' }, 'Wann ist der Vokabeltest? (optional)'),
        h('input', { class: 'input', type: 'date', min: isoDate(new Date()), value: nv.testDate, onchange: (e) => { nv.testDate = e.target.value; } }))),
    h('footer', { class: 'footer' }, h('button', { class: 'btn primary block', onclick: () => {
      if (!aiReady()) return toast('Bitte zuerst die KI einrichten (Mehr → KI-Verbindung).', 'error');
      if (!nv.fileIds.length) return toast('Bitte mindestens ein Foto oder PDF hinzufügen.');
      nv.processing = true; render();
    } }, 'Vokabeln auslesen')));
}

function startVocabBuild() {
  let set = nv.addTo ? vsetById(nv.addTo) : null;
  if (set) {
    set.pendingFiles = [...(set.pendingFiles || []), ...nv.fileIds];
  } else {
    set = { id: uid(), titel: 'Neue Vokabeln', sprache: '', words: [], fileIds: [], pendingFiles: [...nv.fileIds], testDate: nv.testDate || null, createdAt: Date.now(), sess: {} };
    vocab().sets.push(set);
  }
  set.building = true;
  save();
  nv = null;
  queueJob({ key: `v_${set.id}`, type: 'vocab', id: set.id });
  go('vset', { id: set.id });
}

// ---------- Eine Vokabelliste
function startVocabQuiz(set, mode, entryIdx = null) {
  set.sess ||= {};
  let words;
  if (mode === 'heute') {
    const e = entryIdx !== null ? set.plan[entryIdx] : todaysEntry(set);
    if (!e) return toast('Kein offener Lerntag – mach ein Schnell-Quiz.');
    const ids = [...new Set([...e.neu, ...e.wdh])];
    words = set.words.filter((w) => ids.includes(w.id)).slice(0, 40);
    set.sess.heute = { fragen: makeVocabQuiz(set, words), antworten: {}, idx: 0, entry: set.plan.indexOf(e) };
  } else if (mode === 'fehler') {
    words = set.words.filter((w) => (w.wrong || 0) > 0 && (w.box || 0) < 3);
    if (!words.length) return toast('Keine Fehler-Vokabeln – stark!');
    set.sess.fehler = { fragen: makeVocabQuiz(set, words.slice(0, 30)), antworten: {}, idx: 0 };
  } else if (mode === 'schnell') {
    words = [...set.words].sort((a, b) => (a.box || 0) - (b.box || 0) || Math.random() - 0.5).slice(0, 15);
    set.sess.schnell = { fragen: makeVocabQuiz(set, words), antworten: {}, idx: 0 };
  } else if (mode === 'test') {
    delete set.sess.test;
  }
  save();
  go('vquiz', { id: set.id, mode });
}

function viewVocabSet({ id }) {
  const set = vsetById(id);
  if (!set) { go('vocab'); return h('div'); }
  if (set.building) {
    const main = h('main', { class: 'content narrow' });
    pending(main, `v:${set.id}`, 'Ich lese deine Vokabeln …', ['Seiten lesen', 'Lernplan erstellen'], async () => {
      const n = await buildVocabSet(set);
      toast(`${n} Vokabeln erkannt – prüf die Liste kurz auf Lesefehler.`, 'ok');
    });
    return h('div', { class: 'screen' }, topbar({ back: () => go('vocab'), title: set.titel }), main);
  }
  const st = vocabStats(set);
  const entry = todaysEntry(set);
  let countdown = 'Kein Testdatum';
  if (set.testDate) {
    const diff = Math.round((parseISO(set.testDate) - parseISO(isoDate(new Date()))) / 86400000);
    countdown = diff > 1 ? `Test in ${diff} Tagen` : diff === 1 ? 'Test ist morgen' : diff === 0 ? 'Test ist heute' : 'Test vorbei';
  }
  const entryWords = entry ? new Set([...entry.neu, ...entry.wdh]).size : 0;
  const tile = (ic, name, sub, onclick, cls = '') => h('button', { class: `tile-btn ${cls}`, onclick }, h('span', { class: 'tile-ico' }, icon(ic, 22)), h('span', { class: 'tile-name' }, name), h('span', { class: 'tile-sub' }, sub));
  const profile = vocab().tests[set.sprache]?.profil;
  return h('div', { class: 'screen' },
    topbar({ back: () => go('vocab'), title: '' }),
    h('main', { class: 'content narrow' },
      h('section', { class: 'hero' },
        h('div', { class: 'hero-top' },
          h('div', { class: 'hero-left' }, h('div', { class: 'hero-count' }, set.titel), h('div', { class: 'muted small' }, `${set.sprache} · ${st.total} Vokabeln · ${countdown}`)),
          progressRing(st.pct, 64)),
        entry ? h('button', { class: 'btn primary block next-btn', onclick: () => startVocabQuiz(set, 'heute') },
          h('span', { class: 'next-title' }, `${entry.iso === isoDate(new Date()) ? 'Heute lernen' : `Lerntag ${fmtDate(entry.iso)}`} · ${entryWords} Vokabeln`), icon('play', 18))
          : h('div', { class: 'all-done' }, 'Lernplan geschafft – mach den Probe-Test!')),
      h('div', { class: 'vtiles' },
        tile('zap', 'Schnell-Quiz', '15 Vokabeln, sofort', () => startVocabQuiz(set, 'schnell')),
        tile('grad', 'Probe-Test', profile ? 'Im Stil deiner Lehrkraft' : 'Wie ein echter Test', () => startVocabQuiz(set, 'test'), 'final'),
        tile('calendar', 'Lernplan', `${(set.plan || []).filter((e) => e.done).length}/${(set.plan || []).length} Tage`, () => go('vplan', { id })),
        tile('list', 'Vokabelliste', `${st.total} Wörter · ${st.sure} sicher`, () => go('vwords', { id })),
        st.wrong ? tile('refresh', 'Fehler üben', `${st.wrong} Vokabeln`, () => startVocabQuiz(set, 'fehler')) : null),
      h('div', { class: 'menu' },
        menuRow('layers', 'Alte Vokabeltests', profile ? `Testprofil für ${set.sprache} vorhanden` : `Für ${set.sprache} hochladen`, () => go('vtests', { sprache: set.sprache })),
        menuRow('more', 'Einstellungen', 'Name, Sprache, Testdatum, Seiten, Löschen', () => vocabSetMenu(set)))));
}

function vocabSetMenu(set) {
  const name = h('input', { class: 'input', value: set.titel });
  const lang = h('select', { class: 'input' }, [...new Set([set.sprache, ...LANGS])].map((l) => h('option', { value: l, selected: l === set.sprache }, l)));
  const date = h('input', { class: 'input', type: 'date', value: set.testDate || '' });
  const o = sheet('Einstellungen', [
    h('div', { class: 'label' }, 'Name'), name,
    h('div', { class: 'label' }, 'Sprache'), lang,
    h('div', { class: 'label' }, 'Testdatum'), date,
    (set.fileIds || []).length ? h('div', { class: 'menu' }, set.fileIds.map((fid, i) => menuRow('image', `Seite ${i + 1} ansehen`, state.files[fid]?.name || '', () => openFile(fid)))) : null,
    h('button', { class: 'btn primary block', onclick: () => {
      const dateChanged = (date.value || null) !== (set.testDate || null);
      set.titel = name.value.trim() || set.titel; set.sprache = lang.value; set.testDate = date.value || null;
      if (dateChanged) buildVocabPlan(set);
      save(); o.remove(); render();
    } }, 'Speichern'),
    h('div', { class: 'menu' },
      menuRow('plus', 'Weitere Seiten hinzufügen', null, () => { o.remove(); startVocabNew(set.id); }),
      menuRow('calendar', 'Lernplan neu erstellen', 'Ab heute bis zum Testdatum', () => { buildVocabPlan(set); save(); o.remove(); toast('Lernplan neu erstellt.', 'ok'); render(); }),
      menuRow('trash', 'Vokabelliste löschen', null, async () => {
        o.remove();
        if (!(await confirmDialog(`„${set.titel}“ samt Fortschritt löschen?`, 'Löschen'))) return;
        for (const fid of set.fileIds || []) await removeFile(fid);
        vocab().sets = vocab().sets.filter((x) => x.id !== set.id); save(); go('vocab');
      }, 'danger')),
  ]);
}

function viewVocabWords({ id }) {
  const set = vsetById(id);
  if (!set) { go('vocab'); return h('div'); }
  const edit = (w) => {
    const isNew = !w;
    w ||= { id: uid(), w: '', t: '', ex: '', box: 0 };
    const iw = h('input', { class: 'input', value: w.w, placeholder: set.sprache, autocapitalize: 'off' });
    const it = h('input', { class: 'input', value: w.t, placeholder: 'Deutsch (mehrere mit ; trennen)' });
    const ie = h('input', { class: 'input', value: w.ex || '', placeholder: 'Beispielsatz (optional)' });
    const o = sheet(isNew ? 'Vokabel hinzufügen' : 'Vokabel bearbeiten', [
      h('div', { class: 'label' }, set.sprache), iw, h('div', { class: 'label' }, 'Deutsch'), it, h('div', { class: 'label' }, 'Beispiel'), ie,
      h('button', { class: 'btn primary block', onclick: () => {
        if (!iw.value.trim() || !it.value.trim()) return toast('Bitte beide Seiten ausfüllen.');
        Object.assign(w, { w: iw.value.trim(), t: it.value.trim(), ex: ie.value.trim() });
        if (isNew) { set.words.push(w); buildVocabPlan(set); }
        save(); o.remove(); render();
      } }, 'Speichern'),
      isNew ? null : h('button', { class: 'btn ghost block danger-text', onclick: () => { set.words = set.words.filter((x) => x.id !== w.id); buildVocabPlan(set); save(); o.remove(); render(); } }, 'Löschen')]);
  };
  return h('div', { class: 'screen' },
    topbar({ back: () => go('vset', { id }), title: 'Vokabelliste' }),
    h('main', { class: 'content narrow' },
      h('p', { class: 'muted small center' }, 'Antippen zum Korrigieren. Die Punkte zeigen, wie sicher du die Vokabel kannst.'),
      h('div', { class: 'menu' }, set.words.map((w) => h('button', { class: 'menu-row vword', onclick: () => edit(w) },
        h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, w.w), h('span', { class: 'menu-sub' }, w.t)),
        h('span', { class: 'boxdots' }, [1, 2, 3, 4, 5].map((n) => h('i', { class: (w.box || 0) >= n ? 'on' : '' }))))))),
    h('footer', { class: 'footer' }, h('button', { class: 'btn primary block', onclick: () => edit(null) }, icon('plus', 18), 'Vokabel hinzufügen')));
}

function viewVocabPlan({ id }) {
  const set = vsetById(id);
  if (!set) { go('vocab'); return h('div'); }
  const today = isoDate(new Date());
  return h('div', { class: 'screen' },
    topbar({ back: () => go('vset', { id }), title: 'Lernplan' }),
    h('main', { class: 'content narrow' },
      h('p', { class: 'muted small center' }, 'Jeden Tag ein paar neue Vokabeln plus Wiederholung der letzten Tage. Am letzten Tag: alles wiederholen und Probe-Test.'),
      h('div', { class: 'pick-list' }, (set.plan || []).map((e, i) => h('div', { class: `pick-row ${e.done ? 'st-done' : ''} ${e.iso === today ? 'is-current' : ''}` },
        h('button', { class: 'pick-main', onclick: () => startVocabQuiz(set, 'heute', i) },
          h('span', { class: 'topic-num' }, e.done ? icon('check', 16) : String(i + 1)),
          h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, `${relDay(e.iso)} · ${fmtDate(e.iso)}`),
            h('span', { class: 'menu-sub' }, [e.neu.length ? `${e.neu.length} neue` : '', e.wdh.length ? `${e.wdh.length} wiederholen` : '', e.probe ? 'Probe-Test' : ''].filter(Boolean).join(' · ') || 'frei')),
          e.iso === today && !e.done ? h('span', { class: 'now' }, 'Heute') : icon('chev', 18))))),
      h('button', { class: 'link-small', onclick: () => { buildVocabPlan(set); save(); render(); } }, icon('refresh', 16), 'Plan ab heute neu verteilen')));
}

function viewVocabQuiz({ id, mode }) {
  const set = vsetById(id);
  if (!set) { go('vocab'); return h('div'); }
  const titles = { heute: 'Heute lernen', schnell: 'Schnell-Quiz', fehler: 'Fehler üben', test: 'Probe-Test' };
  const main = h('main', { class: 'content narrow' });
  const screen = h('div', { class: 'screen' }, topbar({ back: () => go('vset', { id }), title: titles[mode] }), main);
  set.sess ||= {};
  let sess = set.sess[mode];
  if (!sess?.fragen) {
    if (mode !== 'test') { go('vset', { id }); return h('div'); }
    pending(main, `vtest:${id}`, 'Ich baue dir einen Probe-Vokabeltest …', ['Testprofil lesen', 'Aufgaben erstellen'], async () => {
      const words = shuffle(set.words).slice(0, 25);
      const res = await generate({ system: P.vocabSystem(), parts: [{ text: P.vocabTestPrompt(set, words, vocab().tests[set.sprache]?.profil) }], json: true, temperature: 0.5 });
      const fragen = (res.fragen || []).filter((q) => q?.frage && ['mc', 'wahrfalsch', 'eingabe'].includes(q.typ) && (q.typ !== 'mc' || (Array.isArray(q.optionen) && Number.isInteger(q.richtig))))
        .map((q) => (q.typ === 'eingabe' ? { ...q, antworten: [...new Set((q.antworten || []).flatMap(variants))] } : q));
      if (!fragen.length) throw new AIError('Keine brauchbaren Testaufgaben erhalten. Bitte nochmal versuchen.');
      fragen.forEach(mixOptions);
      // Zuordnung zu Vokabeln (für die Lernkartei), soweit erkennbar
      for (const q of fragen) {
        const hay = normAnswer(`${q.frage} ${(q.antworten || []).join(' ')} ${(q.optionen || [])[q.richtig] || ''}`);
        q.wid = words.find((w) => hay.includes(normAnswer(w.w).slice(0, 12)) || hay.includes(normAnswer(w.t.split(';')[0]).slice(0, 12)))?.id;
      }
      set.sess.test = { fragen, antworten: {}, idx: 0 };
    });
    return screen;
  }
  runQuiz(main, sess, {
    strict: true,
    verdict: (pct) => {
      applyVocabResults(set, sess);
      if (mode === 'heute' && sess.entry !== undefined && set.plan?.[sess.entry]) { set.plan[sess.entry].done = true; save(); }
      const grade = mode === 'test' ? ` Das wäre etwa ${gradeLabel(percentToGrade(pct))} (Schätzung).` : '';
      return (pct >= 90 ? 'Sehr sicher.' : pct >= 70 ? 'Gut – die Fehler kommen in „Fehler üben“.' : 'Noch unsicher. Wiederhole die Fehler und mach das Quiz morgen nochmal.') + grade;
    },
    actions: () => [
      h('button', { class: 'btn primary block', onclick: () => go('vset', { id }) }, 'Fertig'),
      h('div', { class: 'row gap wrap center' },
        mode !== 'test' ? h('button', { class: 'btn ghost', onclick: () => startVocabQuiz(set, mode === 'heute' ? 'fehler' : mode) }, icon('refresh', 18), mode === 'heute' ? 'Fehler üben' : 'Nochmal') : h('button', { class: 'btn ghost', onclick: () => startVocabQuiz(set, 'test') }, icon('refresh', 18), 'Neuer Probe-Test')),
    ],
  });
  return screen;
}

function viewVocabTests({ sprache }) {
  const t = (vocab().tests[sprache] ||= { fileIds: [], profil: '' });
  const list = h('div', { class: 'menu' });
  const profileBox = h('div', { class: 'stack' });
  const drawList = () => {
    const leads = t.fileIds.filter((fid) => state.files[fid] && isGroupLead(fid));
    list.replaceChildren(...leads.map((fid, i) => h('div', { class: 'menu-row' },
      h('span', { class: 'menu-ico' }, icon('file', 20)), h('button', { class: 'menu-text file-open', onclick: () => openFile(fid) }, h('span', { class: 'menu-label' }, `Test ${i + 1}`), h('span', { class: 'menu-sub' }, `${pagesLabel(fid)} · antippen zum Öffnen`)),
      h('button', { class: 'iconbtn small', 'aria-label': 'Seite hinzufügen', title: 'Seite hinzufügen', onclick: async () => {
        const files = await pickFiles({ accept: 'image/*,application/pdf,.pdf' });
        if (!files.length) return;
        const added = await uploadPages(files, { kind: 'vtest', into: fid });
        t.fileIds.push(...added); save(); drawList(); if (added.length) build();
      } }, icon('plus', 18)),
      h('button', { class: 'iconbtn small', 'aria-label': 'Löschen', onclick: async () => {
        if (!(await confirmDialog(`Test ${i + 1} (${pagesLabel(fid)}) löschen?`, 'Löschen'))) return;
        const ids = groupOf(fid); t.fileIds = t.fileIds.filter((x) => !ids.includes(x)); await removeGroup(fid); save(); drawList();
      } }, icon('trash', 18)))));
    if (!t.fileIds.length) add(list, h('div', { class: 'menu-row' }, h('span', { class: 'muted small' }, 'Noch keine alten Tests.')));
  };
  const drawProfile = () => profileBox.replaceChildren(
    t.building && !ui.busy[`vt:${sprache}`] ? h('p', { class: 'muted small' }, backgroundAvailable() ? 'Jelly arbeitet im Hintergrund am Testprofil.' : 'Das Testprofil ist noch nicht fertig.') : null,
    t.profil ? mdEl(t.profil) : h('p', { class: 'muted small' }, 'Wird erstellt, sobald du Tests hochlädst. Danach sehen die Probe-Tests aus wie die deiner Lehrkraft, und das Lehrerprofil des passenden Fachs übernimmt sie.'));
  const build = async () => {
    if (!t.fileIds.length) return;
    if (!aiReady()) return toast('Bitte zuerst die KI einrichten.', 'error');
    const key = `vt:${sprache}`;
    if (ui.busy[key]) return;
    t.building = true; save();
    queueJob({ key: `t_${sprache}`, type: 'vtest', id: sprache });
    ui.busy[key] = true;
    profileBox.replaceChildren(h('p', { class: 'muted' }, 'Ich analysiere die Tests …'), backgroundAvailable() ? h('p', { class: 'muted small' }, 'Du kannst die App schließen, Jelly macht im Hintergrund weiter.') : null);
    try {
      const subject = await buildVocabTestProfile(sprache);
      save();
      toast(subject ? `Testprofil erstellt und ins Lehrerprofil von ${subject.name} übernommen.` : 'Testprofil erstellt.', 'ok');
    } catch (e) { toast(errorMsg(e), 'error'); }
    delete ui.busy[key];
    drawProfile();
  };
  drawList(); drawProfile();
  return h('div', { class: 'screen' },
    topbar({ back: () => go('vocab'), title: `Vokabeltests ${sprache}` }),
    h('main', { class: 'content narrow' },
      h('p', { class: 'muted small center' }, 'Am besten korrigierte Tests. Ich schaue mir Aufgabentypen, Richtung und Strenge (Rechtschreibung, Artikel, Akzente) an.'),
      list,
      h('button', { class: 'btn primary block', onclick: async () => {
        const files = await pickFiles();
        if (!files.length) return;
        const together = await askTogether(files.length, 'einem Test', 'Einzelne Tests');
        const added = await uploadPages(files, { kind: 'vtest', together });
        t.fileIds.push(...added); save(); drawList(); if (added.length) build();
      } }, icon('upload', 18), 'Tests hochladen'),
      h('section', { class: 'card stack' }, h('h3', {}, 'Testprofil'), profileBox,
        t.fileIds.length ? h('button', { class: 'btn small ghost', onclick: build }, icon('refresh', 16), 'Neu analysieren') : null)));
}

// ================================================================ WOCHE: STUNDENPLAN & KLASSENARBEITEN
const DEFAULT_SLOTS = [['08:00', '08:45'], ['08:50', '09:35'], ['09:55', '10:40'], ['10:45', '11:30'], ['11:50', '12:35'], ['12:40', '13:25'], ['13:35', '14:20'], ['14:25', '15:10'], ['15:15', '16:00'], ['16:05', '16:50']]
  .map(([von, bis], i) => ({ n: i + 1, von, bis }));
const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr'];
const DAY_NAMES = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'];
const EXAM_KINDS = ['Klassenarbeit', 'Klausur', 'Test', 'Vokabeltest', 'Referat', 'Sonstiges'];

const tt = () => (state.timetable ||= { slots: DEFAULT_SLOTS.map((x) => ({ ...x })), lessons: [], fileIds: [], ab: false, abRef: null });
const xp = () => (state.examPlan ||= { items: [], fileIds: [] });

// Fach aus Text (Plan, KI) einem angelegten Fach zuordnen
function matchSubject(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  return state.subjects.find((s) => s.name.toLowerCase() === n || (s.short || '').toLowerCase() === n)
    || state.subjects.find((s) => n.length >= 3 && (s.name.toLowerCase().startsWith(n) || n.startsWith(s.name.toLowerCase())))
    || null;
}
const lessonName = (l) => subjectById(l.subjectId)?.name || l.fach || 'Fach';
const itemName = (it) => subjectById(it.subjectId)?.name || it.fach || 'Fach';
const slotOf = (n) => tt().slots.find((x) => x.n === n);

const mondayOf = (d) => { const x = parseISO(isoDate(d)); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); return x; };
// A- oder B-Woche für ein Datum (abRef = Montag einer A-Woche)
function abWeek(d = new Date()) {
  const t = tt();
  if (!t.ab || !t.abRef) return null;
  const weeks = Math.round((mondayOf(d) - parseISO(t.abRef)) / (7 * 86400000));
  return ((weeks % 2) + 2) % 2 === 0 ? 'A' : 'B';
}
const lessonsOn = (day, week) => tt().lessons.filter((l) => l.day === day && (!tt().ab || !l.week || !week || l.week === week)).sort((a, b) => a.slot - b.slot);
const knownTeachers = () => [...new Set([...tt().lessons.map((l) => l.teacher), ...state.subjects.map((s) => s.teacher)].filter(Boolean))].sort();
const knownRooms = () => [...new Set(tt().lessons.map((l) => l.room).filter(Boolean))].sort();
const datalist = (id, values) => h('datalist', { id }, values.map((v) => h('option', { value: v })));

function daysUntil(iso) { return Math.round((parseISO(iso) - parseISO(isoDate(new Date()))) / 86400000); }
const untilLabel = (iso) => { const d = daysUntil(iso); return d === 0 ? 'heute' : d === 1 ? 'morgen' : d > 1 ? `in ${d} Tagen` : d === -1 ? 'gestern' : `vor ${-d} Tagen`; };

// Alle Arbeiten: Einträge aus dem Klassenarbeitsplan + Klausuren mit Datum, die (noch) keinem Eintrag zugeordnet sind
// Ein Lernplan (Klausur) gehört zu einem Termin im Arbeitsplan, wenn Fach und Datum passen.
function linkExamsToPlan() {
  let changed = false;
  for (const e of state.exams) {
    if (!e.date || xp().items.some((it) => it.examId === e.id)) continue;
    const free = xp().items.filter((it) => !it.examId && it.subjectId === e.subjectId);
    const same = free.filter((it) => it.date === e.date);
    const near = free.filter((it) => Math.abs((parseISO(it.date) - parseISO(e.date)) / 86400000) <= 3);
    const hit = same[0] || (near.length === 1 ? near[0] : null);
    if (hit) { hit.examId = e.id; if (hit.date !== e.date) e.date = hit.date; changed = true; }
  }
  if (changed) save();
}

function allExamDates() {
  linkExamsToPlan();
  const items = xp().items.map((it) => ({ ...it, src: 'plan' }));
  const linked = new Set(items.map((it) => it.examId).filter(Boolean));
  for (const e of state.exams) if (e.date && !linked.has(e.id)) items.push({ id: `e:${e.id}`, date: e.date, subjectId: e.subjectId, art: 'Klausur', thema: e.plan?.titel || '', examId: e.id, src: 'exam' });
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

const TILE_COLORS = ['#8b5cf6', '#a78bfa', '#f0abfc', '#f472b6', '#f87171', '#fdba74', '#fcd34d', '#86efac', '#5eead4', '#7dd3fc', '#93c5fd', '#94a3b8'];
const lessonColor = (l) => l.color || subjectById(l.subjectId)?.color || '#8b5cf6';
const lessonShort = (l) => l.label || subjectById(l.subjectId)?.short || (l.fach || 'Fach').slice(0, 5);

// Doppelstunden-Modus: eine Kachel = zwei Stunden (1–2, 3–4 …). Gespeichert wird weiterhin je Stunde.
const blockMode = () => tt().blocks !== false;
function ttRows() {
  const s = tt().slots;
  if (!blockMode()) return s.map((a) => ({ a, b: null, slots: [a.n] }));
  // Eine Stunde mit single: true bleibt einzeln (z. B. die 7. Stunde), sonst wird sie mit der nächsten zusammengefasst
  const rows = [];
  for (let i = 0; i < s.length;) {
    if (!s[i].single && s[i + 1]) { rows.push({ a: s[i], b: s[i + 1], slots: [s[i].n, s[i + 1].n] }); i += 2; }
    else { rows.push({ a: s[i], b: null, slots: [s[i].n] }); i += 1; }
  }
  return rows;
}

function viewWeek() {
  const t = tt();
  const today = new Date();
  const todayIdx = (today.getDay() + 6) % 7;
  const nowWeek = abWeek(today);
  const showWeek = t.ab ? (ui.weekAB || nowWeek || 'A') : null;
  const now = `${String(today.getHours()).padStart(2, '0')}:${String(today.getMinutes()).padStart(2, '0')}`;
  const isThisWeek = !t.ab || showWeek === nowWeek;

  const grid = h('div', { class: `tt-grid ${blockMode() ? 'blocks' : ''}` },
    h('div', { class: 'tt-corner' }),
    DAYS.map((d, i) => h('div', { class: `tt-day ${i === todayIdx && isThisWeek ? 'today' : ''}` }, d)));
  for (const row of ttRows()) {
    const von = row.a.von, bis = (row.b || row.a).bis;
    add(grid, h('button', { class: 'tt-time', 'aria-label': `Zeiten der ${row.slots.join('.–')}. Stunde`, onclick: () => editSlot(row) },
      h('strong', {}, row.slots.join('–')), h('span', {}, von || '–'), h('span', { class: 'tt-bis' }, bis || '')));
    for (let d = 1; d <= 5; d++) {
      const all = lessonsOn(d, showWeek).filter((l) => row.slots.includes(l.slot));
      const here = all.filter((l) => l.slot === row.slots[0]).length ? all.filter((l) => l.slot === row.slots[0]) : all;
      if (!here.length) { add(grid, h('button', { class: 'tt-cell empty', 'aria-label': `${DAY_NAMES[d - 1]}, ${row.slots.join('.–')}. Stunde eintragen`, onclick: () => editLesson(null, d, row.slots[0]) }, icon('plus', 16))); continue; }
      if (here.length > 1) { // mehrere Kurse zur Wahl (aus einem hochgeladenen Plan)
        add(grid, h('button', { class: 'tt-cell choice', onclick: () => chooseCourse(here) }, h('span', { class: 'tt-sub' }, 'Wählen'), h('span', { class: 'tt-meta' }, `${here.length} Kurse`)));
        continue;
      }
      const l = here[0];
      const live = d - 1 === todayIdx && isThisWeek && von && bis && von <= now && now <= bis;
      add(grid, h('button', { class: `tt-cell ${live ? 'live' : ''}`, style: { '--c': lessonColor(l) }, onclick: () => editLesson(l) },
        h('span', { class: 'tt-sub short' }, lessonShort(l)), h('span', { class: 'tt-sub long' }, l.label || lessonName(l)),
        l.teacher ? h('span', { class: 'tt-meta' }, l.teacher) : null,
        l.room ? h('span', { class: 'tt-room' }, l.room) : null));
    }
  }
  const choices = new Set(t.lessons.map((l) => `${l.day}-${l.slot}-${l.week || ''}`).filter((k, i, a) => a.indexOf(k) !== i)).size;
  const step = blockMode() ? 2 : 1;
  const main = h('main', { class: 'content wide-tt' },
    t.ab ? h('div', { class: 'row gap center' }, ['A', 'B'].map((w) => h('button', { class: `pill ${showWeek === w ? 'active' : ''}`, onclick: () => { ui.weekAB = w; render(); } }, `${w}-Woche${nowWeek === w ? ' (jetzt)' : ''}`))) : null,
    choices ? h('p', { class: 'muted small center' }, `In ${choices} Stunden stehen mehrere Kurse – tippe auf „Wählen“ und such deinen aus.`) : null,
    h('div', { class: 'tt-wrap' }, grid),
    h('div', { class: 'row gap center tt-rows' },
      h('button', { class: 'btn small ghost', onclick: () => {
        for (let k = 0; k < step; k++) { const last = t.slots.at(-1); t.slots.push({ n: (last?.n || 0) + 1, von: last?.bis || '', bis: '' }); }
        save(); render();
      } }, icon('plus', 16), blockMode() ? 'Doppelstunde' : 'Stunde'),
      t.slots.length > step ? h('button', { class: 'btn small ghost', onclick: async () => {
        const gone = t.slots.slice(-step).map((x) => x.n);
        if (t.lessons.some((l) => gone.includes(l.slot)) && !(await confirmDialog(`In der letzten ${blockMode() ? 'Doppelstunde' : 'Stunde'} ist etwas eingetragen. Trotzdem entfernen?`, 'Entfernen'))) return;
        t.lessons = t.lessons.filter((l) => !gone.includes(l.slot)); t.slots.splice(-step); save(); render();
      } }, icon('minus', 16), blockMode() ? 'Doppelstunde' : 'Stunde') : null),
    t.lessons.length ? null : h('button', { class: 'btn block', onclick: () => uploadPlan('tt') }, icon('upload', 18), 'Oder Foto/PDF deines Plans hochladen'));
  const next = allExamDates().filter((x) => daysUntil(x.date) >= 0).slice(0, 2);
  if (next.length) add(main, h('div', { class: 'label' }, 'Nächste Prüfungen'), h('div', { class: 'menu' }, next.map((x) => examRow(x))));
  return h('div', { class: 'screen with-tabs' },
    h('header', { class: 'topbar' }, topLeft('week'), h('div', { class: 'topbar-title' }, 'Stundenplan'),
      h('button', { class: 'iconbtn', 'aria-label': 'Menü', onclick: () => timetableMenu() }, icon('more'))),
    main, tabbar('week'));
}

function timetableMenu() {
  const t = tt();
  const file = t.fileIds.find((id) => state.files[id]);
  const o = sheet('Stundenplan', [h('div', { class: 'menu' },
    menuRow('layers', 'Doppelstunden', blockMode() ? 'An – eine Kachel = zwei Stunden' : 'Aus – jede Stunde einzeln', () => { t.blocks = !blockMode(); save(); o.remove(); render(); }),
    menuRow('calendar', 'Kalender', 'Prüfungen, Stunden und eigene Termine', () => { o.remove(); openCalendar('week'); }),
    menuRow('upload', file ? 'Neuen Plan hochladen' : 'Plan hochladen (Foto/PDF)', t.lessons.length ? 'Ersetzt die eingetragenen Stunden' : 'Jelly trägt alles ein', () => { o.remove(); uploadPlan('tt'); }),
    file ? menuRow('image', 'Hochgeladenen Plan ansehen', null, () => { o.remove(); openFile(file); }) : null,
    file ? menuRow('refresh', 'Nochmal auslesen', 'Falls etwas falsch erkannt wurde', () => { o.remove(); go('wimport', { kind: 'tt', ids: t.fileIds.filter((id) => state.files[id]) }); }) : null,
    menuRow('shuffle', 'A-/B-Wochen', t.ab ? `An · jetzt ${abWeek() || '?'}-Woche` : 'Aus', () => { o.remove(); editAB(); }),
    t.lessons.length ? menuRow('trash', 'Alle Stunden löschen', null, async () => {
      o.remove();
      if (!(await confirmDialog('Alle eingetragenen Stunden löschen?', 'Löschen'))) return;
      for (const id of t.fileIds) await removeFile(id);
      Object.assign(t, { lessons: [], fileIds: [] }); save(); render();
    }, 'danger') : null)]);
}

// Beginn und Ende einer (Doppel-)Stunde
function editSlot(row) {
  const last = row.b || row.a;
  const von = h('input', { class: 'input', type: 'time', value: row.a.von || '' });
  const bis = h('input', { class: 'input', type: 'time', value: last.bis || '' });
  const o = sheet(row.b ? `${row.a.n}.–${row.b.n}. Stunde` : `${row.a.n}. Stunde`, [
    h('div', { class: 'row gap' }, h('div', { class: 'grow' }, h('div', { class: 'label' }, 'Beginn'), von), h('div', { class: 'grow' }, h('div', { class: 'label' }, 'Ende'), bis)),
    h('button', { class: 'btn primary block', onclick: () => { row.a.von = von.value; last.bis = bis.value; save(); o.remove(); render(); } }, 'Speichern'),
    blockMode() && row.b ? h('button', { class: 'btn block', onclick: () => { row.a.single = true; save(); o.remove(); render(); } }, `Als Einzelstunde (nur ${row.a.n}. Stunde)`) : null,
    blockMode() && !row.b && tt().slots.some((x) => x.n === row.a.n + 1) ? h('button', { class: 'btn block', onclick: () => { delete row.a.single; save(); o.remove(); render(); } }, `Mit der ${row.a.n + 1}. Stunde zur Doppelstunde verbinden`) : null,
  ]);
}

// Mehrere Kurse in einer Stunde (z. B. Wahlpflicht) – den eigenen auswählen
function chooseCourse(list) {
  const t = tt();
  const o = sheet('Welchen Kurs hast du?', [h('div', { class: 'menu' }, list.map((l) => h('button', { class: 'menu-row', onclick: () => {
    t.lessons = t.lessons.filter((x) => !(list.includes(x) && x !== l));
    // gleiche Wahl automatisch auch für die anderen Stunden dieses Kurses übernehmen
    for (const other of t.lessons.filter((x) => x !== l && x.teacher === l.teacher && lessonName(x) === lessonName(l))) {
      const rivals = t.lessons.filter((x) => x !== other && x.day === other.day && x.slot === other.slot && (x.week || '') === (other.week || ''));
      t.lessons = t.lessons.filter((x) => !rivals.includes(x));
    }
    save(); o.remove(); render();
  } }, h('span', { class: 'swatch', style: { background: lessonColor(l) } }), h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, lessonName(l)), h('span', { class: 'menu-sub' }, [l.teacher, l.room ? `Raum ${l.room}` : ''].filter(Boolean).join(' · ')))))),
  h('button', { class: 'btn ghost block danger-text', onclick: () => { t.lessons = t.lessons.filter((x) => !list.includes(x)); save(); o.remove(); render(); } }, 'Keinen – Stunde frei lassen')]);
}

function editLesson(l, day = null, slot = null) {
  const t = tt();
  const isNew = !l;
  const cur = l ? { ...l } : { id: uid(), day: day || 1, slot: slot || 1, subjectId: null, fach: '', label: '', teacher: '', room: '', color: null, week: t.ab ? (ui.weekAB || null) : null };
  const fach = h('input', { class: 'input', placeholder: 'z. B. Mathe', value: isNew ? '' : lessonName(cur), list: 'dl-subjects' });
  const label = h('input', { class: 'input', placeholder: 'z. B. M', value: cur.label || '', maxlength: 6 });
  const teacher = h('input', { class: 'input', placeholder: 'z. B. Frau Müller oder Wm', value: cur.teacher || '', list: 'dl-teachers' });
  const room = h('input', { class: 'input', placeholder: 'z. B. H7', value: cur.room || '', list: 'dl-rooms' });
  let color = cur.color || subjectById(cur.subjectId)?.color || null;
  const swatches = h('div', { class: 'swatches' });
  const drawSwatches = () => swatches.replaceChildren(...TILE_COLORS.map((c) => h('button', { class: `swatch big ${color === c ? 'on' : ''}`, style: { background: c }, 'aria-label': `Farbe ${c}`, onclick: () => { color = c; drawSwatches(); preview(); } })));
  const prev = h('div', { class: 'tt-cell tt-preview' });
  const preview = () => {
    const s = matchSubject(fach.value);
    const c = color || s?.color || '#8b5cf6';
    prev.style.setProperty('--c', c);
    prev.replaceChildren(h('span', { class: 'tt-sub' }, label.value || s?.short || (fach.value || 'Fach').slice(0, 5)), teacher.value ? h('span', { class: 'tt-meta' }, teacher.value) : null, room.value ? h('span', { class: 'tt-room' }, room.value) : null);
  };
  for (const el of [fach, label, teacher, room]) el.addEventListener('input', preview);
  fach.addEventListener('change', () => { const s = matchSubject(fach.value); if (s?.teacher && !teacher.value) { teacher.value = s.teacher; preview(); } });
  const sameAll = h('label', { class: 'check-row' }, h('input', { type: 'checkbox', checked: true }), h('span', {}, 'Farbe für alle Stunden dieses Fachs'));
  const weekSel = t.ab ? h('select', { class: 'input' }, [['', 'Jede Woche'], ['A', 'Nur A-Woche'], ['B', 'Nur B-Woche']].map(([v, lab]) => h('option', { value: v, selected: (cur.week || '') === v }, lab))) : null;
  const pair = blockMode() ? (ttRows().find((r) => r.slots.includes(cur.slot))?.slots || [cur.slot]) : [cur.slot];
  // Im Doppelstunden-Modus gehört die Stunde im anderen Teil des Blocks dazu (gleicher Tag, gleiches Fach)
  const partners = l ? t.lessons.filter((x) => x !== l && x.day === l.day && pair.includes(x.slot) && lessonName(x) === lessonName(l) && (x.week || '') === (l.week || '')) : [];
  const double = isNew && !blockMode() ? h('label', { class: 'check-row' }, h('input', { type: 'checkbox' }), h('span', {}, 'Doppelstunde (auch die nächste Stunde)')) : null;
  drawSwatches(); preview();
  const o = sheet(`${DAY_NAMES[cur.day - 1]}, ${pair.join('.–')}. Stunde`, [
    prev,
    h('div', { class: 'label' }, 'Fach'), fach, datalist('dl-subjects', state.subjects.map((s) => s.name)),
    h('div', { class: 'row gap' },
      h('div', { class: 'grow' }, h('div', { class: 'label' }, 'Lehrkraft'), teacher),
      h('div', { class: 'grow' }, h('div', { class: 'label' }, 'Raum'), room)),
    datalist('dl-teachers', knownTeachers()), datalist('dl-rooms', knownRooms()),
    h('div', { class: 'label' }, 'Kürzel auf der Kachel (optional)'), label,
    h('div', { class: 'label' }, 'Farbe'), swatches, sameAll,
    weekSel ? [h('div', { class: 'label' }, 'Woche'), weekSel] : null,
    double,
    h('button', { class: 'btn primary block', onclick: () => {
      const name = fach.value.trim();
      if (!name) return toast('Bitte ein Fach eintragen.');
      const s = matchSubject(name);
      const vals = { subjectId: s?.id || null, fach: s ? '' : name, label: label.value.trim(), teacher: teacher.value.trim(), room: room.value.trim(), color, week: weekSel?.value || null };
      const clear = (slotN) => { t.lessons = t.lessons.filter((x) => x.id === cur.id || !(x.day === cur.day && x.slot === slotN && (!t.ab || !x.week || !vals.week || x.week === vals.week))); };
      clear(cur.slot);
      if (isNew) t.lessons.push({ ...cur, ...vals });
      else Object.assign(t.lessons.find((x) => x.id === cur.id), vals);
      for (const sn of pair.filter((n) => n !== cur.slot)) { // zweite Stunde des Blocks
        const mate = partners.find((x) => x.slot === sn);
        if (mate) Object.assign(mate, vals);
        else { clear(sn); t.lessons.push({ ...cur, ...vals, id: uid(), slot: sn }); }
      }
      if (double?.querySelector('input').checked) {
        if (!t.slots.some((x) => x.n === cur.slot + 1)) t.slots.push({ n: cur.slot + 1, von: slotOf(cur.slot)?.bis || '', bis: '' });
        clear(cur.slot + 1); t.lessons.push({ ...cur, ...vals, id: uid(), slot: cur.slot + 1 });
      }
      if (color && sameAll.querySelector('input').checked) for (const x of t.lessons) if (lessonName(x) === (s?.name || name)) x.color = color;
      if (s && vals.teacher && !s.teacher) s.teacher = vals.teacher; // Lehrkraft fürs Fach merken
      save(); o.remove(); render();
    } }, 'Speichern'),
    isNew ? null : h('button', { class: 'btn ghost block danger-text', onclick: () => { t.lessons = t.lessons.filter((x) => x.id !== cur.id && !partners.includes(x)); save(); o.remove(); render(); } }, pair.length > 1 ? 'Doppelstunde löschen' : 'Stunde löschen'),
  ]);
}

function editAB() {
  const t = tt();
  const o = sheet('A-/B-Wochen', [
    h('p', { class: 'muted small' }, 'Für Pläne, die sich wöchentlich abwechseln. Stunden können dann „jede Woche“, „nur A“ oder „nur B“ sein.'),
    h('div', { class: 'seg' },
      h('button', { class: `seg-btn ${!t.ab ? 'active' : ''}`, onclick: () => { t.ab = false; save(); o.remove(); render(); } }, 'Aus'),
      h('button', { class: `seg-btn ${t.ab && abWeek() === 'A' ? 'active' : ''}`, onclick: () => { t.ab = true; t.abRef = isoDate(mondayOf(new Date())); save(); o.remove(); render(); } }, 'Diese Woche = A'),
      h('button', { class: `seg-btn ${t.ab && abWeek() === 'B' ? 'active' : ''}`, onclick: () => { t.ab = true; const m = mondayOf(new Date()); m.setDate(m.getDate() - 7); t.abRef = isoDate(m); save(); o.remove(); render(); } }, 'Diese Woche = B')),
  ]);
}

// ---------- Klassenarbeiten
const PREP_KINDS = ['Klassenarbeit', 'Klausur', 'Test', 'Vokabeltest'];

// Tippen auf einen Termin: Lernplan öffnen bzw. direkt einen Prüfungsplan erstellen
function openExamItem(x) {
  const exam = x.examId && examById(x.examId);
  if (exam) { state.activeExamId = exam.id; ui.planTab = 'lernplan'; save(); go('plan'); return; }
  if (x.src === 'plan' && x.subjectId && PREP_KINDS.includes(x.art) && daysUntil(x.date) >= 0) {
    if (x.art === 'Vokabeltest') { toast('Für Vokabeltests: Reiter Vokabeln → Vokabelseite hochladen und das Testdatum eintragen.'); return; }
    startNewExam(x.subjectId, x.date, { topicsText: [x.thema, x.notiz].filter(Boolean).join(' – '), planItem: x.id });
    return;
  }
  editExamItem(x);
}

function examRow(x) {
  const sub = subjectById(x.subjectId);
  const d = daysUntil(x.date);
  const hasPlan = x.examId && examById(x.examId);
  const canPrep = !hasPlan && x.src === 'plan' && x.subjectId && PREP_KINDS.includes(x.art) && d >= 0;
  return h('div', { class: 'exam-row-wrap' }, h('button', { class: `menu-row exam-row ${d < 0 ? 'past' : d <= 7 ? 'soon' : ''}`, onclick: () => openExamItem(x) },
    sub ? subjectBadge(sub, 36) : h('span', { class: 'menu-ico' }, icon('exam', 20)),
    h('span', { class: 'menu-text' },
      h('span', { class: 'menu-label' }, `${itemName(x)} · ${x.art || 'Arbeit'}`),
      h('span', { class: 'menu-sub' }, [fmtDate(x.date), untilLabel(x.date), x.thema, x.stunde ? `${x.stunde} Std.` : '', x.raum ? `Raum ${x.raum}` : ''].filter(Boolean).join(' · ')),
      x.notiz ? h('span', { class: 'menu-sub note-sub' }, x.notiz) : null),
    hasPlan ? h('span', { class: 'chip-static' }, 'Lernplan') : canPrep ? h('span', { class: 'chip-static prep' }, icon('sparkles', 14), 'Prüfungsplan') : null),
    x.src === 'plan' ? h('button', { class: 'iconbtn exam-edit', 'aria-label': 'Termin bearbeiten', onclick: () => editExamItem(x) }, icon('edit', 18)) : null);
}

function drawExamPlan(main) {
  const all = allExamDates();
  const up = all.filter((x) => daysUntil(x.date) >= 0);
  const past = all.filter((x) => daysUntil(x.date) < 0).reverse();
  if (!all.length) {
    add(main, h('div', { class: 'center stack' }, mascot(110),
      h('p', { class: 'muted' }, 'Lade deinen Klassenarbeitsplan als Foto oder PDF hoch – ich trage alle Termine ein. Zu jeder Arbeit kannst du dann mit einem Tipp den Lernplan starten.'),
      h('button', { class: 'btn primary block', onclick: () => uploadPlan('xp') }, icon('upload', 18), 'Klassenarbeitsplan hochladen'),
      h('button', { class: 'btn block', onclick: () => editExamItem(null) }, icon('plus', 18), 'Arbeit eintragen')));
    return;
  }
  add(main,
    h('button', { class: 'class-chip', onclick: () => editClass() }, icon('user', 16), xp().klasse ? `Meine Klasse: ${xp().klasse}` : 'Meine Klasse eintragen (z. B. 10c)', icon('edit', 14)),
    up.length ? h('div', { class: 'menu' }, up.map(examRow)) : h('p', { class: 'muted center' }, 'Keine anstehenden Arbeiten.'),
    h('div', { class: 'row gap' },
      h('button', { class: 'btn grow', onclick: () => editExamItem(null) }, icon('plus', 18), 'Eintragen'),
      h('button', { class: 'btn grow', onclick: () => uploadPlan('xp') }, icon('upload', 18), 'Plan hochladen')),
    past.length ? h('details', { class: 'fold' }, h('summary', {}, h('span', { class: 'menu-ico' }, icon('clock', 20)), h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, 'Vergangen'), h('span', { class: 'menu-sub' }, `${past.length} Arbeiten`)), h('span', { class: 'fold-chev' }, icon('chev', 18))),
      h('div', { class: 'fold-body' }, h('div', { class: 'menu' }, past.map(examRow)))) : null);
}

function examPlanMenu() {
  const p = xp();
  const files = p.fileIds.filter((id) => state.files[id] && isGroupLead(id));
  const o = sheet('Prüfungstermine', [h('div', { class: 'menu' },
    menuRow('user', 'Meine Klasse / Kurs', p.klasse ? `${p.klasse} – beim Hochladen nur diese Termine` : 'Noch nicht angegeben – wichtig bei Plänen für mehrere Klassen', () => { o.remove(); editClass(); }),
    menuRow('calendar', 'Kalender', 'Monatsansicht, eigene Termine, Apple Kalender', () => { o.remove(); openCalendar('plan'); }),
    menuRow('upload', 'Plan hochladen', 'Termine werden ergänzt, nichts wird gelöscht', () => { o.remove(); uploadPlan('xp'); }),
    ...files.map((id, i) => menuRow('image', files.length > 1 ? `Hochgeladenen Plan ${i + 1} ansehen` : 'Hochgeladenen Plan ansehen', state.files[id].name, () => { o.remove(); openFile(id); })),
    menuRow('plus', 'Arbeit eintragen', null, () => { o.remove(); editExamItem(null); }))]);
}

function editClass(then = null) {
  const p = xp();
  const inp = h('input', { class: 'input', placeholder: 'z. B. 10c', value: p.klasse || '' });
  const files = p.fileIds.filter((id) => state.files[id] && isGroupLead(id));
  const o = sheet('In welcher Klasse bist du?', [
    h('p', { class: 'muted small' }, 'Steht der Plan für mehrere Klassen (z. B. 10a–10d), übernimmt Jelly nur die Termine für deine Klasse.'),
    inp,
    h('button', { class: 'btn primary block', onclick: () => {
      const changed = (p.klasse || '') !== inp.value.trim();
      p.klasse = inp.value.trim(); save(); o.remove();
      if (then) { then(); return; }
      if (changed && files.length && p.klasse) { rereadExamPlans(); return; }
      render();
    } }, then ? 'Weiter zum Hochladen' : 'Speichern'),
    files.length && !then ? h('button', { class: 'btn block', onclick: () => { p.klasse = inp.value.trim(); save(); o.remove(); rereadExamPlans(); } }, icon('refresh', 16), 'Hochgeladenen Plan neu auslesen') : null]);
}

// Hochgeladene Arbeitspläne neu auslesen: vorhandene Termine aus diesen Plänen ersetzen (außer solchen mit Lernplan)
function rereadExamPlans() {
  const p = xp();
  const ids = p.fileIds.filter((id) => state.files[id]);
  if (!ids.length) return render();
  p.items = p.items.filter((it) => !it.fromPlan || it.examId);
  save();
  go('wimport', { kind: 'xp', ids });
}

function editExamItem(x) {
  const p = xp();
  if (x?.src === 'exam') { // Klausur aus dem Lernplan, noch kein Eintrag im Arbeitsplan
    const e = examById(x.examId);
    const o = sheet(`${itemName(x)} · ${fmtDate(x.date)}`, [h('div', { class: 'menu' },
      menuRow('route', 'Zum Lernplan', untilLabel(x.date), () => { o.remove(); state.activeExamId = e.id; ui.planTab = 'lernplan'; save(); go('plan'); }))]);
    return;
  }
  const isNew = !x;
  const cur = x ? p.items.find((it) => it.id === x.id) : { id: uid(), date: isoDate(new Date(Date.now() + 7 * 86400000)), subjectId: state.subjects[0]?.id || null, fach: '', art: 'Klassenarbeit', thema: '', stunde: '', raum: '', examId: null };
  const subSel = h('select', { class: 'input' }, state.subjects.map((s) => h('option', { value: s.id, selected: s.id === cur.subjectId }, s.name)), h('option', { value: '', selected: !cur.subjectId }, 'Anderes Fach …'));
  const other = h('input', { class: 'input', placeholder: 'Name des Fachs', value: cur.fach || '' });
  subSel.onchange = () => { other.style.display = subSel.value ? 'none' : ''; };
  other.style.display = subSel.value ? 'none' : '';
  const date = h('input', { class: 'input', type: 'date', value: cur.date });
  const art = h('select', { class: 'input' }, EXAM_KINDS.map((k) => h('option', { value: k, selected: k === cur.art }, k)));
  const thema = h('input', { class: 'input', placeholder: 'z. B. Lineare Funktionen', value: cur.thema || '' });
  const stunde = h('input', { class: 'input', placeholder: 'z. B. 3.–4.', value: cur.stunde || '' });
  const raum = h('input', { class: 'input', placeholder: 'z. B. A104', value: cur.raum || '', list: 'dl-rooms2' });
  const notiz = h('textarea', { class: 'input', rows: 2, placeholder: 'z. B. nur 10c, Gruppe B, Taschenrechner mitbringen', value: cur.notiz || '' });
  const exam = cur.examId && examById(cur.examId);
  const read = () => ({ date: date.value, subjectId: subSel.value || null, fach: subSel.value ? '' : other.value.trim(), art: art.value, thema: thema.value.trim(), stunde: stunde.value.trim(), raum: raum.value.trim(), notiz: notiz.value.trim() });
  const store = () => {
    const v = read();
    if (!v.date) { toast('Bitte ein Datum wählen.'); return false; }
    if (!v.subjectId && !v.fach) { toast('Bitte ein Fach wählen oder eintragen.'); return false; }
    Object.assign(cur, v);
    if (isNew && !p.items.includes(cur)) p.items.push(cur);
    if (exam && exam.date !== cur.date) exam.date = cur.date; // Datum im Lernplan mitziehen
    save();
    return true;
  };
  const o = sheet(isNew ? 'Arbeit eintragen' : 'Arbeit', [
    h('div', { class: 'label' }, 'Fach'), subSel, other,
    h('div', { class: 'row gap' }, h('div', { class: 'grow' }, h('div', { class: 'label' }, 'Datum'), date), h('div', { class: 'grow' }, h('div', { class: 'label' }, 'Art'), art)),
    h('div', { class: 'label' }, 'Thema (optional)'), thema,
    h('div', { class: 'row gap' }, h('div', { class: 'grow' }, h('div', { class: 'label' }, 'Stunde'), stunde), h('div', { class: 'grow' }, h('div', { class: 'label' }, 'Raum'), raum)), datalist('dl-rooms2', knownRooms()),
    h('div', { class: 'label' }, 'Anmerkung (optional)'), notiz,
    exam
      ? h('button', { class: 'btn primary block', onclick: () => { if (!store()) return; o.remove(); state.activeExamId = exam.id; ui.planTab = 'lernplan'; save(); go('plan'); } }, icon('route', 18), 'Zum Lernplan')
      : h('button', { class: 'btn primary block', onclick: () => {
        if (!store()) return;
        if (!cur.subjectId) return toast('Für einen Lernplan muss das Fach angelegt sein (Fächer → +).');
        o.remove();
        startNewExam(cur.subjectId, cur.date, { topicsText: cur.thema, planItem: cur.id });
      } }, icon('sparkles', 18), 'Prüfungsplan erstellen'),
    h('button', { class: 'btn block', onclick: () => { if (store()) { o.remove(); render(); } } }, 'Speichern'),
    isNew ? null : h('button', { class: 'btn ghost block danger-text', onclick: () => { p.items = p.items.filter((it) => it.id !== cur.id); save(); o.remove(); render(); } }, 'Eintrag löschen'),
  ]);
}

// ---------- Hochladen & Auslesen (Stundenplan: tt, Klassenarbeitsplan: xp)
async function uploadPlan(kind) {
  if (!aiReady()) return toast('Bitte zuerst die KI einrichten (Mehr → KI-Verbindung).', 'error');
  if (kind === 'tt' && tt().lessons.length && !(await confirmDialog('Der neue Plan ersetzt den eingetragenen Stundenplan. Weiter?', 'Ersetzen', 'Abbrechen', 'primary'))) return;
  if (kind === 'xp' && !xp().klasse) { editClass(() => uploadPlan('xp')); return; }
  const files = await pickFiles({ accept: 'image/*,application/pdf,.pdf' });
  if (!files.length) return;
  const ids = await uploadPages(files, { kind: kind === 'tt' ? 'timetable' : 'examplan', together: true });
  if (!ids.length) return;
  if (kind === 'tt') {
    for (const id of tt().fileIds) await removeFile(id);
    tt().fileIds = ids;
  } else xp().fileIds.push(...ids);
  save();
  go('wimport', { kind, ids });
}

async function importPlan(kind, ids) {
  const parts = [{ text: kind === 'tt' ? P.timetablePrompt() : P.examPlanPrompt(isoDate(new Date()), xp().klasse || '') }];
  for (const id of ids) parts.push(await filePart(id));
  const res = await generate({ system: P.baseSystem(null), parts, json: true, temperature: 0.1 });
  if (kind === 'tt') {
    const t = tt();
    const lessons = (res.stunden || []).filter((x) => x && Number(x.tag) >= 1 && Number(x.tag) <= 6 && Number(x.stunde) >= 1 && x.fach).map((x) => {
      const s = matchSubject(x.fach);
      return { id: uid(), day: Number(x.tag), slot: Number(x.stunde), subjectId: s?.id || null, fach: s ? '' : String(x.fach), teacher: String(x.lehrer || '').trim(), room: String(x.raum || '').trim(), week: x.woche === 'A' || x.woche === 'B' ? x.woche : null };
    });
    if (!lessons.length) throw new AIError('Ich konnte im Bild keinen Stundenplan erkennen. Ist das Foto scharf und vollständig?');
    t.lessons = lessons;
    const zeiten = (res.zeiten || []).filter((z) => Number(z.stunde) >= 1 && /^\d{1,2}:\d{2}$/.test(z.von || '') && /^\d{1,2}:\d{2}$/.test(z.bis || ''));
    if (zeiten.length) t.slots = zeiten.map((z) => ({ n: Number(z.stunde), von: z.von.padStart(5, '0'), bis: z.bis.padStart(5, '0') })).sort((a, b) => a.n - b.n);
    if (res.abWochen || lessons.some((l) => l.week)) { t.ab = true; t.abRef ||= isoDate(mondayOf(new Date())); }
    // Häufigste Lehrkraft je Fach merken
    for (const s of state.subjects) {
      const names = lessons.filter((l) => l.subjectId === s.id && l.teacher).map((l) => l.teacher);
      if (names.length && !s.teacher) s.teacher = names.sort((a, b) => names.filter((x) => x === b).length - names.filter((x) => x === a).length)[0];
    }
    const unknown = [...new Set(lessons.filter((l) => !l.subjectId).map((l) => l.fach))];
    toast(`${lessons.length} Stunden eingetragen.${unknown.length ? ` Nicht als Fach angelegt: ${unknown.slice(0, 4).join(', ')}${unknown.length > 4 ? ' …' : ''}.` : ''} Bitte kurz prüfen.`, 'ok');
  } else {
    const p = xp();
    let added = 0, other = 0;
    for (const x of res.eintraege || []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(x?.datum || '') || !x.fach) continue;
      if (x.fuerMich === false) { other++; continue; } // laut Plan für eine andere Klasse
      const s = matchSubject(x.fach);
      if (p.items.some((it) => it.date === x.datum && (s ? it.subjectId === s.id : it.fach === x.fach))) continue;
      p.items.push({ id: uid(), date: x.datum, subjectId: s?.id || null, fach: s ? '' : String(x.fach), art: EXAM_KINDS.includes(x.art) ? x.art : 'Klassenarbeit', thema: String(x.thema || ''), stunde: String(x.stunde || ''), raum: String(x.raum || ''), notiz: String(x.anmerkung || ''), examId: null, fromPlan: true });
      added++;
    }
    if (!added && !(res.eintraege || []).length) throw new AIError('Ich konnte im Bild keine Termine erkennen. Ist das Foto scharf und vollständig?');
    toast(`${added} Termin${added === 1 ? '' : 'e'} eingetragen${other ? `, ${other} für andere Klassen übersprungen` : ''}. Bitte kurz prüfen.`, 'ok');
  }
}

function viewWeekImport({ kind, ids }) {
  const main = h('main', { class: 'content narrow' });
  const back = () => { if (kind === 'tt') go('week'); else { ui.planTab = 'termine'; go('plan'); } };
  pending(main, `wimport:${kind}:${(ids || []).join(',')}`, kind === 'tt' ? 'Ich lese deinen Stundenplan …' : 'Ich lese deinen Klassenarbeitsplan …',
    ['Plan lesen', 'Eintragen'], async () => { await importPlan(kind, ids || []); setTimeout(back, 0); });
  return h('div', { class: 'screen' }, topbar({ back, title: kind === 'tt' ? 'Stundenplan' : 'Prüfungstermine' }), main);
}

const openCalendar = (from) => { ui.calBack = from; go('calendar'); };
const openNotes = (from) => { ui.notesBack = from; go('notes'); };
// Symbole oben links: Kalender und Notizen
const topLeft = (from, withCal = true) => h('div', { class: 'top-left' },
  withCal ? h('button', { class: 'iconbtn', 'aria-label': 'Kalender', onclick: () => openCalendar(from) }, icon('calendar', 20)) : null,
  h('button', { class: 'iconbtn', 'aria-label': 'Notizen', onclick: () => openNotes(from) }, icon('notebook', 20)));
// ---------- Kalender: Prüfungen, Stundenplan und eigene Termine
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const ownEvents = () => (xp().events ||= []);

// Alles an einem Tag: Prüfungen, eigene Termine, Stunden laut Stundenplan
function dayItems(iso) {
  const d = parseISO(iso);
  const wd = (d.getDay() + 6) % 7;
  const exams = allExamDates().filter((x) => x.date === iso);
  const events = [...ownEvents().filter((e) => e.date === iso), ...todos().filter((t) => !t.done && t.due === iso).map((t) => ({ id: `todo-${t.id}`, title: `To-do: ${t.title}`, time: t.time, note: t.note, color: subjectById(t.subjectId)?.color || '#fcd34d', todo: t }))].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const lessons = wd < 5 ? lessonsOn(wd + 1, abWeek(d)) : [];
  return { exams, events, lessons };
}

function viewCalendar() {
  const today = isoDate(new Date());
  ui.calMonth ??= today.slice(0, 7);
  ui.calDay ??= today;
  const [y, m] = ui.calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const shift = (n) => { const d = new Date(y, m - 1 + n, 1); ui.calMonth = isoDate(d).slice(0, 7); render(); };
  const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const iso = isoDate(d);
    if (i >= 35 && d.getMonth() !== m - 1) break;
    const { exams, events } = dayItems(iso);
    const dots = [...exams.map((x) => subjectById(x.subjectId)?.color || '#f87171'), ...events.map((e) => e.color || '#94a3b8')].slice(0, 4);
    cells.push(h('button', { class: `cal-cell ${d.getMonth() !== m - 1 ? 'other' : ''} ${iso === today ? 'today' : ''} ${iso === ui.calDay ? 'sel' : ''} ${exams.length ? 'has-exam' : ''}`, onclick: () => { ui.calDay = iso; render(); } },
      h('span', { class: 'cal-num' }, d.getDate()),
      h('span', { class: 'cal-dots' }, dots.map((c) => h('i', { style: { background: c } })))));
  }
  const { exams, events, lessons } = dayItems(ui.calDay);
  const sel = parseISO(ui.calDay);
  const main = h('main', { class: 'content narrow' },
    h('div', { class: 'cal-head-row' },
      h('button', { class: 'iconbtn', 'aria-label': 'Voriger Monat', onclick: () => shift(-1) }, icon('back', 20)),
      h('strong', {}, `${MONTHS[m - 1]} ${y}`),
      h('button', { class: 'iconbtn flip', 'aria-label': 'Nächster Monat', onclick: () => shift(1) }, icon('back', 20))),
    h('div', { class: 'cal-grid' }, ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => h('div', { class: 'cal-wd' }, d)), cells),
    h('div', { class: 'row between cal-day-head' },
      h('div', { class: 'label' }, `${sel.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}${ui.calDay === today ? ' · heute' : ''}`),
      h('button', { class: 'btn small', onclick: () => editEvent(null, ui.calDay) }, icon('plus', 16), 'Termin')),
    exams.length ? h('div', { class: 'menu' }, exams.map(examRow)) : null,
    events.length ? h('div', { class: 'menu' }, events.map((e) => h('button', { class: 'menu-row', onclick: () => (e.todo ? editTodo(e.todo) : editEvent(e)) },
      h('span', { class: 'swatch', style: { background: e.color || '#94a3b8' } }),
      h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, e.title), h('span', { class: 'menu-sub' }, [e.time ? `${e.time}${e.end ? `–${e.end}` : ''} Uhr` : 'ganztägig', e.note].filter(Boolean).join(' · ')))))) : null,
    lessons.length ? h('details', { class: 'fold' },
      h('summary', {}, h('span', { class: 'menu-ico' }, icon('clock', 20)), h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, 'Stundenplan'), h('span', { class: 'menu-sub' }, `${lessons.length} Stunden`)), h('span', { class: 'fold-chev' }, icon('chev', 18))),
      h('div', { class: 'fold-body' }, h('div', { class: 'menu' }, lessons.map((l) => {
        const sl = slotOf(l.slot);
        return h('div', { class: 'menu-row' }, h('span', { class: 'swatch', style: { background: lessonColor(l) } }),
          h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, `${l.slot}. ${lessonName(l)}`), h('span', { class: 'menu-sub' }, [sl?.von && sl?.bis ? `${sl.von}–${sl.bis}` : '', l.teacher, l.room].filter(Boolean).join(' · '))));
      })))) : null,
    !exams.length && !events.length && !lessons.length ? h('p', { class: 'muted center' }, 'Nichts eingetragen.') : null);
  return h('div', { class: 'screen' },
    h('header', { class: 'topbar' },
      h('button', { class: 'iconbtn', 'aria-label': 'Zurück', onclick: () => go(ui.calBack || 'week') }, icon('back', 22)),
      h('div', { class: 'topbar-title' }, 'Kalender'),
      h('button', { class: 'iconbtn', 'aria-label': 'Menü', onclick: () => calendarMenu() }, icon('more'))),
    main);
}

function editEvent(e, date = null) {
  const isNew = !e;
  const cur = e || { id: uid(), date: date || isoDate(new Date()), time: '', end: '', title: '', note: '', color: '#7dd3fc' };
  const title = h('input', { class: 'input', placeholder: 'z. B. Wandertag, Abgabe Referat', value: cur.title });
  const dt = h('input', { class: 'input', type: 'date', value: cur.date });
  const tm = h('input', { class: 'input', type: 'time', value: cur.time || '' });
  const en = h('input', { class: 'input', type: 'time', value: cur.end || '' });
  const note = h('textarea', { class: 'input', rows: 2, placeholder: 'Anmerkung (optional)', value: cur.note || '' });
  let color = cur.color;
  const sw = h('div', { class: 'swatches' });
  const draw = () => sw.replaceChildren(...TILE_COLORS.map((c) => h('button', { class: `swatch big ${color === c ? 'on' : ''}`, style: { background: c }, onclick: () => { color = c; draw(); } })));
  draw();
  const o = sheet(isNew ? 'Termin eintragen' : 'Termin', [
    h('div', { class: 'label' }, 'Titel'), title,
    h('div', { class: 'label' }, 'Datum'), dt,
    h('div', { class: 'row gap' }, h('div', { class: 'grow' }, h('div', { class: 'label' }, 'Von (optional)'), tm), h('div', { class: 'grow' }, h('div', { class: 'label' }, 'Bis (optional)'), en)),
    h('div', { class: 'label' }, 'Anmerkung'), note,
    h('div', { class: 'label' }, 'Farbe'), sw,
    h('button', { class: 'btn primary block', onclick: () => {
      if (!title.value.trim() || !dt.value) return toast('Bitte Titel und Datum eintragen.');
      Object.assign(cur, { title: title.value.trim(), date: dt.value, time: tm.value, end: en.value, note: note.value.trim(), color });
      if (isNew) ownEvents().push(cur);
      ui.calDay = cur.date; ui.calMonth = cur.date.slice(0, 7);
      save(); o.remove(); render();
    } }, 'Speichern'),
    isNew ? null : h('button', { class: 'btn ghost block danger-text', onclick: () => { xp().events = ownEvents().filter((x) => x.id !== cur.id); save(); o.remove(); render(); } }, 'Termin löschen'),
  ]);
}

function calendarMenu() {
  const o = sheet('Kalender', [
    h('p', { class: 'muted small' }, 'Übernimmt die Termine in den Kalender deines iPads oder iPhones. Danach bitte „Alle hinzufügen“ tippen. Spätere Änderungen in Jelly werden nicht automatisch übertragen.'),
    h('div', { class: 'menu' },
      menuRow('calendar', 'Prüfungen & Termine übernehmen', `${allExamDates().filter((x) => daysUntil(x.date) >= 0).length + ownEvents().filter((e) => daysUntil(e.date) >= 0).length} anstehende`, () => { o.remove(); exportICS(false); }),
      menuRow('clock', 'Stundenplan übernehmen', 'Wöchentlich bis Ende des Schuljahres (31. Juli)', () => { o.remove(); exportICS(true); }))]);
}

// ---------- Export als .ics (Apple Kalender, Google Kalender, Outlook)
function exportICS(lessonsToo) {
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (iso) => iso.replace(/-/g, '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const esc = (t) => String(t || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`);
  const nextDay = (iso) => { const d = parseISO(iso); d.setDate(d.getDate() + 1); return isoDate(d); };
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Jelly Lern-KI//DE', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Jelly'];
  const ev = (uidStr, fields) => { lines.push('BEGIN:VEVENT', `UID:${uidStr}@jelly`, `DTSTAMP:${stamp}`, ...fields, 'END:VEVENT'); };
  let n = 0;
  if (!lessonsToo) {
    for (const x of allExamDates().filter((e) => daysUntil(e.date) >= 0)) {
      ev(`exam-${x.id}`, [`DTSTART;VALUE=DATE:${ymd(x.date)}`, `DTEND;VALUE=DATE:${ymd(nextDay(x.date))}`, `SUMMARY:${esc(`${itemName(x)} – ${x.art || 'Prüfung'}`)}`,
        `DESCRIPTION:${esc([x.thema, x.stunde ? `${x.stunde} Stunde` : '', x.notiz].filter(Boolean).join('\n'))}`, ...(x.raum ? [`LOCATION:${esc(x.raum)}`] : []),
        'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(`${itemName(x)} morgen`)}`, 'TRIGGER:-PT15H', 'END:VALARM']);
      n++;
    }
    for (const e of ownEvents().filter((x) => daysUntil(x.date) >= 0)) {
      const timed = !!e.time;
      ev(`event-${e.id}`, [
        timed ? `DTSTART:${ymd(e.date)}T${e.time.replace(':', '')}00` : `DTSTART;VALUE=DATE:${ymd(e.date)}`,
        timed ? `DTEND:${ymd(e.date)}T${(e.end || e.time).replace(':', '')}00` : `DTEND;VALUE=DATE:${ymd(nextDay(e.date))}`,
        `SUMMARY:${esc(e.title)}`, ...(e.note ? [`DESCRIPTION:${esc(e.note)}`] : [])]);
      n++;
    }
  } else {
    const now = new Date();
    const endYear = now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear();
    const until = `${endYear}0731T235959`;
    const monday = mondayOf(now);
    for (const l of tt().lessons) {
      // Doppelstunde = ein Termin: zweite Hälfte überspringen, erste bis zum Ende der zweiten
      const pairOf = blockMode() ? ttRows().find((r) => r.slots.includes(l.slot))?.slots || [l.slot] : [l.slot];
      const mate = (n) => tt().lessons.find((x) => x !== l && x.day === l.day && x.slot === n && lessonName(x) === lessonName(l) && (x.week || '') === (l.week || ''));
      if (pairOf.length > 1 && l.slot === pairOf[1] && mate(pairOf[0])) continue;
      const sl0 = slotOf(l.slot);
      const endSlot = pairOf.length > 1 && l.slot === pairOf[0] && mate(pairOf[1]) ? slotOf(pairOf[1]) : sl0;
      const sl = sl0 && endSlot ? { von: sl0.von, bis: endSlot.bis } : null;
      if (!sl?.von || !sl?.bis) continue;
      const d = new Date(monday); d.setDate(monday.getDate() + (l.day - 1));
      if (tt().ab && l.week && abWeek(d) !== l.week) d.setDate(d.getDate() + 7);
      const day = isoDate(d);
      ev(`lesson-${l.id}`, [`DTSTART:${ymd(day)}T${sl.von.replace(':', '')}00`, `DTEND:${ymd(day)}T${sl.bis.replace(':', '')}00`,
        `RRULE:FREQ=WEEKLY;INTERVAL=${tt().ab && l.week ? 2 : 1};UNTIL=${until}`,
        `SUMMARY:${esc(lessonName(l))}`, ...(l.room ? [`LOCATION:${esc(l.room)}`] : []), ...(l.teacher ? [`DESCRIPTION:${esc(l.teacher)}`] : [])]);
      n++;
    }
    if (!n) return toast('Im Stundenplan fehlen noch Uhrzeiten oder Stunden.');
  }
  if (!n) return toast('Keine anstehenden Termine.');
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: lessonsToo ? 'Jelly-Stundenplan.ics' : 'Jelly-Termine.ics' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast(`${n} Termine vorbereitet – im Kalender „Alle hinzufügen“ tippen.`, 'ok');
}

// ================================================================ TO-DOS
const todos = () => (state.todos ||= []);

function dueLabel(t) {
  if (!t.due) return 'ohne Termin';
  const d = daysUntil(t.due);
  const when = d === 0 ? 'heute' : d === 1 ? 'morgen' : d === -1 ? 'seit gestern' : d < 0 ? `seit ${-d} Tagen` : `in ${d} Tagen`;
  return `bis ${fmtDate(t.due)}${t.time ? `, ${t.time} Uhr` : ''} · ${when}`;
}

function viewTodos() {
  const open = todos().filter((t) => !t.done).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (a.time || '').localeCompare(b.time || '') || a.createdAt - b.createdAt);
  const done = todos().filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  // Schnell eintragen: Aufgabe + bis wann
  const title = h('input', { class: 'input', placeholder: 'Neue Aufgabe, z. B. Bio-Referat vorbereiten', enterkeyhint: 'done' });
  const due = h('input', { class: 'input', type: 'date', value: isoDate(new Date(Date.now() + 86400000)) });
  const addIt = () => {
    const txt = title.value.trim();
    if (!txt) { title.focus(); return; }
    todos().push({ id: uid(), title: txt, due: due.value || null, time: '', subjectId: matchSubject(txt.split(/[\s-:]/)[0])?.id || null, note: '', done: false, createdAt: Date.now() });
    save(); render();
    setTimeout(() => document.querySelector('.todo-add .input')?.focus(), 50);
  };
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') addIt(); });
  const row = (t) => {
    const sub = subjectById(t.subjectId);
    const d = t.due ? daysUntil(t.due) : null;
    const el = h('div', { class: `todo ${d !== null && d < 0 ? 'late' : d === 0 ? 'today' : ''}` },
      h('button', { class: 'todo-main', onclick: () => editTodo(t) },
        sub ? h('span', { class: 'todo-dot', style: { background: sub.color } }) : null,
        h('span', { class: 'todo-text' }, h('span', { class: 'todo-title' }, t.title), h('span', { class: 'todo-due' }, [sub?.name, dueLabel(t)].filter(Boolean).join(' · ')), t.note ? h('span', { class: 'todo-note' }, t.note) : null)),
      h('button', { class: 'todo-check', 'aria-label': `„${t.title}“ erledigt`, onclick: () => {
        el.classList.add('checked');
        setTimeout(() => { t.done = true; t.doneAt = Date.now(); save(); render(); toastUndo(t); }, 450); // kurz zeigen, dann verschwinden
      } }, icon('check', 18)));
    return el;
  };
  const screen = h('div', { class: 'screen with-tabs' },
    h('header', { class: 'topbar' }, topLeft('todo'), h('div', { class: 'topbar-title' }, 'To-dos'), h('span', { class: 'iconbtn-spacer' })),
    h('main', { class: 'content narrow' },
      h('div', { class: 'todo-add card' }, title, h('div', { class: 'row gap' }, h('div', { class: 'grow' }, h('div', { class: 'label' }, 'Bis wann?'), due), h('button', { class: 'btn primary todo-add-btn', 'aria-label': 'Hinzufügen', title: 'Hinzufügen', onclick: addIt }, icon('plus', 22)))),
      open.length ? h('div', { class: 'todo-list' }, open.map(row)) : h('div', { class: 'center stack todo-empty' }, mascot(90), h('p', { class: 'muted' }, done.length ? 'Alles erledigt – stark!' : 'Noch keine Aufgaben. Trag oben ein, was du bis wann schaffen musst.')),
      done.length ? h('details', { class: 'fold' },
        h('summary', {}, h('span', { class: 'menu-ico' }, icon('checkc', 20)), h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, 'Erledigt'), h('span', { class: 'menu-sub' }, `${done.length} Aufgaben`)), h('span', { class: 'fold-chev' }, icon('chev', 18))),
        h('div', { class: 'fold-body' }, h('div', { class: 'menu' }, done.slice(0, 50).map((t) => h('div', { class: 'menu-row done-row' },
          h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, t.title), h('span', { class: 'menu-sub' }, `erledigt am ${new Date(t.doneAt || Date.now()).toLocaleDateString('de-DE')}`)),
          h('button', { class: 'btn small ghost', onclick: () => { t.done = false; delete t.doneAt; save(); render(); } }, 'Zurückholen')))),
          h('button', { class: 'btn small ghost danger-text', onclick: async () => { if (await confirmDialog('Alle erledigten Aufgaben endgültig löschen?', 'Löschen')) { state.todos = todos().filter((x) => !x.done); save(); render(); } } }, 'Erledigte löschen'))) : null),
    tabbar('todo'));
  return screen;
}

function toastUndo(t) {
  const el = h('div', { class: 'toast ok undo-toast' }, h('span', {}, `„${t.title}“ erledigt`),
    h('button', { class: 'undo-btn', onclick: () => { t.done = false; delete t.doneAt; save(); el.remove(); render(); } }, 'Rückgängig'));
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => el.remove(), 4000);
}

function editTodo(t) {
  const title = h('input', { class: 'input', value: t.title });
  const due = h('input', { class: 'input', type: 'date', value: t.due || '' });
  const time = h('input', { class: 'input', type: 'time', value: t.time || '' });
  const subSel = h('select', { class: 'input' }, h('option', { value: '' }, 'Kein Fach'), state.subjects.map((s) => h('option', { value: s.id, selected: s.id === t.subjectId }, s.name)));
  const note = h('textarea', { class: 'input', rows: 2, placeholder: 'Notiz (optional)', value: t.note || '' });
  const o = sheet('Aufgabe', [
    h('div', { class: 'label' }, 'Aufgabe'), title,
    h('div', { class: 'row gap' }, h('div', { class: 'grow' }, h('div', { class: 'label' }, 'Bis wann?'), due), h('div', { class: 'grow' }, h('div', { class: 'label' }, 'Uhrzeit (optional)'), time)),
    h('div', { class: 'label' }, 'Fach'), subSel,
    h('div', { class: 'label' }, 'Notiz'), note,
    h('button', { class: 'btn primary block', onclick: () => {
      if (!title.value.trim()) return toast('Bitte die Aufgabe eintragen.');
      Object.assign(t, { title: title.value.trim(), due: due.value || null, time: time.value, subjectId: subSel.value || null, note: note.value.trim() });
      save(); o.remove(); render();
    } }, 'Speichern'),
    h('button', { class: 'btn ghost block danger-text', onclick: () => { state.todos = todos().filter((x) => x !== t); save(); o.remove(); render(); } }, 'Löschen'),
  ]);
}

// ================================================================ TUTOR-CHAT
function viewTutor() {
  const exam = activeExam();
  const screen = h('div', { class: 'screen with-tabs' },
    h('header', { class: 'topbar' }, h('span', { class: 'iconbtn-spacer' }),
      exam ? h('button', { class: 'exam-switch', onclick: () => examSheet() }, h('span', {}, `Tutor · ${subjectById(exam.subjectId)?.name}`), icon('updown', 18)) : h('div', { class: 'topbar-title' }, 'Tutor'),
      exam ? h('button', { class: 'iconbtn', 'aria-label': 'Chat leeren', onclick: async () => { if (await confirmDialog('Chatverlauf löschen?', 'Löschen')) { state.tutor[exam.id] = []; save(); render(); } } }, icon('trash')) : h('span', { class: 'iconbtn-spacer' })));
  if (!exam) {
    add(screen, h('main', { class: 'content narrow center' }, mascot(110), h('p', { class: 'muted' }, 'Leg zuerst eine Klausur an – dann kann ich dir Fragen zum Stoff beantworten.'), h('button', { class: 'btn primary', onclick: () => startNewExam() }, 'Klausur anlegen')), tabbar('tutor'));
    return screen;
  }
  const msgs = (state.tutor[exam.id] ||= []);
  const list = h('div', { class: 'chat-list' });
  const draw = () => {
    list.replaceChildren(
      h('div', { class: 'msg model' }, mdEl(`Frag mich alles zur **${subjectById(exam.subjectId)?.name}**-Klausur. Ich kenne dein Material. Oder schreib „Frag mich ab“ – dann bekommst du eine prüfungsnahe Aufgabe.`)),
      ...msgs.map((m) => h('div', { class: `msg ${m.role}` }, m.role === 'model' ? mdEl(m.text) : m.text)));
    setTimeout(() => list.lastChild?.scrollIntoView({ block: 'end' }), 0);
  };
  draw();
  const input = h('textarea', { class: 'input', rows: 2, placeholder: 'Deine Frage …' });
  const quick = h('div', { class: 'chips' }, ['Frag mich ab', 'Erklär mir das Wichtigste nochmal', 'Was sind meine Schwächen?', 'Welche Operatoren muss ich können?'].map((q) => h('button', { class: 'chip', onclick: () => { input.value = q; send.click(); } }, q)));
  const send = h('button', { class: 'iconbtn send', 'aria-label': 'Senden', onclick: async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const history = msgs.slice(-20);
    msgs.push({ role: 'user', text });
    draw();
    send.disabled = true;
    const typing = h('div', { class: 'msg model typing' }, '…');
    add(list, typing);
    try {
      const reply = await generate({ system: P.tutorSystem(exam), parts: [{ text }], history, temperature: 0.5 });
      msgs.push({ role: 'model', text: reply });
    } catch (e) { msgs.pop(); input.value = text; toast(errorMsg(e), 'error'); }
    save(); draw(); send.disabled = false;
  } }, icon('send'));
  add(screen, h('main', { class: 'content narrow chat' }, list, quick, h('div', { class: 'chat-input' }, input, send)), tabbar('tutor'));
  return screen;
}

// ================================================================ EINSTELLUNGEN
function viewSettings() {
  const p = state.profile;
  const st = state.settings;
  const aiSub = aiReady() ? (st.provider === 'openai' ? `Eigener Anbieter · ${st.oaModel}` : `Verbunden · ${st.model}`) : 'Nicht eingerichtet';
  return h('div', { class: 'screen with-tabs' },
    h('header', { class: 'topbar' }, h('span', { class: 'iconbtn-spacer' }), h('div', { class: 'topbar-title' }, 'Mehr'), h('span', { class: 'iconbtn-spacer' })),
    h('main', { class: 'content narrow' },
      h('div', { class: 'menu' },
        menuRow('sparkles', 'KI-Verbindung', aiSub, () => sheet('KI-Verbindung', [aiSetupBlock(false)])),
        menuRow('video', 'Video beim Warten', (st.waitVideo ?? DEFAULT_WAIT_VIDEO) ? 'An' : 'Aus', () => {
          const o = sheet('Video beim Warten', [
            h('p', { class: 'muted small' }, 'YouTube-Link, der läuft, während die KI arbeitet. Leer lassen = kein Video.'),
            h('input', { class: 'input', placeholder: 'https://youtu.be/…', value: st.waitVideo ?? DEFAULT_WAIT_VIDEO, onchange: (e) => {
              const v = e.target.value.trim();
              if (v && !youtubeId(v)) { toast('Das ist kein gültiger YouTube-Link.', 'error'); return; }
              st.waitVideo = v; save(); toast(v ? 'Video gespeichert.' : 'Video ausgeschaltet.', 'ok'); o.remove(); render();
            } })]);
        })),
      authEnabled && !bootedUid ? h('div', { class: 'menu' },
        menuRow('key', 'Konto & Sync einrichten', 'Anmelden – dann hast du alles auf iPad und Handy', () => openAccountSetup())) : null,
      authEnabled && bootedUid ? h('div', { class: 'menu' },
        menuRow('key', 'Konto & Sync', currentUser()?.email || (() => { try { return localStorage.getItem('lernki-last-email') || 'Angemeldet'; } catch { return 'Angemeldet'; } })(), () => {
          const u = currentUser();
          sheet('Konto', [
            h('p', {}, u?.email || 'Offline angemeldet'),
            u && u.providerData?.[0]?.providerId === 'password' && !u.emailVerified ? h('p', { class: 'muted small' }, 'E-Mail noch nicht bestätigt – schau in dein Postfach.') : null,
            (() => {
              const line = h('p', { class: 'muted small' });
              const draw = () => { line.textContent = syncStatus.state === 'ok' ? `✓ Synchronisiert${syncStatus.at ? ` um ${new Date(syncStatus.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : ''} – alle Geräte mit diesem Konto haben denselben Stand.` : syncStatus.state === 'läuft' ? 'Synchronisiere …' : syncStatus.state === 'fehler' ? `Sync-Problem: ${syncStatus.error}` : 'Synchronisierung aus.'; };
              draw(); onSyncStatus(draw);
              return line;
            })(),
            h('button', { class: 'btn block', onclick: () => syncNow() }, icon('refresh', 18), 'Jetzt synchronisieren'),
            h('button', { class: 'btn ghost block danger-text', onclick: async () => { try { await signOutUser(); } catch { try { localStorage.removeItem('lernki-last-uid'); } catch {} location.reload(); } } }, 'Abmelden'),
            h('button', { class: 'link-small danger-text', onclick: async () => {
              if (!(await confirmDialog('Konto endgültig löschen? Alle Daten in der Cloud UND auf diesem Gerät werden gelöscht. Das lässt sich nicht rückgängig machen. Tipp: vorher Mehr → Datensicherung → Backup.', 'Endgültig löschen'))) return;
              try {
                await deleteCloudData();
                await deleteAccount();
                await clearAll();
                try { localStorage.removeItem('lernki-last-uid'); localStorage.removeItem('lernki-last-email'); } catch {}
                toast('Konto und Daten gelöscht.', 'ok');
                setTimeout(() => location.reload(), 800);
              } catch (e) { toast(authErrorText(e).startsWith('Anmeldung fehlgeschlagen') ? errorMsg(e) : authErrorText(e), 'error'); }
            } }, 'Konto und alle Daten löschen')]);
        })) : null,
      h('div', { class: 'menu' },
        menuRow('user', 'Profil', `${p.name} · Klasse ${p.grade} · ${p.state}`, () => {
          const o = sheet('Profil', [
            h('p', { class: 'muted' }, `${p.name} · Klasse ${p.grade} · ${p.schoolType} · ${p.state}`),
            h('p', { class: 'muted small' }, `${p.minutesPerDay} Min./Tag · Korrektur: ${p.feedbackStyle === 'hart' ? 'schonungslos' : 'ermutigend'} · ${p.gradeScale === '0-15' ? 'Punkte 0–15' : 'Noten 1–6'}`),
            h('button', { class: 'btn primary block', onclick: () => { o.remove(); draft = null; go('onboarding'); } }, 'Fragebogen neu ausfüllen')]);
        }),
        menuRow('sparkles', 'Design', `Farben: ${THEMES.find((x) => x.id === state.settings.theme?.id)?.name || (state.settings.theme ? 'Eigene' : 'Lila')}`, () => designSheet()),
        menuRow('notebook', 'Notizen', 'Notizbücher mit Apple Pencil und Tastatur', () => openNotes('settings')),
        menuRow('chat', 'Tutor-Chat', 'Fragen zum Stoff deiner Klausur', () => go('tutor')),
        menuRow('folder', 'Hochgeladene Dateien', `${Object.keys(state.files || {}).length} Dateien`, () => go('files')),
        menuRow('save', 'Datensicherung', 'Backup speichern oder einspielen', () => {
          sheet('Datensicherung', [
            h('p', { class: 'muted small' }, 'Alles liegt nur auf diesem Gerät. Wenn Safari-Daten gelöscht werden, ist es weg – mach ab und zu ein Backup. Der API-Schlüssel wird nicht mitgesichert.'),
            h('button', { class: 'btn primary block', onclick: exportBackup }, 'Backup herunterladen'),
            h('button', { class: 'btn ghost block', onclick: importBackup }, 'Backup einspielen')]);
        })),
      h('div', { class: 'menu' },
        menuRow('info', 'Datenschutz', 'Was wird wo gespeichert?', () => privacySheet())),
      h('div', { class: 'menu' },
        menuRow('trash', 'Alle Daten löschen', null, async () => { if (await confirmDialog('Wirklich ALLE Daten löschen (Profil, Fächer, Klausuren, Archiv)?', 'Alles löschen')) { await clearAll(); draft = null; nx = null; go('onboarding'); } }, 'danger')),
      h('p', { class: 'muted small center' }, `Lern-KI · Version ${APP_VERSION}`)),
    tabbar('settings'));
}

function viewFiles() {
  const order = ['material', 'archive', 'sheet', 'vocab', 'vtest', 'timetable', 'examplan', 'answer'];
  const files = Object.values(state.files || {}).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  const groups = order.map((k) => [k, files.filter((f) => f.kind === k)]).concat([['other', files.filter((f) => !order.includes(f.kind))]]).filter(([, l]) => l.length);
  const sub = (f) => [subjectById(f.subjectId)?.name, f.addedAt ? new Date(f.addedAt).toLocaleDateString('de-DE') : '', f.mime === 'application/pdf' ? 'PDF' : f.mime?.startsWith('image/') ? 'Foto' : 'Text'].filter(Boolean).join(' · ');
  return h('div', { class: 'screen' }, topbar({ back: () => go('settings'), title: 'Hochgeladene Dateien' }),
    h('main', { class: 'content narrow' },
      files.length ? null : h('p', { class: 'muted center' }, 'Noch keine Dateien hochgeladen.'),
      groups.map(([k, list]) => h('section', { class: 'files-group' },
        h('div', { class: 'label' }, `${k === 'other' ? 'Sonstiges' : fileKindLabel(k)} (${list.filter((f) => isGroupLead(f.id)).length})`),
        h('div', { class: 'menu' }, list.filter((f) => isGroupLead(f.id)).map((f) => menuRow(f.mime?.startsWith('image/') ? 'image' : 'file', f.digest?.titel || f.name, [sub(f), groupOf(f.id).length > 1 ? pagesLabel(f.id) : ''].filter(Boolean).join(' · '), () => openFile(f.id))))))));
}

function privacySheet() {
  sheet('Datenschutz', [mdEl(`**Kurz:** Lern-KI hat keinen eigenen Server, kein Tracking, keine Werbung und keine Analyse-Tools.

## Wo liegen deine Daten?
- **Auf deinem Gerät** (im Browser-Speicher): alles, was du in der App anlegst.
- **Mit Konto zusätzlich in Firebase/Firestore** (Google, Rechenzentrum **Frankfurt**): derselbe Stand, damit deine Geräte abgleichen können. Nur dein Konto kann ihn lesen. Für die Anmeldung speichert Google deine E-Mail-Adresse und ggf. deinen Namen (Firebase Authentication).

## Wohin wird etwas geschickt?
- **Google Gemini:** Material, Fotos, Fragen und Antworten, wenn Jelly etwas erstellt oder korrigiert. Laut Googles Bedingungen werden Eingaben von Nutzern in der EU **nicht zur Produktverbesserung** genutzt, auch in der kostenlosen Stufe.
- **Ersatz-Anbieter** (Groq, Mistral oder OpenRouter) – nur wenn du ihn einrichtest und Google überlastet ist. Es gelten dessen Bedingungen; Groq und OpenRouter sitzen in den USA.
${backgroundAvailable() ? `- **Jelly im Hintergrund** (nur mit Konto): Damit Lernzettel & Co. auch bei geschlossener App fertig werden, liest eine Funktion in **Google Cloud (Firebase, Rechenzentrum Frankfurt)** deinen Stand und deine hochgeladenen Dateien aus Firestore, schickt die Anfragen mit deinem Schlüssel an Gemini und legt die Ergebnisse wieder in Firestore ab. Die Protokolle der Funktion enthalten keine Inhalte.
` : ''}- **Einsicht durch den Betreiber** (nur mit Konto): Der Betreiber dieser Jelly-Version sieht in einer Übersicht deine E-Mail-Adresse, deinen Namen, seit wann du registriert bist, wann du zuletzt aktiv warst, App-Version, Gerätetyp, Klassenstufe und ob die KI eingerichtet ist. Außerdem kann er **deine Inhalte lesen**: Fächer und Lehrerprofile, Klausuren mit Lernzetteln, Quiz und Aufgaben (auch deine Antworten und Korrekturen), Vokabeln, gelöste Blätter, Stundenplan, Termine und hochgeladene Dateien. Ändern kann er nichts. **Deine KI-Schlüssel sieht er nicht** – sie liegen getrennt. Wer das nicht möchte, nutzt Jelly ohne Konto (dann bleibt alles nur auf dem Gerät).
- **YouTube** – nur wenn du das Warte-Video abspielst.
- **GitHub Pages** liefert die App aus; dabei sieht GitHub (USA) wie bei jeder Website deine IP-Adresse.
- Schriften und PDF-Bibliothek liegen in der App selbst – dafür wird kein fremder Server kontaktiert.

## Deine Rechte
- **Kopie deiner Daten:** Mehr → Datensicherung → Backup herunterladen.
- **Löschen:** Mehr → Konto & Sync → „Konto und alle Daten löschen“ (ohne Konto: Mehr → Alle Daten löschen).

## Bitte beachten
- Lade keine Namen, Noten oder Fotos **anderer Personen** hoch (z. B. Klassenlisten, Klausuren mit fremden Namen).
- Unter 16 Jahren sollten deine Eltern einverstanden sein; den Gemini-Schlüssel muss laut Google eine volljährige Person erstellen.`)]);
}

async function exportBackup() {
  const blobs = await allBlobs();
  const data = { app: 'lern-ki', exportedAt: new Date().toISOString(), state: { ...JSON.parse(JSON.stringify(state)), settings: { ...state.settings, apiKey: '', oaKey: '' } }, blobs };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const a = h('a', { href: url, download: `lern-ki-backup-${isoDate(new Date())}.json` });
  add(document.body, a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function importBackup() {
  const [file] = await pickFiles({ accept: 'application/json,.json', multiple: false });
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'lern-ki' || !data.state) throw new Error('Das ist keine Lern-KI-Sicherung.');
    if (!(await confirmDialog('Backup einspielen? Aktuelle Daten werden ersetzt.', 'Einspielen'))) return;
    const keep = { apiKey: state.settings.apiKey, oaKey: state.settings.oaKey };
    for (const [id, v] of Object.entries(data.blobs || {})) await putBlob(id, v);
    replaceState({ ...data.state, settings: { ...data.state.settings, ...keep } });
    toast('Backup eingespielt.', 'ok');
    go('plan');
  } catch (e) { toast(errorMsg(e), 'error'); }
}

// ================================================================ Start
// ================================================================ ANMELDUNG
const GOOGLE_G = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

function viewLogin() {
  const mode = ui.loginMode || 'login';
  const err = h('div', { class: 'login-err' });
  const name = h('input', { class: 'input', placeholder: 'Vorname', autocomplete: 'given-name' });
  const email = h('input', { class: 'input', type: 'email', placeholder: 'E-Mail', autocomplete: 'email', autocapitalize: 'off' });
  const pw = h('input', { class: 'input', type: 'password', placeholder: mode === 'login' ? 'Passwort' : 'Passwort (mind. 6 Zeichen)', autocomplete: mode === 'login' ? 'current-password' : 'new-password' });
  const busy = (btn, on, label) => { btn.disabled = on; if (label) btn.textContent = label; };
  const submit = h('button', { class: 'btn primary block', onclick: async () => {
    err.textContent = '';
    busy(submit, true, mode === 'login' ? 'Melde an …' : 'Erstelle Konto …');
    try {
      if (mode === 'login') await signInEmail(email.value.trim(), pw.value);
      else { ui.suggestName = name.value.trim(); await registerEmail(email.value.trim(), pw.value, name.value.trim()); }
    } catch (e) { err.textContent = authErrorText(e); busy(submit, false, mode === 'login' ? 'Anmelden' : 'Konto erstellen'); }
  } }, mode === 'login' ? 'Anmelden' : 'Konto erstellen');
  pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit.click(); });
  const google = h('button', { class: 'btn google block', onclick: async () => {
    err.textContent = '';
    try { await signInGoogle(); } catch (e) { err.textContent = authErrorText(e); }
  } }, h('span', { html: GOOGLE_G }), 'Mit Google anmelden');
  return h('div', { class: 'screen login' },
    h('main', { class: 'content narrow login-box' },
      mascot(110),
      h('h1', { class: 'display' }, mode === 'login' ? 'Willkommen zurück' : 'Konto erstellen'),
      h('p', { class: 'muted' }, mode === 'login' ? 'Melde dich an, um mit Jelly zu lernen.' : 'In einer Minute startklar – kostenlos.'),
      google,
      h('div', { class: 'or' }, h('span', {}, 'oder mit E-Mail')),
      mode === 'register' ? name : null, email, pw, err, submit,
      h('button', { class: 'link-small', onclick: () => { ui.loginMode = mode === 'login' ? 'register' : 'login'; render(); } }, mode === 'login' ? 'Noch kein Konto? Registrieren' : 'Schon ein Konto? Anmelden'),
      mode === 'login' ? h('button', { class: 'link-small', onclick: async () => {
        if (!email.value.trim()) { err.textContent = 'Gib zuerst deine E-Mail ein.'; return; }
        try { await resetPassword(email.value.trim()); toast('E-Mail zum Zurücksetzen ist unterwegs.', 'ok'); } catch (e) { err.textContent = authErrorText(e); }
      } }, 'Passwort vergessen?') : null,
      h('button', { class: 'link-small', onclick: async () => { ui.localOnly = true; await boot(null); } }, state.profile ? 'Abbrechen' : 'Ohne Konto weiter'),
      state.profile ? h('p', { class: 'muted small' }, 'Deine bisherigen Daten werden ins Konto übernommen. Mach das zuerst auf dem Gerät mit den meisten Daten.') : null,
      h('p', { class: 'muted small' }, 'Deine Lerndaten bleiben auf diesem Gerät. Das Konto trennt sie von den Daten anderer Personen.')));
}

let bootedUid;
async function boot(user) {
  await loadState();
  const OLD = { '#5b9dff': '#93c5fd', '#ff9f5a': '#fdba74', '#ff7a59': '#fda4af', '#3dd68c': '#86efac', '#e0a458': '#fcd34d', '#a78bfa': '#c4b5fd', '#f06fc0': '#f0abfc', '#2dd4bf': '#5eead4' };
  for (const sub of state.subjects) if (OLD[sub.color]) sub.color = OLD[sub.color];
  if (user?.displayName && !ui.suggestName) ui.suggestName = user.displayName.split(' ')[0];
  route = { name: state.profile ? 'plan' : 'onboarding', params: {} };
  // Nach einem Update wieder auf dieselbe Seite zurück
  try {
    const saved = JSON.parse(sessionStorage.getItem('lernki-route') || 'null');
    sessionStorage.removeItem('lernki-route');
    if (saved && state.profile && !['onboarding', 'login'].includes(saved.name)) route = saved;
  } catch {}
  draft = null;
  render();
}

let authStarted = false;
async function handleUser(user) {
  if (!user) {
    if (bootedUid) { location.reload(); return; } // abgemeldet
    if (ui.localOnly) return;
    route = { name: 'login', params: {} };
    render();
    return;
  }
  if (bootedUid === user.uid) return;
  bootedUid = user.uid;
  ui.localOnly = false;
  try { localStorage.setItem('lernki-last-uid', user.uid); localStorage.setItem('lernki-last-email', user.email || ''); } catch {}
  app.replaceChildren(h('div', { class: 'boot' }, mascot(90), h('p', { class: 'muted' }, 'Lade deine Daten …')));
  await useAccount(user.uid); // übernimmt beim ersten Mal die Daten ohne Konto
  await loadState();
  // Neuere Daten von einem anderen Gerät holen (max. 10 s warten, dann im Hintergrund weiter)
  let booted = false;
  const synced = startSync(user, { info: () => ({
    version: APP_VERSION, klasse: state.profile?.grade ? `${state.profile.grade}${xp().klasse ? ` (${xp().klasse})` : ''}` : (xp().klasse || ''),
    counts: { faecher: state.subjects.length, klausuren: state.exams.length, vokabellisten: (state.vocab?.sets || []).length, blaetter: (state.solved || []).length, dateien: Object.keys(state.files || {}).length, stunden: (state.timetable?.lessons || []).length },
    ki: state.settings?.provider === 'openai' ? 'anderer Anbieter' : state.settings?.apiKey ? 'Gemini' : 'nicht eingerichtet',
  }), onConflict: (remote) => new Promise((done) => {
    ui.conflictOpen = true;
    const resolve = (v) => { ui.conflictOpen = false; app.replaceChildren(h('div', { class: 'boot' }, mascot(90), h('p', { class: 'muted' }, 'Gleiche ab …'))); done(v); };
    const when = new Date(remote.updatedAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const box = h('div', { class: 'boot' }, mascot(80),
      h('h2', { class: 'display' }, 'Welche Daten behalten?'),
      h('p', { class: 'muted', style: { maxWidth: '420px' } }, `Auf diesem Gerät gibt es schon Daten (${state.profile?.name || 'Profil'}, ${state.exams.length} Klausuren). In deinem Konto liegen andere Daten (zuletzt gespeichert ${when}). Was soll ab jetzt überall gelten?`),
      h('button', { class: 'btn primary', onclick: () => resolve('remote') }, 'Daten aus dem Konto nehmen'),
      h('button', { class: 'btn', onclick: () => resolve('local') }, 'Daten von diesem Gerät nehmen'),
      h('p', { class: 'muted small', style: { maxWidth: '420px' } }, 'Tipp: Mach vorher unter Mehr → Datensicherung ein Backup, wenn du unsicher bist.'));
    app.replaceChildren(box);
  }), onRemoteApplied: async () => {
    if (!booted) return;
    const keep = route;
    await loadState();
    route = state.profile ? (['onboarding', 'login'].includes(keep.name) ? { name: 'plan', params: {} } : keep) : { name: 'onboarding', params: {} };
    render();
    toast('Neuer Stand von deinem anderen Gerät geladen.', 'ok');
  }, onBackground: (items) => {
    if (!booted) return;
    const here = route;
    const ids = items.map((x) => x.id);
    const p = route.params || {};
    const mine = (route.name === 'session' && ids.includes(p.unitId)) || (route.name === 'vset' && ids.includes(`v_${p.id}`)) || (route.name === 'solved' && ids.includes(`s_${p.id}`));
    if (mine) jellyTransition(() => { if (route === here) render(); });
    else if (['plan', 'pick', 'vocab', 'subjects', 'subject', 'vtests'].includes(route.name)) render();
    const counts = {};
    for (const x of items) counts[x.label || 'Inhalt'] = (counts[x.label || 'Inhalt'] || 0) + 1;
    const txt = Object.entries(counts).map(([l, n]) => (n > 1 ? `${n}× ${l}` : l)).join(', ');
    toast(`Jelly hat im Hintergrund weitergearbeitet: ${txt}.`, 'ok');
  } });
  const started = Date.now();
  await Promise.race([synced, new Promise((r) => { const t = setInterval(() => { if (!ui.conflictOpen && Date.now() - started > 10000) { clearInterval(t); r(); } }, 300); })]);
  await boot(user);
  booted = true;
  // Einmaliger, offener Hinweis: Der Betreiber kann Inhalte einsehen
  try {
    const k = `lernki-einsicht-${user.uid}`;
    if (!localStorage.getItem(k)) {
      setTimeout(() => {
        const o = sheet('Kurzer Hinweis', [
          h('p', {}, 'Der Betreiber dieser Jelly-Version kann in einer Übersicht dein Konto und deine Inhalte lesen (Lernzettel, Aufgaben, Vokabeln, Stundenplan, hochgeladene Dateien). Ändern kann er nichts, deine KI-Schlüssel sieht er nicht.'),
          h('p', { class: 'muted small' }, 'Details unter Mehr → Datenschutz. Ohne Konto bleibt alles nur auf deinem Gerät.'),
          h('button', { class: 'btn primary block', onclick: () => { try { localStorage.setItem(k, '1'); } catch {} o.remove(); } }, 'Verstanden')]);
      }, 1500);
    }
  } catch {}
}

async function startAuth() {
  if (authStarted) return;
  authStarted = true;
  await initAuth(handleUser);
}

// Für alle, die bisher ohne Konto lernen: freiwillig anmelden (Daten wandern ins Konto).
async function openAccountSetup() {
  ui.localOnly = true; // Abbrechen führt zurück in die App
  ui.loginMode = 'login';
  route = { name: 'login', params: {} };
  render();
  try { await startAuth(); } catch { toast('Für die Anmeldung brauchst du Internet.', 'error'); }
}

(async function init() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
  setTimeout(checkForUpdate, 0); // erst nachdem das Modul fertig geladen ist
  if (!authEnabled) { await boot(null); return; }
  // Wer die App schon ohne Konto nutzt (Daten vorhanden), wird nicht nach Anmeldung gefragt.
  let lastUid = null;
  try { lastUid = localStorage.getItem('lernki-last-uid'); } catch {}
  if (!lastUid && await hasLocalProfile()) { ui.localOnly = true; await boot(null); return; }
  app.replaceChildren(h('div', { class: 'boot' }, mascot(90), h('p', { class: 'muted' }, 'Lade …')));
  try {
    await startAuth();
  } catch (e) {
    // Offline beim Start: zuletzt angemeldetes Konto auf diesem Gerät öffnen
    let last = null;
    try { last = localStorage.getItem('lernki-last-uid'); } catch {}
    if (last) { bootedUid = last; await useAccount(last); await boot(null); toast('Offline – du bist mit deinem letzten Konto angemeldet.'); }
    else app.replaceChildren(h('div', { class: 'boot' }, mascot(90), h('p', {}, 'Für die erste Anmeldung brauchst du Internet.'), h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Nochmal versuchen')));
  }
})();

// ---------- Updates: Die App auf dem Home-Bildschirm läuft oft im Hintergrund weiter.
// Beim Zurückkehren wird geprüft, ob eine neue Version online ist, und ein Update angeboten.
let updateShown = false;
async function checkForUpdate() {
  if (updateShown || !navigator.onLine) return;
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const { version } = await res.json();
    if (!version || version === APP_VERSION) return;
    updateShown = true;
    const bar = h('button', { class: 'update-bar', onclick: async () => {
      bar.textContent = 'Lade Update …';
      try { sessionStorage.setItem('lernki-route', JSON.stringify(['session', 'vquiz', 'newExam', 'vnew', 'prepare'].includes(route.name) ? { name: 'plan', params: {} } : route)); } catch {}
      try { const reg = await navigator.serviceWorker?.getRegistration(); await reg?.update(); } catch {}
      setTimeout(() => location.reload(), 300);
    } }, icon('download', 18), h('span', {}, `Neue Version ${version} – tippen zum Aktualisieren`));
    add(document.body, bar);
  } catch {}
}

initNotes({ go, render, sheet, menuRow, subjectById, ui });

// Für die Konsole/Tests
window.__lernki = { state: () => state, md, save, putBlob };
