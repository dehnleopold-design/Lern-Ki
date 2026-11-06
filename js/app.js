import { state, loadState, save, replaceState, clearAll, allBlobs, putBlob, uid, useAccount, hasLocalProfile } from './store.js';
import { startSync, syncNow, syncStatus, onSyncStatus } from './sync.js';
import { authEnabled, initAuth, signInGoogle, signInEmail, registerEmail, resetPassword, signOutUser, currentUser, authErrorText } from './auth.js';
import { generate, aiReady, listGeminiModels, pickDefaultModel, AIError, onAIStatus } from './ai.js';
import { addFile, removeFile, filePart, thumbURL, pickFiles } from './files.js';
import * as P from './prompts.js';
import { gradeLabel, gradeOptions, percentToGrade, reachesTarget, scale } from './grades.js';
import { downloadLernzettel, sheetHTML, SHEET_CSS } from './pdf.js';
import { cleanText } from './ui.js';
import { h, add, md, mdEl, mascot, speech, icon, toast, confirmDialog, isoDate, parseISO, fmtDate, relDay } from './ui.js';

const APP_VERSION = '2.8 (6.11.)';
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

function render() {
  app.replaceChildren();
  if (!state.profile && !['onboarding', 'login'].includes(route.name)) route = { name: 'onboarding', params: {} };
  const views = { login: viewLogin, onboarding: viewOnboarding, prepare: viewPrepare, plan: viewPlan, pick: viewPick, vocab: viewVocab, solve: viewSolveNew, solved: viewSolved, vnew: viewVocabNew, vset: viewVocabSet, vwords: viewVocabWords, vplan: viewVocabPlan, vquiz: viewVocabQuiz, vtests: viewVocabTests, newExam: viewNewExam, session: viewSession, subjects: viewSubjects, subject: viewSubject, tutor: viewTutor, settings: viewSettings };
  const v = (views[route.name] || viewPlan)(route.params);
  add(app, v);
}

function tabbar(active) {
  const tab = (name, ic, label) => h('button', { class: `tab ${active === name ? 'active' : ''}`, onclick: () => go(name), 'aria-label': label }, icon(ic, 22), h('span', {}, label));
  // Kamera-Knopf in der Mitte: öffnet sofort die Kamera, das Foto landet in "Blatt lösen"
  const cam = h('button', { class: 'tab-cam', 'aria-label': 'Arbeitsblatt fotografieren', onclick: () => {
    startSolve();
    pickFiles({ accept: 'image/*', capture: 'environment', multiple: false }).then(async (files) => {
      for (const f of files) { try { nsv.fileIds.push(await addFile(f, { kind: 'sheet', subjectId: nsv.subjectId })); } catch (e) { toast(errorMsg(e), 'error'); } }
      if (route.name === 'solve') render();
    });
  } }, icon('camera', 24));
  return h('nav', { class: 'tabbar' }, tab('plan', 'route', 'Plan'), tab('subjects', 'library', 'Fächer'), cam, tab('vocab', 'languages', 'Vokabeln'), tab('tutor', 'sparkles', 'Tutor'), tab('settings', 'gear', 'Mehr'));
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

function viewPlan() {
  const exam = activeExam();
  const screen = h('div', { class: 'screen with-tabs' });
  if (!exam) {
    add(screen,
      h('header', { class: 'topbar' }, h('span', { class: 'iconbtn-spacer' }), h('div', { class: 'topbar-title' }, `Hi ${state.profile.name}!`), h('span', { class: 'iconbtn-spacer' })),
      h('main', { class: 'content narrow center' },
        mascot(140),
        h('h1', { class: 'display' }, 'Welche Klausur steht an?'),
        h('p', { class: 'muted' }, 'Leg eine Klausur an, lade deine Arbeitsblätter hoch – ich baue dir daraus Lernzettel, Quizze, Aufgaben und eine Probeklassenarbeit.'),
        h('button', { class: 'btn primary', onclick: () => startNewExam() }, 'Klausur anlegen')),
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
    h('span', { class: 'iconbtn-spacer' }),
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
    h('main', { class: 'content narrow' }, hero,
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
    const failed = await prepareAll(exam, panel);
    toast(failed ? `Plan fertig. ${failed} Inhalt(e) konnten nicht vorbereitet werden – sie werden beim Öffnen erstellt.` : 'Alles fertig vorbereitet!', failed ? 'info' : 'ok');
    if (route.name === 'newExam') go('plan');
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

function rebuildPlan(exam) {
  go('prepare', { examId: exam.id, rebuild: true });
}

// ---------- Inhalte erzeugen (einzeln beim Öffnen oder alle vorab) ----------
function hasContent(u) {
  const x = state.sessions[u.id];
  return !!(x && (x.lernzettel || x.fragen || x.aufgaben));
}

async function genLernzettel(exam, unit) {
  const overall = unit.typ === 'gesamtzettel';
  const topic = overall ? null : exam.plan?.themen?.[unit.themaIndex];
  const text = await generate({ system: P.baseSystem(subjectById(exam.subjectId)), parts: [{ text: P.lernzettelPrompt(exam, topic || { titel: unit.titel }, overall) }], temperature: 0.3 });
  state.sessions[unit.id] = { examId: exam.id, lernzettel: text, createdAt: Date.now() };
}

async function genQuiz(exam, unit) {
  const topic = exam.plan?.themen?.[unit.themaIndex] || { titel: unit.titel };
  const prev = state.sessions[unit.id]?.alteFragen || [];
  const res = await generate({ system: P.baseSystem(subjectById(exam.subjectId)), parts: [{ text: P.quizPrompt(exam, topic, lernzettelText(exam, unit.themaIndex), prev) }], json: true, temperature: 0.7 });
  const fragen = (res.fragen || []).filter((q) => q?.frage && ['mc', 'wahrfalsch', 'eingabe'].includes(q.typ)
    && (q.typ !== 'mc' || (Array.isArray(q.optionen) && q.optionen.length >= 2 && Number.isInteger(q.richtig))));
  if (!fragen.length) throw new AIError('Keine brauchbaren Quizfragen erhalten. Bitte nochmal versuchen.');
  state.sessions[unit.id] = { examId: exam.id, fragen, antworten: {}, idx: 0, alteFragen: [...prev, ...fragen.map((q) => q.frage.slice(0, 100))] };
}

async function genAufgaben(exam, unit) {
  const prev = Object.values(state.sessions).filter((x) => x.examId === exam.id).flatMap((x) => (x.aufgaben || []).map((a) => a.aufgabe.slice(0, 120)));
  const topic = exam.plan?.themen?.[unit.themaIndex];
  const lz = topic ? lernzettelText(exam, unit.themaIndex) : null;
  const res = await generate({ system: P.baseSystem(subjectById(exam.subjectId)), parts: [{ text: P.sessionPrompt(exam, unit, prev, { topic, lernzettel: lz }) }], json: true, temperature: 0.7 });
  const aufgaben = (res.aufgaben || []).filter((a) => a?.aufgabe).map((a, i) => ({ ...a, id: a.id || `a${i + 1}`, punkte: Number(a.punkte) || 4 }));
  if (!aufgaben.length) throw new AIError('Keine Aufgaben erhalten. Bitte nochmal versuchen.');
  // startedAt erst beim ersten Öffnen setzen (sonst läuft der Probeklausur-Timer schon ab der Erstellung)
  state.sessions[unit.id] = { examId: exam.id, zeitMinuten: res.zeitMinuten || null, aufgaben, answers: {}, answerImages: {}, grading: null, chats: {}, startedAt: null };
}

function generateUnit(exam, unit) {
  if (unit.typ === 'lernzettel' || unit.typ === 'gesamtzettel') return genLernzettel(exam, unit);
  if (unit.typ === 'quiz') return genQuiz(exam, unit);
  return genAufgaben(exam, unit);
}

// Zwei Anfragen gleichzeitig: schneller, aber noch im Rahmen der kostenlosen Limits.
async function pool(items, limit, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

// Erstellt alle noch fehlenden Inhalte: erst Lernzettel (die anderen bauen darauf auf), dann Quiz + Aufgaben, dann Abschluss.
async function prepareAll(exam, panel) {
  const todo = allUnits(exam).filter((u) => !hasContent(u) && u.status !== 'skipped');
  const phase1 = todo.filter((u) => u.typ === 'lernzettel');
  const phase2 = todo.filter((u) => u.typ === 'quiz' || u.typ === 'aufgaben' || ['verstehen', 'ueben', 'anwenden'].includes(u.typ));
  const phase3 = todo.filter((u) => u.typ === 'gesamtzettel' || u.typ === 'probeklausur');
  const ordered = [...phase1, ...phase2, ...phase3];
  const label = (u) => ({ lernzettel: 'Lernzettel', quiz: 'Quiz', aufgaben: 'Anwendungsaufgaben', gesamtzettel: 'Gesamt-Lernzettel', probeklausur: 'Probeklassenarbeit' }[u.typ] || 'Einheit')
    + (u.themaIndex !== null && u.themaIndex !== undefined && exam.plan?.themen?.[u.themaIndex] ? `: ${exam.plan.themen[u.themaIndex].titel}` : '');
  const start = panel.addSteps(ordered.map(label));
  const idx = new Map(ordered.map((u, k) => [u.id, start + k]));
  let failed = 0;
  const one = async (u) => {
    panel.mark(idx.get(u.id), 'run');
    try { await generateUnit(exam, u); save(); panel.mark(idx.get(u.id), 'done'); } catch (e) { failed++; panel.mark(idx.get(u.id), 'fail'); console.warn(e); }
  };
  await pool(phase1, 2, one);
  await pool(phase2, 2, one);
  await pool(phase3, 2, one);
  return failed;
}

function viewPrepare({ examId, rebuild }) {
  const exam = examById(examId);
  if (!exam) { go('plan'); return h('div'); }
  const panel = waitPanel(rebuild ? 'Ich erstelle deinen Plan neu und bereite alles vor …' : 'Ich bereite alle fehlenden Inhalte vor …');
  const screen = h('div', { class: 'screen' }, topbar({ close: () => go('plan') }),
    h('main', { class: 'content narrow' }, panel.el, h('p', { class: 'muted small center' }, 'Du kannst das auch abbrechen – Fehlendes wird dann beim Öffnen erstellt.')));
  const key = `prep:${examId}`;
  if (!ui.busy[key]) {
    ui.busy[key] = true;
    (async () => {
      try {
        if (rebuild) {
          const k = panel.addSteps(['Themen & Lernplan erstellen']);
          panel.mark(k, 'run');
          await createPlan(exam);
          panel.mark(k, 'done');
          ui.selectedUnit = null;
        }
        const failed = await prepareAll(exam, panel);
        toast(failed ? `${failed} Inhalt(e) konnten nicht vorbereitet werden – sie werden beim Öffnen erstellt.` : 'Alles fertig vorbereitet!', failed ? 'info' : 'ok');
        if (route.name === 'prepare') go('plan');
      } catch (e) {
        panel.errBox.replaceChildren(h('div', { class: 'card warn' }, h('p', {}, errorMsg(e)),
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
      try { await gradeSession(exam, unit, sess); } catch (e) { toast(errorMsg(e), 'error'); }
      overlay.remove();
      render();
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
  const here = route; // nur neu zeichnen, wenn man noch auf derselben Seite ist
  producer()
    .then(() => save())
    .catch((e) => { ui.busy[`err:${key}`] = errorMsg(e); })
    .finally(() => { delete ui.busy[key]; if (route === here) render(); });
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
      meta: [klasse, `Fach: ${subject?.name || ''}`],
      footer: `${subject?.name || ''} Lernzettel – Gesamt`,
    };
  }
  return {
    title: `Lernzettel: ${topic.titel}`,
    subtitle: `${subject?.name || ''}${exam.date ? ` | Klausur am ${dmy(exam.date)}` : ''}${topic.schwerpunkte?.length ? ` | ${topic.schwerpunkte.slice(0, 3).join(', ')}` : ''}`,
    meta: [klasse, `Thema: ${topic.titel}`],
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
        h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, s.name), h('span', { class: 'menu-sub' }, `${(s.archive || []).length ? `${s.archive.length} alte Klausuren` : 'Noch keine alten Klausuren'}${s.language === 'en' ? ' · Englisch' : ''}`)),
        icon('chev', 18)))),
      h('button', { class: 'link-small', onclick: () => addSubjectDialog() }, icon('plus', 16), 'Fach hinzufügen')),
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

  const upload = async () => {
    const files = await pickFiles();
    const added = [];
    for (const f of files) {
      try { const fid = await addFile(f, { kind: 'archive', subjectId: s.id }); (s.archive ||= []).push(fid); added.push(fid); } catch (e) { toast(errorMsg(e), 'error'); }
    }
    save(); drawArchive();
    if (added.length) readArchive(added);
  };
  const fold = (ic, title, sub, body, openFold = false) => h('details', { class: 'fold', open: openFold },
    h('summary', {}, h('span', { class: 'menu-ico' }, icon(ic, 20)), h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, title), sub ? h('span', { class: 'menu-sub' }, sub) : null), h('span', { class: 'fold-chev' }, icon('chev', 18))),
    h('div', { class: 'fold-body' }, body));

  return h('div', { class: 'screen' },
    topbar({ back: () => go('subjects'), title: '' }),
    h('main', { class: 'content narrow' },
      h('div', { class: 'subject-hero' }, subjectBadge(s, 56), h('h1', { class: 'display' }, s.name), s.language === 'en' ? h('span', { class: 'chip-static' }, 'Unterricht auf Englisch') : null),
      h('button', { class: 'btn primary block', onclick: () => startNewExam(s.id) }, icon('plus', 18), 'Klausur anlegen'),
      h('div', { class: 'folds' },
        fold('layers', 'Alte Klausuren', `${(s.archive || []).length} hochgeladen`, [
          h('p', { class: 'muted small' }, 'Am besten korrigierte Klausuren (mit Rotstift & Punkten). Daraus lerne ich den Stil deiner Lehrkraft.'),
          archiveList,
          h('button', { class: 'btn block', onclick: upload }, icon('upload', 18), 'Klausuren hochladen')]),
        fold('checkc', 'Gelöste Arbeitsblätter', `${solvedList().filter((x) => x.subjectId === s.id).length} Blätter`, [
          h('div', { class: 'menu' }, solvedList().filter((x) => x.subjectId === s.id).map((x) => menuRow('file', x.titel, x.ersteAufgabe || '', () => go('solved', { id: x.id })))),
          h('button', { class: 'btn block', onclick: () => startSolve(s.id) }, icon('camera', 18), 'Arbeitsblatt lösen')]),
        fold('user', 'Lehrerprofil', s.teacherProfile ? 'Erstellt' : 'Noch keins', [profileBox]),
        fold('gear', 'Fach-Einstellungen', null, [
          h('div', { class: 'label' }, 'Name'),
          h('input', { class: 'input', value: s.name, onchange: (e) => { if (e.target.value.trim()) { s.name = e.target.value.trim(); save(); } } }),
          h('div', { class: 'label' }, 'Unterrichtssprache'),
          h('div', { class: 'seg' }, [['de', 'Deutsch'], ['en', 'Englisch']].map(([v, l]) => h('button', { class: `seg-btn ${s.language === v ? 'active' : ''}`, onclick: () => { s.language = v; save(); render(); } }, l))),
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
  nsv = { subjectId: subjectId || state.subjects[0]?.id || null, fileIds: [], note: '' };
  go('solve');
}

function viewSolveNew() {
  if (!nsv) { startSolve(); return h('div'); }
  const cancel = async () => { for (const id of nsv.fileIds) await removeFile(id); nsv = null; go('subjects'); };
  if (nsv.processing) {
    const panel = waitPanel('Ich löse dein Arbeitsblatt …');
    panel.setSteps(['Blatt lesen & Aufgaben lösen', 'Lösungen aufs Blatt schreiben']);
    panel.run(0);
    const screen = h('div', { class: 'screen' }, topbar({ close: () => go('subjects') }), h('main', { class: 'content narrow' }, panel.el));
    processSolve(panel);
    return screen;
  }
  const grid = h('div', { class: 'grid3' });
  const draw = async () => {
    const tiles = [];
    for (const id of nsv.fileIds) {
      const url = await thumbURL(id);
      tiles.push(h('div', { class: 'tile filled' }, url ? h('img', { src: url }) : h('div', { class: 'tile-file' }, icon('file', 30), h('span', {}, state.files[id]?.name || '')),
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
      speech('Scanne ein Arbeitsblatt ein – ich löse alle Aufgaben und erkläre dir den Weg.'),
      h('div', { class: 'label' }, 'Fach'),
      h('div', { class: 'chips' }, state.subjects.map((sub) => h('button', { class: `chip ${nsv.subjectId === sub.id ? 'active' : ''}`, onclick: () => { nsv.subjectId = sub.id; render(); } }, sub.name))),
      h('div', { class: 'label' }, 'Seiten'),
      grid,
      h('div', { class: 'label' }, 'Hinweis (optional)'),
      h('input', { class: 'input', placeholder: 'z. B. „nur Aufgabe 2–4“ oder „M3 ist auf der Rückseite“', value: nsv.note, oninput: (e) => { nsv.note = e.target.value; } })),
    h('footer', { class: 'footer' }, h('button', { class: 'btn primary block', onclick: () => {
      if (!aiReady()) return toast('Bitte zuerst die KI einrichten (Mehr → KI-Verbindung).', 'error');
      if (!nsv.fileIds.length) return toast('Bitte mindestens eine Seite hinzufügen.');
      nsv.processing = true; render();
    } }, 'Blatt lösen')));
}

async function processSolve(panel) {
  if (ui.busy.solve) return;
  ui.busy.solve = true;
  try {
    const subject = subjectById(nsv.subjectId);
    const parts = [{ text: P.solvePrompt(subject, nsv.note.trim()) }];
    for (const id of nsv.fileIds) parts.push(await filePart(id));
    const text = await generate({ system: P.baseSystem(subject), parts, temperature: 0.2 });
    panel.done(0); panel.run(1);
    const first = text.match(/^##\s+(.*)$/m);
    const item = { id: uid(), subjectId: nsv.subjectId, fileIds: [...nsv.fileIds], note: nsv.note.trim(), loesung: text, titel: `${subject?.name || 'Blatt'} · ${new Date().toLocaleDateString('de-DE')}`, ersteAufgabe: first ? first[1].slice(0, 80) : '', chat: [], createdAt: Date.now(), annot: {} };
    await annotateSheet(item, subject);
    solvedList().unshift(item);
    save();
    nsv = null;
    go('solved', { id: item.id });
  } catch (e) {
    panel.fail(0);
    panel.errBox.replaceChildren(h('div', { class: 'card warn' }, h('p', {}, errorMsg(e)),
      h('div', { class: 'row gap center' }, h('button', { class: 'btn', onclick: () => render() }, 'Nochmal versuchen'), h('button', { class: 'btn ghost', onclick: () => { nsv.processing = false; render(); } }, 'Zurück'))));
  } finally { delete ui.busy.solve; }
}

// Lösungen direkt auf die Fotos schreiben (Positionen von der KI, 0–1000 relativ zum Bild).
async function annotateSheet(item, subject) {
  item.annot ||= {};
  for (const fid of item.fileIds) {
    if (!state.files[fid]?.mime?.startsWith('image/')) continue;
    try {
      const res = await generate({ system: P.baseSystem(subject), parts: [{ text: P.annotatePrompt(item.loesung) }, await filePart(fid)], json: true, temperature: 0.1 });
      item.annot[fid] = (res.eintraege || []).filter((e) => Array.isArray(e.box) && e.box.length === 4 && e.box.every((n) => Number.isFinite(Number(n))) && ['text', 'kreuz', 'markieren', 'kreis', 'pruefen'].includes(e.art))
        .map((e) => ({ ...e, box: e.box.map((n) => Math.max(0, Math.min(1000, Number(n)))) }));
    } catch (e) { console.warn('Eintragen fehlgeschlagen', e); }
  }
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
            try { await annotateSheet(item, subject); save(); } catch (e) { toast(errorMsg(e), 'error'); }
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

// Lernplan: Vokabeln in Tagesportionen bis zum Test, mit Wiederholung nach 1 und 3 Tagen; letzter Tag = alles + Probe-Test.
function buildVocabPlan(set) {
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
        h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, set.titel), h('span', { class: 'menu-sub' }, `${set.sprache} · ${st.total} Vokabeln · ${st.pct} % sicher${set.testDate ? ` · Test ${relDay(set.testDate).toLowerCase()}` : ''}`)),
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
  if (nv.processing) {
    const panel = waitPanel('Ich lese deine Vokabeln …');
    const screen = h('div', { class: 'screen' }, topbar({ close: () => go('vocab') }), h('main', { class: 'content narrow' }, panel.el));
    processVocab(panel);
    return screen;
  }
  const grid = h('div', { class: 'grid3' });
  const draw = async () => {
    const tiles = [];
    for (const id of nv.fileIds) {
      const url = await thumbURL(id);
      tiles.push(h('div', { class: 'tile filled' }, url ? h('img', { src: url }) : h('div', { class: 'tile-file' }, icon('file', 30), h('span', {}, state.files[id]?.name || '')),
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

async function processVocab(panel) {
  const key = 'vnew';
  if (ui.busy[key]) return;
  ui.busy[key] = true;
  const start = panel.addSteps([...nv.fileIds.map((id, i) => `Seite ${i + 1} lesen`), 'Lernplan erstellen']);
  try {
    let titel = '', sprache = '';
    const words = [];
    for (let i = 0; i < nv.fileIds.length; i++) {
      panel.mark(start + i, 'run');
      const res = await generate({ system: P.vocabSystem(), parts: [{ text: P.vocabExtractPrompt() }, await filePart(nv.fileIds[i])], json: true, temperature: 0.1 });
      titel ||= res.titel || '';
      sprache ||= res.sprache || '';
      for (const v of res.vokabeln || []) if (v?.wort && v?.uebersetzung) words.push({ id: uid(), w: String(v.wort).trim(), t: String(v.uebersetzung).trim(), ex: v.beispiel || '', info: v.info || '', box: 0 });
      panel.mark(start + i, 'done');
    }
    if (!words.length) throw new AIError('Ich konnte auf den Seiten keine Vokabeln erkennen. Sind die Fotos scharf?');
    panel.mark(start + nv.fileIds.length, 'run');
    let set = nv.addTo ? vsetById(nv.addTo) : null;
    if (set) {
      set.words.push(...words.filter((w) => !set.words.some((x) => normAnswer(x.w) === normAnswer(w.w))));
      set.fileIds.push(...nv.fileIds);
    } else {
      set = { id: uid(), titel: titel || 'Vokabeln', sprache: sprache || 'Englisch', words, fileIds: [...nv.fileIds], testDate: nv.testDate || null, createdAt: Date.now(), sess: {} };
      vocab().sets.push(set);
    }
    buildVocabPlan(set);
    save();
    panel.mark(start + nv.fileIds.length, 'done');
    toast(`${words.length} Vokabeln erkannt – prüf die Liste kurz auf Lesefehler.`, 'ok');
    nv = null;
    go('vset', { id: set.id });
  } catch (e) {
    panel.errBox.replaceChildren(h('div', { class: 'card warn' }, h('p', {}, errorMsg(e)),
      h('div', { class: 'row gap center' }, h('button', { class: 'btn', onclick: () => render() }, 'Nochmal versuchen'), h('button', { class: 'btn ghost', onclick: () => { nv.processing = false; render(); } }, 'Zurück'))));
  } finally { delete ui.busy[key]; }
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
    list.replaceChildren(...t.fileIds.map((fid) => h('div', { class: 'menu-row' },
      h('span', { class: 'menu-ico' }, icon('file', 20)), h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, state.files[fid]?.name || 'Test')),
      h('button', { class: 'iconbtn small', 'aria-label': 'Löschen', onclick: async () => { t.fileIds = t.fileIds.filter((x) => x !== fid); await removeFile(fid); save(); drawList(); } }, icon('trash', 18)))));
    if (!t.fileIds.length) add(list, h('div', { class: 'menu-row' }, h('span', { class: 'muted small' }, 'Noch keine alten Tests.')));
  };
  const drawProfile = () => profileBox.replaceChildren(t.profil ? mdEl(t.profil) : h('p', { class: 'muted small' }, 'Wird erstellt, sobald du Tests hochlädst. Danach sehen die Probe-Tests aus wie die deiner Lehrkraft.'));
  const build = async () => {
    if (!t.fileIds.length) return;
    if (!aiReady()) return toast('Bitte zuerst die KI einrichten.', 'error');
    profileBox.replaceChildren(h('p', { class: 'muted' }, 'Ich analysiere die Tests …'));
    try {
      const parts = [{ text: P.vocabTestProfilePrompt(sprache) }];
      for (const fid of t.fileIds) parts.push(await filePart(fid));
      t.profil = await generate({ system: P.vocabSystem(), parts, temperature: 0.2 });
      save(); toast('Testprofil erstellt.', 'ok');
    } catch (e) { toast(errorMsg(e), 'error'); }
    drawProfile();
  };
  drawList(); drawProfile();
  return h('div', { class: 'screen' },
    topbar({ back: () => go('vocab'), title: `Vokabeltests ${sprache}` }),
    h('main', { class: 'content narrow' },
      h('p', { class: 'muted small center' }, 'Am besten korrigierte Tests. Ich schaue mir Aufgabentypen, Richtung und Strenge (Rechtschreibung, Artikel, Akzente) an.'),
      list,
      h('button', { class: 'btn primary block', onclick: async () => {
        const added = [];
        for (const f of await pickFiles()) { try { const fid = await addFile(f, { kind: 'vtest', subjectId: null }); t.fileIds.push(fid); added.push(fid); } catch (e) { toast(errorMsg(e), 'error'); } }
        save(); drawList(); if (added.length) build();
      } }, icon('upload', 18), 'Tests hochladen'),
      h('section', { class: 'card stack' }, h('h3', {}, 'Testprofil'), profileBox,
        t.fileIds.length ? h('button', { class: 'btn small ghost', onclick: build }, icon('refresh', 16), 'Neu analysieren') : null)));
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
            h('button', { class: 'btn ghost block danger-text', onclick: async () => { try { await signOutUser(); } catch { try { localStorage.removeItem('lernki-last-uid'); } catch {} location.reload(); } } }, 'Abmelden')]);
        })) : null,
      h('div', { class: 'menu' },
        menuRow('user', 'Profil', `${p.name} · Klasse ${p.grade} · ${p.state}`, () => {
          const o = sheet('Profil', [
            h('p', { class: 'muted' }, `${p.name} · Klasse ${p.grade} · ${p.schoolType} · ${p.state}`),
            h('p', { class: 'muted small' }, `${p.minutesPerDay} Min./Tag · Korrektur: ${p.feedbackStyle === 'hart' ? 'schonungslos' : 'ermutigend'} · ${p.gradeScale === '0-15' ? 'Punkte 0–15' : 'Noten 1–6'}`),
            h('button', { class: 'btn primary block', onclick: () => { o.remove(); draft = null; go('onboarding'); } }, 'Fragebogen neu ausfüllen')]);
        }),
        menuRow('save', 'Datensicherung', 'Backup speichern oder einspielen', () => {
          sheet('Datensicherung', [
            h('p', { class: 'muted small' }, 'Alles liegt nur auf diesem Gerät. Wenn Safari-Daten gelöscht werden, ist es weg – mach ab und zu ein Backup. Der API-Schlüssel wird nicht mitgesichert.'),
            h('button', { class: 'btn primary block', onclick: exportBackup }, 'Backup herunterladen'),
            h('button', { class: 'btn ghost block', onclick: importBackup }, 'Backup einspielen')]);
        })),
      h('div', { class: 'menu' },
        menuRow('trash', 'Alle Daten löschen', null, async () => { if (await confirmDialog('Wirklich ALLE Daten löschen (Profil, Fächer, Klausuren, Archiv)?', 'Alles löschen')) { await clearAll(); draft = null; nx = null; go('onboarding'); } }, 'danger')),
      h('p', { class: 'muted small center' }, `Lern-KI · Version ${APP_VERSION}`)),
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
  const synced = startSync(user, { onRemoteApplied: async () => {
    if (!booted) return;
    const keep = route;
    await loadState();
    route = state.profile ? (['onboarding', 'login'].includes(keep.name) ? { name: 'plan', params: {} } : keep) : { name: 'onboarding', params: {} };
    render();
    toast('Neuer Stand von deinem anderen Gerät geladen.', 'ok');
  } });
  await Promise.race([synced, new Promise((r) => setTimeout(r, 10000))]);
  await boot(user);
  booted = true;
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

// Für die Konsole/Tests
window.__lernki = { state: () => state, md, save, putBlob };
