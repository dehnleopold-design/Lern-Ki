import { state, loadState, save, replaceState, clearAll, allBlobs, putBlob, uid } from './store.js';
import { generate, aiReady, listGeminiModels, pickDefaultModel, AIError } from './ai.js';
import { addFile, removeFile, filePart, thumbURL, pickFiles } from './files.js';
import * as P from './prompts.js';
import { gradeLabel, gradeOptions, percentToGrade, reachesTarget, scale } from './grades.js';
import { h, add, md, mdEl, mascot, speech, icon, toast, confirmDialog, isoDate, parseISO, fmtDate, relDay } from './ui.js';

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
const UNIT_ICON = { verstehen: 'book', ueben: 'pencil', anwenden: 'bulb', probeklausur: 'exam' };
const UNIT_LABEL = { verstehen: 'Verstehen', ueben: 'Üben', anwenden: 'Anwenden', probeklausur: 'Probeklausur' };
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
  const current = units.find((u) => u.status !== 'done');
  const selected = units.find((u) => u.id === ui.selectedUnit) || current || units[units.length - 1];
  const done = units.filter((u) => u.status === 'done').length;

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
    exam.lastResult ? h('div', { class: 'muted small' }, `Letztes Ergebnis: ${exam.lastResult.percent} % ≈ ${gradeLabel(exam.lastResult.grade)} (Schätzung)`) : null);

  const path = h('div', { class: 'path' });
  let gi = 0;
  (exam.plan?.abschnitte || []).forEach((sec, si) => {
    const color = SECTION_COLORS[si % SECTION_COLORS.length];
    add(path, h('div', { class: 'section-banner', style: { background: color } }, h('span', {}, sec.titel), icon('chat', 22)));
    let lastDay = null;
    sec.einheiten.forEach((u) => {
      const x = Math.round(Math.sin(gi * 0.9) * 70);
      gi++;
      const isCurrent = current && u.id === current.id;
      const isSel = selected && u.id === selected.id;
      if (u.tag && u.tag !== lastDay) { add(path, h('div', { class: 'day-label' }, `${relDay(u.tag)} · ${fmtDate(u.tag)}`)); lastDay = u.tag; }
      const node = h('button', {
        class: `node ${u.status === 'done' ? 'done' : ''} ${isSel ? 'selected' : ''} ${isCurrent ? 'current' : ''}`,
        style: { '--c': color, transform: `translateX(${x}px)` },
        onclick: () => { ui.selectedUnit = u.id; render(); },
        'aria-label': u.titel,
      }, icon(u.status === 'done' ? 'check' : UNIT_ICON[u.typ] || 'pencil', 30));
      const row = h('div', { class: 'node-row' }, node);
      if (isCurrent) { const m = mascot(56, 'side'); m.classList.add('node-mascot'); m.style.transform = `translateX(${x + 62}px)`; add(row, m); }
      add(path, row);
    });
  });

  const selColor = selected ? SECTION_COLORS[selected._section % SECTION_COLORS.length] : '#3dd68c';
  const bottom = selected ? h('div', { class: 'bottom-card', style: { '--c': selColor } },
    h('div', { class: 'muted small' }, `${UNIT_LABEL[selected.typ] || ''}${selected.tag ? ` · ${relDay(selected.tag)}` : ''}${selected.score !== undefined ? ` · zuletzt ${selected.score} %` : ''}`),
    h('div', { class: 'bottom-title' }, selected.titel),
    selected.ziel ? h('div', { class: 'muted small' }, selected.ziel) : null,
    h('button', { class: 'btn light block', onclick: () => go('session', { examId: exam.id, unitId: selected.id }) },
      selected.status === 'done' ? 'Wiederholen' : state.sessions[selected.id]?.aufgaben ? 'Fortsetzen' : current && selected.id !== current.id ? 'Vorspringen' : 'Starten')) : null;

  add(screen, header, h('main', { class: 'content narrow' }, info, units.length ? path : h('div', { class: 'card' }, h('p', {}, 'Für diese Klausur gibt es noch keinen Plan.'), h('button', { class: 'btn primary', onclick: () => rebuildPlan(exam) }, 'Plan erstellen'))), bottom, tabbar('plan'));
  return screen;
}

function sheet(title, children) {
  const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } },
    h('div', { class: 'sheet' }, h('div', { class: 'sheet-title' }, title), ...children));
  add(document.body, overlay);
  return overlay;
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
    const status = h('div', { class: 'muted center' }, 'Starte …');
    const errBox = h('div');
    const screen = h('div', { class: 'screen' }, topbar({ close: cancel }),
      h('main', { class: 'content narrow center' },
        h('div', { class: 'loading-path' }, [0, 1, 2, 3].map((i) => h('div', { class: 'lp-node', style: { animationDelay: `${i * 0.25}s`, transform: `translateX(${Math.round(Math.sin(i) * 50)}px)` } }))),
        speech('Ich lese mal deine Lernzettel …', 'think'), status, errBox));
    processExam(status, errBox);
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

async function processExam(status, errBox) {
  const subject = subjectById(nx.subjectId);
  try {
    const ids = [...nx.materialIds];
    if (nx.useArchive && subject) ids.push(...(subject.archive || []));
    let i = 0;
    for (const id of ids) {
      i++;
      if (state.files[id]?.digest) continue;
      status.textContent = `Lese ${state.files[id]?.name || 'Datei'} (${i}/${ids.length}) …`;
      await digestFile(id);
    }
    if (nx.useArchive && subject?.archive?.length && !subject.teacherProfile) {
      status.textContent = 'Analysiere den Stil deiner Lehrkraft …';
      subject.teacherProfile = await generate({ system: P.baseSystem(subject), parts: [{ text: P.teacherProfilePrompt(subject) }], temperature: 0.2 });
      save();
    }
    let exam = nx.editId ? examById(nx.editId) : null;
    if (!exam) {
      exam = { id: uid(), subjectId: nx.subjectId, createdAt: Date.now(), weaknesses: [] };
      state.exams.push(exam);
    }
    Object.assign(exam, { date: nx.date ?? null, targetGrade: nx.targetGrade, materialIds: nx.materialIds, topicsText: nx.topicsText, useArchive: nx.useArchive });
    state.activeExamId = exam.id;
    save();
    status.textContent = 'Erstelle deinen Lernplan …';
    await createPlan(exam);
    nx = null;
    ui.selectedUnit = null;
    toast('Dein Plan ist fertig!', 'ok');
    go('plan');
  } catch (e) {
    status.textContent = '';
    errBox.replaceChildren(h('div', { class: 'card warn' }, h('p', {}, errorMsg(e)),
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
  const plan = await generate({ system: P.baseSystem(subjectById(exam.subjectId)), parts: [{ text: P.planPrompt(exam, learningDays(exam)) }], json: true, temperature: 0.3 });
  plan.abschnitte = (plan.abschnitte || []).filter((s) => s.einheiten?.length).map((s) => ({
    titel: s.titel || 'Thema',
    einheiten: s.einheiten.map((u) => ({ id: uid(), titel: u.titel || 'Einheit', typ: UNIT_ICON[u.typ] ? u.typ : 'ueben', ziel: u.ziel || '', tag: /^\d{4}-\d{2}-\d{2}$/.test(u.tag || '') ? u.tag : null, status: 'open' })),
  }));
  if (!plan.abschnitte.length) throw new AIError('Die KI hat keinen brauchbaren Plan geliefert. Bitte nochmal versuchen.');
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

  if (!sess?.aufgaben) {
    add(main, h('div', { class: 'center stack' }, mascot(110, 'think'), h('p', { class: 'muted' }, unit.typ === 'probeklausur' ? 'Ich baue dir eine Probeklausur im Stil deiner Lehrkraft …' : 'Ich erstelle prüfungsnahe Aufgaben aus deinem Material …')));
    const err = ui.busy[`err:${unitId}`];
    if (err) {
      add(main, h('div', { class: 'card warn' }, h('p', {}, err)),
        h('button', { class: 'btn primary block', onclick: () => { delete ui.busy[`err:${unitId}`]; render(); } }, 'Nochmal versuchen'));
      return screen;
    }
    if (!ui.busy[unitId]) {
      ui.busy[unitId] = true;
      const prev = Object.values(state.sessions).filter((s) => s.examId === examId).flatMap((s) => (s.aufgaben || []).map((a) => a.aufgabe.slice(0, 120)));
      generate({ system: P.baseSystem(subject), parts: [{ text: P.sessionPrompt(exam, unit, prev) }], json: true, temperature: 0.6 })
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
      try { await gradeSession(exam, unit, sess); } catch (e) { toast(errorMsg(e), 'error'); }
      render();
    } }, 'Abgeben & korrigieren lassen');
    add(main, submit);
  } else {
    add(main, h('div', { class: 'stack' },
      h('button', { class: 'btn primary block', onclick: () => { markDone(exam, unit.id, sess); go('plan'); } }, 'Einheit abschließen'),
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
      h('p', { class: 'muted small center' }, 'Lern-KI · kostenlos · Open Source')),
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
window.__lernki = { state: () => state, md };
