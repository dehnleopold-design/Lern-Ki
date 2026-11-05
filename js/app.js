import { state, loadState, save, replaceState, clearAll, allBlobs, putBlob, uid } from './store.js';
import { generate, aiReady, listGeminiModels, pickDefaultModel, AIError, onAIStatus } from './ai.js';
import { addFile, removeFile, filePart, thumbURL, pickFiles } from './files.js';
import * as P from './prompts.js';
import { gradeLabel, gradeOptions, percentToGrade, reachesTarget, scale } from './grades.js';
import { downloadLernzettel } from './pdf.js';
import { h, add, md, mdEl, mascot, speech, icon, toast, confirmDialog, isoDate, parseISO, fmtDate, relDay } from './ui.js';

const APP_VERSION = '1.4 (5.11.)';
const app = document.getElementById('app');

// ---------------------------------------------------------------- Konstanten
const DEFAULT_SUBJECTS = [
  ['Deutsch', 'DE', '#5b9dff'], ['Mathe', 'MA', '#ff9f5a'], ['Englisch', 'EN', '#5b9dff'],
  ['Geography', 'GEO', '#ff7a59', 'en'], ['Biologie', 'BIO', '#3dd68c'], ['Chemie', 'CH', '#3dd68c'],
  ['Physik', 'PH', '#3dd68c'], ['Geschichte', 'GE', '#e0a458'], ['Politik-Gesellschaft-Wirtschaft', 'PGW', '#ff7a59'],
  ['Philosophie', 'PHI', '#a78bfa'], ['Theater', 'TH', '#f06fc0'], ['Sport', 'SP', '#2dd4bf'], ['Athletik', 'ATH', '#2dd4bf'],
];
const EXTRA_SUBJECTS = ['Spanisch', 'Französisch', 'Latein', 'Informatik', 'Kunst', 'Musik', 'Religion', 'Ethik', 'Wirtschaft', 'Erdkunde', 'Psychologie', 'Pädagogik'];
const STATES = ['Baden-Württemberg', 'Bayern', 'Berlin', 'Brandenburg', 'Bremen', 'Hamburg', 'Hessen', 'Mecklenburg-Vorpommern', 'Niedersachsen', 'Nordrhein-Westfalen', 'Rheinland-Pfalz', 'Saarland', 'Sachsen', 'Sachsen-Anhalt', 'Schleswig-Holstein', 'Thüringen'];
const SCHOOL_TYPES = ['Gymnasium', 'Stadtteilschule', 'Gesamtschule', 'Realschule', 'Oberschule', 'Berufliche Schule', 'Andere'];
const LEARN_STYLES = ['Kurze Erklärungen', 'Aufgaben selbst lösen', 'Probeklausuren', 'Abfragen lassen', 'Selbst erklären (wie mündlich)', 'Beispiele & Musterlösungen'];
const SECTION_COLORS = ['#3dd68c', '#5b9dff', '#f06fc0', '#ff9f5a', '#a78bfa', '#2dd4bf'];
const UNIT_ICON = { lernzettel: 'file', quiz: 'quiz', aufgaben: 'pencil', gesamtzettel: 'book', probeklausur: 'exam', verstehen: 'book', ueben: 'pencil', anwenden: 'bulb' };
const UNIT_LABEL = { lernzettel: 'Schritt 1 · Lernzettel', quiz: 'Schritt 2 · Quiz', aufgaben: 'Schritt 3 · Anwenden', gesamtzettel: 'Abschluss · Gesamt-Lernzettel', probeklausur: 'Abschluss · Probeklassenarbeit', verstehen: 'Verstehen', ueben: 'Üben', anwenden: 'Anwenden' };
const PALETTE = ['#5b9dff', '#ff9f5a', '#3dd68c', '#f06fc0', '#a78bfa', '#2dd4bf', '#e0a458', '#ff7a59'];

// ---------------------------------------------------------------- Routing
let route = { name: 'plan', params: {} };
const ui = { selectedUnit: null, busy: {} };

function go(name, params = {}) {
  route = { name, params };
  render();
  window.scrollTo(0, 0);
}

function render() {
  app.replaceChildren();
  if (!state.profile && route.name !== 'onboarding') route = { name: 'onboarding', params: {} };
  const views = { onboarding: viewOnboarding, plan: viewPlan, newExam: viewNewExam, session: viewSession, subjects: viewSubjects, subject: viewSubject, tutor: viewTutor, settings: viewSettings };
  const v = (views[route.name] || viewPlan)(route.params);
  add(app, v);
}

function tabbar(active) {
  const tab = (name, ic, label) => h('button', { class: `tab ${active === name ? 'active' : ''}`, onclick: () => go(name), 'aria-label': label }, icon(ic, 24), h('span', {}, label));
  return h('nav', { class: 'tabbar' }, tab('plan', 'target', 'Plan'), tab('subjects', 'folder', 'Fächer'), tab('tutor', 'chat', 'Tutor'), tab('settings', 'gear', 'Einstellungen'));
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
      name: p?.name || '', grade: p?.grade || '', schoolType: p?.schoolType || 'Gymnasium', state: p?.state || '',
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
      q: editing ? 'Lass uns dein Profil aktualisieren.' : 'Hi! Ich bin Kiri. Bevor wir loslegen, stelle ich dir ein paar Fragen – damit dein Lernplan wirklich zu dir passt.',
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
      s.language = d.english.includes(name) ? 'en' : 'de';
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
      s.provider === 'gemini' ? geminiBlock() : openaiBlock());
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
      !compact ? h('p', { class: 'muted small' }, 'Wichtig: Laut Googles Bedingungen muss der Kontoinhaber volljährig sein – ggf. erstellt ein Elternteil den Schlüssel. In der kostenlosen Stufe darf Google Eingaben zur Verbesserung seiner Dienste nutzen. Lade daher keine sensiblen Daten hoch.') : null,
      keyInput, testBtn, h('div', { class: 'label' }, 'Modell'), select, status,
      compact ? h('p', { class: 'muted small' }, 'Hinweis: Google verlangt Volljährigkeit für den API-Schlüssel – ggf. macht das ein Elternteil. Kostenlose Stufe: Google darf Eingaben auswerten, also keine sensiblen Daten hochladen.') : null);
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

function allUnits(exam) {
  return (exam.plan?.abschnitte || []).flatMap((s, si) => s.einheiten.map((u) => ({ ...u, _section: si })));
}

function viewPlan() {
  const exam = activeExam();
  const screen = h('div', { class: 'screen with-tabs' });
  if (!exam) {
    add(screen, 
      h('header', { class: 'topbar' }, h('span', { class: 'iconbtn-spacer' }), h('div', { class: 'topbar-title' }, `Hi ${state.profile.name}!`), h('span', { class: 'iconbtn-spacer' })),
      h('main', { class: 'content narrow center' },
        mascot(140),
        h('h1', { class: 'display' }, 'Welche Klausur steht an?'),
        h('p', { class: 'muted' }, 'Leg eine Klausur an, lade deine Arbeitsblätter hoch – ich baue dir daraus einen Lernplan mit prüfungsnahen Aufgaben.'),
        h('button', { class: 'btn primary', onclick: () => startNewExam() }, 'Klausur anlegen')),
      tabbar('plan'));
    return screen;
  }

  const subject = subjectById(exam.subjectId);
  const units = allUnits(exam);
  const current = units.find((u) => u.status === 'open' || !u.status);
  const selected = units.find((u) => u.id === ui.selectedUnit) || current || units[units.length - 1];
  const done = units.filter((u) => u.status === 'done').length;
  const abschlussUnit = units.find((u) => (exam.plan?.abschnitte || [])[u._section]?.abschluss);

  const header = h('header', { class: 'topbar' },
    h('div', { class: 'streak' }, icon('check', 18), h('span', {}, `${done}/${units.length}`)),
    h('button', { class: 'exam-switch', onclick: () => examSheet() }, h('span', {}, exam.plan?.titel || `${subject?.name} Klausur`), icon('updown', 18)),
    h('button', { class: 'iconbtn', onclick: () => examMenu(exam), 'aria-label': 'Menü' }, h('span', { class: 'dots' }, '⋮')));

  const info = h('section', { class: 'card info-card' },
    h('div', { class: 'row between' },
      h('div', { class: 'row gap' }, subject ? subjectBadge(subject, 36) : null,
        h('div', {}, h('div', { class: 'strong' }, subject?.name || ''), h('div', { class: 'muted small' }, exam.date ? `${fmtDate(exam.date)} · ${relDay(exam.date)}` : 'Kein Termin'))),
      h('div', { class: 'target' }, icon('target', 18), gradeLabel(exam.targetGrade))),
    exam.plan?.themenUebersicht ? h('details', { class: 'details' }, h('summary', {}, 'Was drankommt'), mdEl(exam.plan.themenUebersicht),
      exam.plan.luecken?.length ? h('div', { class: 'warn' }, h('strong', {}, 'Lücken im Material – kläre das mit deiner Lehrkraft oder lade mehr hoch:'), h('ul', {}, exam.plan.luecken.map((l) => h('li', {}, l)))) : null) : null,
    exam.lastResult ? h('div', { class: 'muted small' }, `Letztes Ergebnis: ${exam.lastResult.percent} % ≈ ${gradeLabel(exam.lastResult.grade)} (Schätzung)`) : null,
    abschlussUnit ? h('button', { class: 'pill jump', onclick: () => { ui.selectedUnit = abschlussUnit.id; render(); setTimeout(() => document.querySelector('.node.selected')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50); } }, icon('flag', 16), 'Direkt zum Abschluss') : null,
    exam.plan && !exam.plan.themen ? h('div', { class: 'warn small' }, 'Dieser Plan hat noch das alte Format. Über ⋮ → „Plan neu erstellen“ bekommst du Lernzettel, Quiz und Abschluss.') : null);

  const path = h('div', { class: 'path' });
  let gi = 0;
  (exam.plan?.abschnitte || []).forEach((sec, si) => {
    const color = SECTION_COLORS[si % SECTION_COLORS.length];
    const secSkipped = sec.einheiten.every((u) => u.status === 'skipped');
    add(path, h('button', { class: `section-banner ${secSkipped ? 'skipped' : ''} ${sec.abschluss ? 'final' : ''}`, style: { background: sec.abschluss ? undefined : color }, onclick: () => sectionMenu(exam, sec) },
      h('span', { class: 'row gap' }, sec.abschluss ? icon('flag', 22) : null, h('span', {}, sec.titel)),
      h('span', { class: 'banner-hint' }, secSkipped ? 'übersprungen' : sec.abschluss ? 'jederzeit offen' : '', icon('skip', 18))));
    let lastDay = null;
    sec.einheiten.forEach((u) => {
      const x = Math.round(Math.sin(gi * 0.9) * 70);
      gi++;
      const isCurrent = current && u.id === current.id;
      const isSel = selected && u.id === selected.id;
      if (u.tag && u.tag !== lastDay) { add(path, h('div', { class: 'day-label' }, `${relDay(u.tag)} · ${fmtDate(u.tag)}`)); lastDay = u.tag; }
      const node = h('button', {
        class: `node ${u.status === 'done' ? 'done' : ''} ${u.status === 'skipped' ? 'skipped' : ''} ${isSel ? 'selected' : ''} ${isCurrent ? 'current' : ''}`,
        style: { '--c': sec.abschluss ? '#ffd166' : color, transform: `translateX(${x}px)` },
        onclick: () => { ui.selectedUnit = u.id; render(); },
        'aria-label': u.titel,
      }, icon(u.status === 'done' ? 'check' : u.status === 'skipped' ? 'skip' : UNIT_ICON[u.typ] || 'pencil', 30));
      const row = h('div', { class: 'node-row' }, node);
      if (isCurrent) { const m = mascot(56, 'side'); m.classList.add('node-mascot'); m.style.transform = `translateX(${x + 62}px)`; add(row, m); }
      add(path, row);
    });
  });

  const selColor = selected ? ((exam.plan.abschnitte[selected._section]?.abschluss) ? '#ffd166' : SECTION_COLORS[selected._section % SECTION_COLORS.length]) : '#3dd68c';
  const bottom = selected ? h('div', { class: 'bottom-card', style: { '--c': selColor } },
    h('div', { class: 'muted small' }, `${UNIT_LABEL[selected.typ] || ''}${selected.tag ? ` · ${relDay(selected.tag)}` : ''}${selected.score !== undefined ? ` · zuletzt ${selected.score} %` : ''}`),
    h('div', { class: 'bottom-title' }, selected.titel),
    selected.ziel ? h('div', { class: 'muted small' }, selected.ziel) : null,
    h('button', { class: 'btn light block', onclick: () => go('session', { examId: exam.id, unitId: selected.id }) },
      selected.status === 'done' ? (/zettel/.test(selected.typ) ? 'Nochmal ansehen' : 'Wiederholen') : state.sessions[selected.id] ? 'Fortsetzen' : current && selected.id !== current.id ? 'Vorspringen' : 'Starten'),
    selected.status === 'skipped'
      ? h('button', { class: 'link-small', onclick: () => { setUnitStatus(exam, [selected.id], 'open'); render(); } }, 'Wieder in den Plan aufnehmen')
      : selected.status !== 'done' && !exam.plan.abschnitte[selected._section]?.abschluss ? h('button', { class: 'link-small', onclick: () => { setUnitStatus(exam, [selected.id], 'skipped'); ui.selectedUnit = null; render(); } }, h('span', { class: 'row gap center' }, icon('skip', 16), 'Überspringen')) : null) : null;

  add(screen, header, h('main', { class: 'content narrow' }, info, units.length ? path : h('div', { class: 'card' }, h('p', {}, 'Für diese Klausur gibt es noch keinen Plan.'), h('button', { class: 'btn primary', onclick: () => rebuildPlan(exam) }, 'Plan erstellen'))), bottom, tabbar('plan'));
  return screen;
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
    sec.abschluss ? h('p', { class: 'muted' }, 'Der Abschluss ist immer erreichbar – auch wenn du Themen noch nicht gemacht hast.') : null,
    exam.plan?.themen?.[sec.themaIndex]?.beschreibung ? h('p', { class: 'muted' }, exam.plan.themen[sec.themaIndex].beschreibung) : null,
    h('div', { class: 'list' },
      h('button', { class: 'list-item', onclick: () => { o.remove(); ui.selectedUnit = sec.einheiten.find((u) => u.status !== 'done')?.id || ids[0]; render(); setTimeout(() => document.querySelector('.node.selected')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50); } }, 'Zu diesem Thema springen'),
      anyOpen && !sec.abschluss ? h('button', { class: 'list-item', onclick: () => { setUnitStatus(exam, ids, 'skipped'); o.remove(); ui.selectedUnit = null; render(); } }, h('span', { class: 'row gap' }, icon('skip', 18), 'Ganzes Thema überspringen')) : null,
      anySkipped ? h('button', { class: 'list-item', onclick: () => { setUnitStatus(exam, sec.einheiten.filter((u) => u.status === 'skipped').map((u) => u.id), 'open'); o.remove(); render(); } }, 'Thema wieder aufnehmen') : null),
  ]);
}

function nextOpenUnit(exam, afterId) {
  const units = allUnits(exam);
  const i = units.findIndex((u) => u.id === afterId);
  return units.slice(i + 1).find((u) => u.status === 'open' || !u.status) || null;
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
  const o = sheet('Klausur', [
    h('div', { class: 'list' },
      h('button', { class: 'list-item', onclick: () => { o.remove(); editExamMaterial(exam); } }, 'Material hinzufügen / Themen ändern'),
      h('button', { class: 'list-item', onclick: async () => { o.remove(); if (await confirmDialog('Plan neu erstellen? Fortschritt in diesem Plan geht verloren, deine Schwächen-Liste bleibt.', 'Neu erstellen')) rebuildPlan(exam); } }, 'Plan neu erstellen'),
      h('button', { class: 'list-item', onclick: () => { o.remove(); changeDate(exam); } }, 'Datum / Zielnote ändern'),
      h('button', { class: 'list-item danger-text', onclick: async () => {
        o.remove();
        if (!(await confirmDialog('Diese Klausur samt Plan löschen? Hochgeladenes Material wird ebenfalls gelöscht.', 'Löschen'))) return;
        for (const id of exam.materialIds || []) await removeFile(id);
        for (const u of allUnits(exam)) delete state.sessions[u.id];
        delete state.tutor[exam.id];
        state.exams = state.exams.filter((e) => e.id !== exam.id);
        state.activeExamId = null; save(); render();
      } }, 'Klausur löschen')),
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
    run(i) { steps.forEach((x, j) => { if (j < i) x.state = 'done'; }); if (steps[i]) steps[i].state = 'run'; draw(); },
    done(i) { if (steps[i]) steps[i].state = 'done'; draw(); },
    fail(i) { if (steps[i]) steps[i].state = 'fail'; draw(); },
  };
}

// ================================================================ NEUE KLAUSUR (Ablauf wie in den Screenshots)
let nx = null;

function startNewExam(subjectId = null) {
  nx = { step: subjectId ? 1 : 0, subjectId, date: undefined, targetGrade: scale() === '0-15' ? 13 : 1, materialIds: [], topicsText: '', useArchive: true, customDate: false };
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
        if (!f) continue;
        const url = await thumbURL(id);
        tiles.push(h('div', { class: 'tile filled' },
          url ? h('img', { src: url, alt: f.name }) : h('div', { class: 'tile-file' }, icon('file', 34), h('span', {}, f.name)),
          f.digest ? h('span', { class: 'tile-ok' }, icon('check', 14)) : null,
          h('button', { class: 'tile-del', 'aria-label': 'Entfernen', onclick: async () => { nx.materialIds = nx.materialIds.filter((x) => x !== id); await removeFile(id); drawGrid(); } }, icon('close', 16))));
      }
      const addTile = (label, opts) => h('button', { class: 'tile', onclick: async () => {
        const files = await pickFiles(opts);
        for (const file of files) {
          try { nx.materialIds.push(await addFile(file, { kind: 'material', subjectId: nx.subjectId })); } catch (e) { toast(errorMsg(e), 'error'); }
        }
        drawGrid();
      } }, icon(opts.capture ? 'camera' : 'plus', 30), h('span', { class: 'small muted' }, label));
      tiles.push(addTile('Foto aufnehmen', { accept: 'image/*', capture: 'environment', multiple: false }), addTile('Dateien / PDF', {}));
      grid.replaceChildren(...tiles);
    };
    drawGrid();
    const archiveCount = subject?.archive?.length || 0;
    return h('div', { class: 'screen' }, bar(3),
      h('main', { class: 'content narrow' },
        speech(`Welche Themen kommen in deiner ${subject?.name}-Klausur dran?`),
        h('div', { class: 'label' }, 'Lernmaterial hinzufügen (Arbeitsblätter, Lernzettel, Heft, Buchseiten)'),
        grid,
        h('div', { class: 'label' }, 'Themen laut Lehrkraft (optional, aber hilfreich)'),
        h('textarea', { class: 'input', rows: 3, placeholder: 'z. B. „Klimazonen, Monsun, Klimadiagramme auswerten – Kapitel 3 im Buch“', value: nx.topicsText, oninput: (e) => { nx.topicsText = e.target.value; } }),
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
    const panel = waitPanel('Ich lese deine Unterlagen und baue deinen Plan …');
    const screen = h('div', { class: 'screen' }, topbar({ close: cancel }), h('main', { class: 'content narrow' }, panel.el));
    processExam(panel);
    return screen;
  }
  return h('div');
}

async function digestFile(id) {
  const f = state.files[id];
  if (!f || f.digest) return;
  const subject = subjectById(f.subjectId);
  const part = await filePart(id);
  f.digest = await generate({ system: P.baseSystem(subject), parts: [{ text: P.digestPrompt(f.kind) }, part], json: true, temperature: 0.1 });
  save();
}

async function processExam(panel) {
  const subject = subjectById(nx.subjectId);
  const ids = [...nx.materialIds];
  if (nx.useArchive && subject) ids.push(...(subject.archive || []));
  const needProfile = nx.useArchive && subject?.archive?.length && !subject.teacherProfile;
  const labels = [
    ...ids.map((id) => `${state.files[id]?.kind === 'archive' ? 'Alte Klausur' : 'Lese'}: ${state.files[id]?.digest?.titel || state.files[id]?.name || 'Datei'}`),
    ...(needProfile ? ['Stil deiner Lehrkraft analysieren'] : []),
    'Lernplan erstellen',
  ];
  panel.setSteps(labels);
  let step = 0;
  try {
    for (const id of ids) {
      panel.run(step);
      await digestFile(id);
      panel.done(step++);
    }
    if (needProfile) {
      panel.run(step);
      subject.teacherProfile = await generate({ system: P.baseSystem(subject), parts: [{ text: P.teacherProfilePrompt(subject) }], temperature: 0.2 });
      save();
      panel.done(step++);
    }
    let exam = nx.editId ? examById(nx.editId) : null;
    if (!exam) {
      exam = { id: uid(), subjectId: nx.subjectId, createdAt: Date.now(), weaknesses: [] };
      state.exams.push(exam);
      nx.editId = exam.id; // bei Fehler + "Nochmal" keine doppelte Klausur
    }
    Object.assign(exam, { date: nx.date ?? null, targetGrade: nx.targetGrade, materialIds: nx.materialIds, topicsText: nx.topicsText, useArchive: nx.useArchive });
    state.activeExamId = exam.id;
    save();
    panel.run(step);
    await createPlan(exam);
    panel.done(step);
    nx = null;
    ui.selectedUnit = null;
    toast('Dein Plan ist fertig!', 'ok');
    go('plan');
  } catch (e) {
    panel.fail(step);
    panel.errBox.replaceChildren(h('div', { class: 'card warn' }, h('p', {}, errorMsg(e)),
      h('p', { class: 'muted small' }, 'Schon Gelesenes ist gespeichert – beim nächsten Versuch geht es dort weiter.'),
      h('div', { class: 'row gap center' },
        h('button', { class: 'btn', onclick: () => render() }, 'Nochmal versuchen'),
        h('button', { class: 'btn ghost', onclick: () => { nx.step = 4; render(); } }, 'Zurück'))));
  }
}

function learningDays(exam) {
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

async function createPlan(exam) {
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
  save();
}

async function rebuildPlan(exam) {
  const o = sheet('Plan wird erstellt …', [h('div', { class: 'center' }, mascot(90, 'think')), h('p', { class: 'muted center' }, 'Einen Moment.')]);
  try { await createPlan(exam); ui.selectedUnit = null; toast('Neuer Plan erstellt.', 'ok'); } catch (e) { toast(errorMsg(e), 'error'); }
  o.remove();
  render();
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
  const screen = h('div', { class: 'screen' }, topbar({ back: () => go('plan'), title: unit.titel }));
  const main = h('main', { class: 'content narrow' });
  add(screen, main);
  if (unit.typ === 'lernzettel' || unit.typ === 'gesamtzettel') { viewLernzettel(main, exam, unit); return screen; }
  if (unit.typ === 'quiz') { viewQuiz(main, exam, unit); return screen; }

  if (!sess?.aufgaben) {
    const err0 = ui.busy[`err:${unitId}`];
    if (!err0) {
      const panel = waitPanel(unit.typ === 'probeklausur' ? 'Ich baue dir eine Probeklassenarbeit im Stil deiner Lehrkraft …' : 'Ich denke mir Anwendungsaufgaben aus – im Stil deiner Lehrkraft …');
      panel.setSteps(['Material & Lehrerprofil auswerten', 'Aufgaben formulieren']);
      panel.run(1);
      add(main, panel.el);
    }
    const err = ui.busy[`err:${unitId}`];
    if (err) {
      add(main, h('div', { class: 'card warn' }, h('p', {}, err)),
        h('button', { class: 'btn primary block', onclick: () => { delete ui.busy[`err:${unitId}`]; render(); } }, 'Nochmal versuchen'));
      return screen;
    }
    if (!ui.busy[unitId]) {
      ui.busy[unitId] = true;
      const prev = Object.values(state.sessions).filter((s) => s.examId === examId).flatMap((s) => (s.aufgaben || []).map((a) => a.aufgabe.slice(0, 120)));
      const topic = exam.plan?.themen?.[unit.themaIndex];
      const lz = topic ? lernzettelText(exam, unit.themaIndex) : null;
      generate({ system: P.baseSystem(subject), parts: [{ text: P.sessionPrompt(exam, unit, prev, { topic, lernzettel: lz }) }], json: true, temperature: 0.7 })
        .then((res) => {
          const aufgaben = (res.aufgaben || []).map((a, i) => ({ ...a, id: a.id || `a${i + 1}`, punkte: Number(a.punkte) || 4 }));
          if (!aufgaben.length) throw new AIError('Keine Aufgaben erhalten. Bitte nochmal versuchen.');
          state.sessions[unitId] = { examId, input: res.input || '', zeitMinuten: res.zeitMinuten || null, aufgaben, answers: {}, answerImages: {}, grading: null, chats: {}, startedAt: Date.now() };
          save();
        })
        .catch((e) => { ui.busy[`err:${unitId}`] = errorMsg(e); })
        .finally(() => { delete ui.busy[unitId]; if (route.name === 'session' && route.params.unitId === unitId) render(); });
    }
    return screen;
  }

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
      try { await gradeSession(exam, unit, sess); } catch (e) { toast(errorMsg(e), 'error'); }
      overlay.remove();
      render();
    } }, 'Abgeben & korrigieren lassen');
    add(main, submit);
  } else {
    add(main, h('div', { class: 'stack' },
      h('button', { class: 'btn primary block', onclick: () => { markDone(exam, unit.id, sess); const n = nextOpenUnit(exam, unit.id); if (n) ui.selectedUnit = n.id; go('plan'); } }, 'Einheit abschließen'),
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
      items.push(h('div', { class: 'photo' }, url ? h('img', { src: url }) : null,
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
function lernzettelText(exam, themaIndex) {
  const sec = (exam.plan?.abschnitte || []).find((x) => x.themaIndex === themaIndex && !x.abschluss);
  const u = sec?.einheiten.find((x) => x.typ === 'lernzettel');
  return u ? state.sessions[u.id]?.lernzettel || null : null;
}

// Startet eine KI-Erzeugung einmal, zeigt solange den Warte-Bildschirm und bei Fehlern "Nochmal".
function pending(main, key, title, steps, producer) {
  const err = ui.busy[`err:${key}`];
  if (err) {
    add(main, h('div', { class: 'card warn' }, h('p', {}, err)),
      h('button', { class: 'btn primary block', onclick: () => { delete ui.busy[`err:${key}`]; render(); } }, 'Nochmal versuchen'));
    return;
  }
  const panel = waitPanel(title);
  panel.setSteps(steps);
  panel.run(steps.length - 1);
  add(main, panel.el);
  if (ui.busy[key]) return;
  ui.busy[key] = true;
  const here = route.params.unitId;
  producer()
    .then(() => save())
    .catch((e) => { ui.busy[`err:${key}`] = errorMsg(e); })
    .finally(() => { delete ui.busy[key]; if (route.name === 'session' && route.params.unitId === here) render(); });
}

function viewLernzettel(main, exam, unit) {
  const subject = subjectById(exam.subjectId);
  const overall = unit.typ === 'gesamtzettel';
  const topic = overall ? null : exam.plan?.themen?.[unit.themaIndex];
  const sess = state.sessions[unit.id];
  if (!sess?.lernzettel) {
    pending(main, unit.id, overall ? 'Ich fasse die ganze Klausur auf einem Lernzettel zusammen …' : `Ich schreibe deinen Lernzettel zu „${topic?.titel || unit.titel}“ …`,
      ['Material & Lehrerprofil auswerten', 'Lernzettel schreiben'],
      async () => {
        const text = await generate({ system: P.baseSystem(subject), parts: [{ text: P.lernzettelPrompt(exam, topic || { titel: unit.titel }, overall) }], temperature: 0.3 });
        state.sessions[unit.id] = { examId: exam.id, lernzettel: text, createdAt: Date.now() };
      });
    return;
  }
  const title = overall ? `${subject?.name}: Gesamt-Lernzettel` : `${subject?.name}: ${topic?.titel || unit.titel}`;
  const subtitle = `Lernzettel${exam.date ? ` · Klausur am ${fmtDate(exam.date)}` : ''} · erstellt mit Lern-KI`;
  const dl = h('button', { class: 'btn', onclick: async () => {
    dl.disabled = true; const old = dl.textContent; dl.textContent = 'Erstelle PDF …';
    try { await downloadLernzettel(title, subtitle, sess.lernzettel); } catch (e) { toast(errorMsg(e), 'error'); }
    dl.disabled = false; dl.textContent = old;
  } }, icon('download', 18), 'Als PDF speichern');
  const next = nextOpenUnit(exam, unit.id);
  add(main,
    h('article', { class: 'card lernzettel' }, h('div', { class: 'lz-head' }, h('div', { class: 'label' }, overall ? 'Gesamt-Lernzettel' : 'Lernzettel'), h('h2', { class: 'lz-title' }, overall ? 'Die ganze Klausur' : topic?.titel || unit.titel)), mdEl(sess.lernzettel)),
    h('div', { class: 'row gap wrap center' }, dl,
      h('button', { class: 'btn ghost', onclick: async () => { if (await confirmDialog('Lernzettel neu schreiben lassen?', 'Neu schreiben')) { delete state.sessions[unit.id]; save(); render(); } } }, icon('refresh', 18), 'Neu schreiben')),
    h('button', { class: 'btn primary block', onclick: () => {
      setUnitStatus(exam, [unit.id], 'done');
      if (next && !overall) go('session', { examId: exam.id, unitId: next.id });
      else { if (next) ui.selectedUnit = next.id; go('plan'); }
    } }, overall ? 'Gelesen' : next && next.typ === 'quiz' ? 'Gelesen – weiter zum Quiz' : 'Gelesen'));
}

// Antwortvergleich fürs Eingabe-Quiz: Groß/Klein, Leerzeichen, Komma/Punkt, kleine Tippfehler, Zahlen mit 1 % Toleranz.
function normAnswer(x) {
  return String(x ?? '').toLowerCase().replace(/ß/g, 'ss').replace(/,/g, '.').replace(/[^a-z0-9äöü.\-]/g, '');
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
function checkInput(value, answers) {
  const v = normAnswer(value);
  if (!v) return false;
  return (answers || []).some((ans) => {
    const n1 = numOf(value), n2 = numOf(ans);
    if (n2 !== null && /^-?[\d.]+[a-z°%/]*$/.test(normAnswer(ans))) return n1 !== null && Math.abs(n1 - n2) <= Math.max(Math.abs(n2) * 0.01, 1e-9);
    const a = normAnswer(ans);
    return v === a || (a.length > 5 && lev(v, a) <= 1);
  });
}

function viewQuiz(main, exam, unit) {
  const subject = subjectById(exam.subjectId);
  const topic = exam.plan?.themen?.[unit.themaIndex] || { titel: unit.titel };
  let sess = state.sessions[unit.id];
  if (!sess?.fragen) {
    pending(main, unit.id, `Ich stelle dir ein Quiz zu „${topic.titel}“ zusammen …`, ['Lernzettel lesen', 'Fragen ausdenken'], async () => {
      const prev = (state.sessions[unit.id]?.alteFragen || []);
      const res = await generate({ system: P.baseSystem(subject), parts: [{ text: P.quizPrompt(exam, topic, lernzettelText(exam, unit.themaIndex), prev) }], json: true, temperature: 0.7 });
      const fragen = (res.fragen || []).filter((q) => q?.frage && ['mc', 'wahrfalsch', 'eingabe'].includes(q.typ)
        && (q.typ !== 'mc' || (Array.isArray(q.optionen) && q.optionen.length >= 2 && Number.isInteger(q.richtig))));
      if (!fragen.length) throw new AIError('Keine brauchbaren Quizfragen erhalten. Bitte nochmal versuchen.');
      state.sessions[unit.id] = { examId: exam.id, fragen, antworten: {}, idx: 0, alteFragen: [...prev, ...fragen.map((q) => q.frage.slice(0, 100))] };
    });
    return;
  }
  const qs = sess.fragen;
  const total = qs.length;

  // ---- Ergebnis
  if (sess.idx >= total) {
    const right = qs.filter((_, i) => sess.antworten[i]?.correct).length;
    const pct = Math.round((right / total) * 100);
    const wrong = qs.map((q, i) => ({ q, a: sess.antworten[i] })).filter((x) => !x.a?.correct);
    const correctText = (q) => q.typ === 'mc' ? q.optionen[q.richtig] : q.typ === 'wahrfalsch' ? (q.richtig ? 'Wahr' : 'Falsch') : `${(q.antworten || [])[0] || ''}${q.einheit ? ` ${q.einheit}` : ''}`;
    const next = nextOpenUnit(exam, unit.id);
    add(main,
      h('section', { class: `card summary ${pct >= 75 ? 'good' : 'bad'}` },
        h('div', { class: 'row between' }, h('div', {}, h('div', { class: 'big-num' }, `${right}/${total}`), h('div', { class: 'muted small' }, 'richtig')), h('div', { class: 'big-num' }, `${pct} %`)),
        h('p', {}, pct === 100 ? 'Alles richtig. Die Fakten sitzen.' : pct >= 75 ? 'Solide – schau dir die Fehler unten trotzdem an.' : 'Das sitzt noch nicht. Lies den Lernzettel nochmal und mach das Quiz erneut, bevor du an die Aufgaben gehst.')),
      wrong.length ? h('section', { class: 'card' }, h('div', { class: 'label' }, 'Das musst du dir merken'),
        h('ul', { class: 'wrong-list' }, wrong.map(({ q, a }) => h('li', {}, h('div', {}, q.frage), h('div', { class: 'small' }, h('span', { class: 'bad-text' }, `Deine Antwort: ${a?.label ?? '–'}`), ' · ', h('strong', {}, `Richtig: ${correctText(q)}`)), q.erklaerung ? h('div', { class: 'muted small' }, q.erklaerung) : null)))) : null,
      h('button', { class: 'btn primary block', onclick: () => {
        for (const sec of exam.plan.abschnitte) for (const u of sec.einheiten) if (u.id === unit.id) { u.status = 'done'; u.score = pct; }
        if (pct < 70) exam.weaknesses = [...new Set([...(exam.weaknesses || []), `Fakten/Begriffe zu „${topic.titel}“ unsicher (Quiz ${pct} %)`])].slice(-30);
        save();
        if (next) go('session', { examId: exam.id, unitId: next.id }); else go('plan');
      } }, next?.typ === 'aufgaben' ? 'Weiter zu den Anwendungsaufgaben' : 'Fertig'),
      h('div', { class: 'row gap wrap center' },
        h('button', { class: 'btn ghost', onclick: () => { sess.antworten = {}; sess.idx = 0; save(); render(); } }, 'Gleiches Quiz nochmal'),
        h('button', { class: 'btn ghost', onclick: () => { state.sessions[unit.id] = { alteFragen: sess.alteFragen }; save(); render(); } }, icon('refresh', 18), 'Neue Fragen')));
    return;
  }

  // ---- Frage
  const i = sess.idx;
  const q = qs[i];
  const ans = sess.antworten[i];
  const answer = (label, correct, value) => { sess.antworten[i] = { label, correct, value }; save(); render(); };
  const body = h('div', { class: 'quiz-body' });
  if (q.typ === 'mc') {
    add(body, h('div', { class: 'quiz-options' }, q.optionen.map((o, oi) => {
      const st = ans ? (oi === q.richtig ? 'right' : ans.value === oi ? 'wrong' : 'dim') : '';
      return h('button', { class: `quiz-opt ${st}`, disabled: !!ans, onclick: () => answer(o, oi === q.richtig, oi) }, h('span', { class: 'opt-letter' }, 'ABCD'[oi] || '•'), h('span', {}, o));
    })));
  } else if (q.typ === 'wahrfalsch') {
    add(body, h('div', { class: 'quiz-options two' }, [[true, 'Wahr'], [false, 'Falsch']].map(([v, l]) => {
      const st = ans ? (v === !!q.richtig ? 'right' : ans.value === v ? 'wrong' : 'dim') : '';
      return h('button', { class: `quiz-opt ${st}`, disabled: !!ans, onclick: () => answer(l, v === !!q.richtig, v) }, h('span', {}, l));
    })));
  } else {
    const inp = h('input', { class: `input big ${ans ? (ans.correct ? 'right' : 'wrong') : ''}`, placeholder: 'Deine Antwort', value: ans?.label || '', disabled: !!ans, onkeydown: (e) => { if (e.key === 'Enter') btn.click(); } });
    const btn = h('button', { class: 'btn primary', onclick: () => { if (!inp.value.trim()) return; answer(inp.value.trim(), checkInput(inp.value, q.antworten), inp.value.trim()); } }, 'Prüfen');
    add(body, h('div', { class: 'row gap' }, inp, q.einheit ? h('span', { class: 'muted' }, q.einheit) : null, ans ? null : btn));
    if (!ans) setTimeout(() => inp.focus(), 50);
  }
  if (ans) {
    add(body, h('div', { class: `quiz-feedback ${ans.correct ? 'right' : 'wrong'}` },
      h('strong', {}, ans.correct ? 'Richtig!' : q.typ === 'eingabe' ? `Falsch – richtig ist: ${(q.antworten || [])[0]}${q.einheit ? ` ${q.einheit}` : ''}` : 'Falsch.'),
      q.erklaerung ? h('div', {}, q.erklaerung) : null,
      !ans.correct && q.typ === 'eingabe' ? h('button', { class: 'link-small', onclick: () => { ans.correct = true; save(); render(); } }, 'Meine Antwort war doch richtig') : null));
  }
  add(main,
    h('div', { class: 'quiz-top' }, h('div', { class: 'progress' }, h('div', { class: 'progress-fill', style: { width: `${Math.round((i / total) * 100)}%` } })), h('span', { class: 'muted small' }, `${i + 1}/${total}`)),
    h('section', { class: 'card quiz-card' },
      h('div', { class: 'label' }, q.typ === 'wahrfalsch' ? 'Wahr oder falsch?' : q.typ === 'eingabe' ? 'Antwort eintippen' : 'Wähle die richtige Antwort'),
      h('div', { class: 'quiz-q' }, q.frage), body),
    ans ? h('button', { class: 'btn primary block', onclick: () => { sess.idx = i + 1; save(); render(); } }, i + 1 < total ? 'Weiter' : 'Ergebnis ansehen') : null);
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
      h('p', { class: 'muted small' }, 'Lade pro Fach alte Klausuren hoch. Daraus erstelle ich ein Lehrerprofil – Aufgaben und Korrektur richten sich dann nach deiner Lehrkraft.'),
      h('div', { class: 'list' }, state.subjects.map((s) => h('button', { class: 'list-item big', onclick: () => go('subject', { id: s.id }) },
        h('span', { class: 'row gap' }, subjectBadge(s), h('span', {}, s.name, s.language === 'en' ? h('span', { class: 'tag' }, 'EN') : null)),
        h('span', { class: 'muted small' }, `${(s.archive || []).length} Klausuren`, s.teacherProfile ? ' · Profil ✓' : '')))),
      h('button', { class: 'btn ghost block', onclick: () => addSubjectDialog() }, h('span', { class: 'row gap center' }, icon('plus'), 'Fach hinzufügen'))),
    tabbar('subjects'));
}

function viewSubject({ id }) {
  const s = subjectById(id);
  if (!s) { go('subjects'); return h('div'); }
  const archiveList = h('div', { class: 'list' });
  const drawArchive = () => {
    archiveList.replaceChildren(...(s.archive || []).map((fid) => {
      const f = state.files[fid];
      if (!f) return null;
      const st = ui.busy[fid] ? 'liest …' : f.digest ? '✓ gelesen' : 'noch nicht gelesen';
      return h('div', { class: 'list-item' },
        h('span', { class: 'row gap' }, icon('file', 20), h('span', {}, f.digest?.titel || f.name)),
        h('span', { class: 'row gap' }, h('span', { class: 'muted small' }, st),
          !f.digest && !ui.busy[fid] ? h('button', { class: 'btn small', onclick: () => readArchive([fid]) }, 'Lesen') : null,
          h('button', { class: 'iconbtn', 'aria-label': 'Löschen', onclick: async () => {
            if (!(await confirmDialog('Diese Klausur aus dem Archiv löschen?', 'Löschen'))) return;
            s.archive = s.archive.filter((x) => x !== fid); await removeFile(fid); save(); render();
          } }, icon('trash', 18))));
    }));
    if (!(s.archive || []).length) add(archiveList, h('p', { class: 'muted small' }, 'Noch keine alten Klausuren.'));
  };
  const readArchive = async (ids) => {
    if (!aiReady()) return toast('Bitte zuerst die KI einrichten.', 'error');
    for (const fid of ids) {
      ui.busy[fid] = true; drawArchive();
      try { await digestFile(fid); } catch (e) { toast(errorMsg(e), 'error'); }
      delete ui.busy[fid]; drawArchive();
    }
    if ((s.archive || []).some((fid) => state.files[fid]?.digest)) await buildProfile();
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
      s.teacherProfile ? mdEl(s.teacherProfile) : h('p', { class: 'muted small' }, 'Wird automatisch erstellt, sobald alte Klausuren gelesen wurden.'),
      h('div', { class: 'row gap wrap' },
        s.archive?.length ? h('button', { class: 'btn small', onclick: () => buildProfile() }, 'Neu erstellen') : null,
        h('button', { class: 'btn small ghost', onclick: () => drawProfile(true) }, 'Bearbeiten')));
  };
  const buildProfile = async () => {
    profileBox.replaceChildren(h('p', { class: 'muted' }, 'Analysiere den Stil deiner Lehrkraft …'));
    try { s.teacherProfile = await generate({ system: P.baseSystem(s), parts: [{ text: P.teacherProfilePrompt(s) }], temperature: 0.2 }); save(); toast('Lehrerprofil aktualisiert.', 'ok'); } catch (e) { toast(errorMsg(e), 'error'); }
    drawProfile();
  };
  drawArchive(); drawProfile();

  return h('div', { class: 'screen' },
    topbar({ back: () => go('subjects'), title: s.name }),
    h('main', { class: 'content narrow' },
      h('section', { class: 'card stack' },
        h('div', { class: 'label' }, 'Name'),
        h('input', { class: 'input', value: s.name, onchange: (e) => { if (e.target.value.trim()) { s.name = e.target.value.trim(); save(); } } }),
        h('div', { class: 'label' }, 'Unterrichtssprache'),
        h('div', { class: 'seg' }, [['de', 'Deutsch'], ['en', 'Englisch (bilingual)']].map(([v, l]) => h('button', { class: `seg-btn ${s.language === v ? 'active' : ''}`, onclick: () => { s.language = v; save(); render(); } }, l))),
        h('div', { class: 'label' }, 'Dein Stand'),
        h('div', { class: 'seg' }, [[1, 'schwach'], [2, 'mittel'], [3, 'stark']].map(([v, l]) => h('button', { class: `seg-btn ${s.level === v ? 'active' : ''}`, onclick: () => { s.level = v; save(); render(); } }, l))),
        h('div', { class: 'label' }, 'Was weißt du über deine Lehrkraft? (optional)'),
        h('textarea', { class: 'input', rows: 3, placeholder: 'z. B. „Achtet sehr auf Fachbegriffe, will immer eine Einleitung, zieht für fehlende Einheiten Punkte ab“', value: s.teacherNotes || '', oninput: (e) => { s.teacherNotes = e.target.value; save(); } })),
      h('section', { class: 'card stack' },
        h('div', { class: 'row between' }, h('h3', {}, 'Klausur-Archiv'),
          h('button', { class: 'btn small primary', onclick: async () => {
            const files = await pickFiles();
            const added = [];
            for (const f of files) {
              try { const fid = await addFile(f, { kind: 'archive', subjectId: s.id }); (s.archive ||= []).push(fid); added.push(fid); } catch (e) { toast(errorMsg(e), 'error'); }
            }
            save(); drawArchive();
            if (added.length) readArchive(added);
          } }, h('span', { class: 'row gap' }, icon('plus', 18), 'Hochladen'))),
        h('p', { class: 'muted small' }, 'Am besten korrigierte Klausuren (mit Rotstift & Punkten) – mehrseitige Klausuren als PDF oder mehrere Fotos.'),
        archiveList),
      h('section', { class: 'card stack' }, h('h3', {}, 'Lehrerprofil'), profileBox),
      h('div', { class: 'stack' },
        h('button', { class: 'btn primary block', onclick: () => startNewExam(s.id) }, `${s.name}-Klausur anlegen`),
        h('button', { class: 'btn ghost block danger-text', onclick: async () => {
          if (state.exams.some((e) => e.subjectId === s.id)) return toast('Lösche zuerst die Klausuren dieses Fachs.', 'error');
          if (!(await confirmDialog(`${s.name} samt Archiv löschen?`, 'Löschen'))) return;
          for (const fid of s.archive || []) await removeFile(fid);
          state.subjects = state.subjects.filter((x) => x.id !== s.id); save(); go('subjects');
        } }, 'Fach löschen'))));
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
  return h('div', { class: 'screen with-tabs' },
    h('header', { class: 'topbar' }, h('span', { class: 'iconbtn-spacer' }), h('div', { class: 'topbar-title' }, 'Einstellungen'), h('span', { class: 'iconbtn-spacer' })),
    h('main', { class: 'content narrow' },
      h('section', { class: 'card stack' }, h('h3', {}, 'KI'), aiSetupBlock(false)),
      h('section', { class: 'card stack' }, h('h3', {}, 'Video beim Warten'),
        h('p', { class: 'muted small' }, 'YouTube-Link, der läuft, während die KI arbeitet. Leer lassen = kein Video.'),
        h('input', { class: 'input', placeholder: 'https://youtu.be/…', value: state.settings.waitVideo ?? DEFAULT_WAIT_VIDEO, onchange: (e) => {
          const v = e.target.value.trim();
          if (v && !youtubeId(v)) { toast('Das ist kein gültiger YouTube-Link.', 'error'); return; }
          state.settings.waitVideo = v; save(); toast(v ? 'Video gespeichert.' : 'Video ausgeschaltet.', 'ok');
        } })),
      h('section', { class: 'card stack' }, h('h3', {}, 'Profil'),
        h('p', { class: 'muted small' }, `${p.name} · Klasse ${p.grade} · ${p.schoolType} · ${p.state} · ${p.minutesPerDay} Min./Tag · Korrektur: ${p.feedbackStyle === 'hart' ? 'schonungslos' : 'ermutigend'} · ${p.gradeScale === '0-15' ? 'Punkte 0–15' : 'Noten 1–6'}`),
        h('button', { class: 'btn', onclick: () => { draft = null; go('onboarding'); } }, 'Fragebogen neu ausfüllen')),
      h('section', { class: 'card stack' }, h('h3', {}, 'Datensicherung'),
        h('p', { class: 'muted small' }, 'Alles liegt nur auf diesem Gerät (im Browser). Wenn du Safari-Daten löschst, ist es weg. Mach ab und zu ein Backup. Der API-Schlüssel wird nicht mitgesichert.'),
        h('div', { class: 'row gap wrap' },
          h('button', { class: 'btn', onclick: exportBackup }, 'Backup herunterladen'),
          h('button', { class: 'btn ghost', onclick: importBackup }, 'Backup einspielen'))),
      h('section', { class: 'card stack' }, h('h3', {}, 'Gefahrenzone'),
        h('button', { class: 'btn ghost danger-text', onclick: async () => { if (await confirmDialog('Wirklich ALLE Daten löschen (Profil, Fächer, Klausuren, Archiv)?', 'Alles löschen')) { await clearAll(); draft = null; nx = null; go('onboarding'); } } }, 'Alle Daten löschen')),
      h('p', { class: 'muted small center' }, `Lern-KI · Version ${APP_VERSION} · kostenlos`)),
    tabbar('settings'));
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
(async function init() {
  await loadState();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  route = { name: state.profile ? 'plan' : 'onboarding', params: {} };
  render();
})();

// Für die Konsole/Tests
window.__lernki = { state: () => state, md, save };
