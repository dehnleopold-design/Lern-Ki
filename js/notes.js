// Notizbücher wie in GoodNotes: Seiten (liniert/kariert/leer), Apple Pencil (mit Druck), Finger, Tastatur-Textfelder.
// Alles wird im Stand gespeichert (state.notebooks) und mit dem Konto synchronisiert.
//
// Koordinaten: Jede Seite ist 1000 × 1414 Einheiten (A4). Striche: { c: Farbe, w: Breite, hl: Textmarker, p: [x, y, Druck×100, …] }

import { state, save, uid } from './store.js';
import { h, add, icon, toast, confirmDialog } from './ui.js';

const W = 1000;
const H = 1414;
const LINE = 50; // Abstand der Linien/Kästchen in Einheiten
const PENS = ['#111827', '#1d4ed8', '#dc2626', '#15803d', '#7c3aed', '#ea580c'];
const MARKERS = ['#fde047', '#86efac', '#93c5fd', '#f9a8d4'];
const TEMPLATES = [['liniert', 'Liniert'], ['kariert', 'Kariert'], ['leer', 'Leer']];
const COVERS = ['#8b5cf6', '#3b82f6', '#0d9488', '#16a34a', '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#64748b'];

let A = null; // Helfer aus app.js: go, render, sheet, subjectById, isoDate
export function initNotes(helpers) { A = helpers; }

const books = () => (state.notebooks ||= []);
const bookById = (id) => books().find((b) => b.id === id);
const newPage = (template) => ({ id: uid(), template, strokes: [], texts: [] });

// Werkzeug-Einstellungen gelten pro Gerät
const prefs = (() => {
  let p = {};
  try { p = JSON.parse(localStorage.getItem('lernki-notes') || '{}'); } catch {}
  return Object.assign({ tool: 'pen', pen: PENS[0], marker: MARKERS[0], size: 3, zoom: 1, finger: null }, p);
})();
const savePrefs = () => { try { localStorage.setItem('lernki-notes', JSON.stringify(prefs)); } catch {} };

// ================================================================ Übersicht
export function viewNotes() {
  const list = [...books()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const grid = h('div', { class: 'nb-grid' },
    h('button', { class: 'nb-card nb-new', onclick: () => editBook(null) }, h('span', { class: 'nb-cover new' }, icon('plus', 34)), h('span', { class: 'nb-title' }, 'Neues Notizbuch')),
    list.map((b) => h('button', { class: 'nb-card', onclick: () => A.go('notebook', { id: b.id }) },
      h('span', { class: 'nb-cover', style: { '--c': b.color } }, h('span', { class: 'nb-cover-title' }, b.title), h('span', { class: 'nb-cover-sub' }, A.subjectById(b.subjectId)?.name || '')),
      h('span', { class: 'nb-title' }, b.title),
      h('span', { class: 'nb-sub' }, `${b.pages.length} ${b.pages.length === 1 ? 'Seite' : 'Seiten'} · ${new Date(b.updatedAt || b.createdAt).toLocaleDateString('de-DE')}`))));
  return h('div', { class: 'screen' },
    h('header', { class: 'topbar' },
      h('button', { class: 'iconbtn', 'aria-label': 'Zurück', onclick: () => A.go(A.ui.notesBack || 'todo') }, icon('back', 22)),
      h('div', { class: 'topbar-title' }, 'Notizen'),
      h('button', { class: 'iconbtn', 'aria-label': 'Neues Notizbuch', onclick: () => editBook(null) }, icon('plus'))),
    h('main', { class: 'content' }, list.length ? null : h('p', { class: 'muted center' }, 'Leg dein erstes Notizbuch an – schreiben mit Apple Pencil oder Tastatur.'), grid));
}

function editBook(b) {
  const isNew = !b;
  const cur = b || { title: '', subjectId: null, color: COVERS[0], template: 'liniert' };
  const title = h('input', { class: 'input', placeholder: 'z. B. Deutsch', value: cur.title });
  const sub = h('select', { class: 'input' }, h('option', { value: '' }, 'Kein Fach'), state.subjects.map((s) => h('option', { value: s.id, selected: s.id === cur.subjectId }, s.name)));
  sub.onchange = () => { const s = A.subjectById(sub.value); if (s && !title.value) title.value = s.name; };
  let color = cur.color;
  let template = cur.template;
  const colors = h('div', { class: 'swatches' });
  const drawColors = () => colors.replaceChildren(...COVERS.map((c) => h('button', { class: `swatch big ${c === color ? 'on' : ''}`, style: { background: c }, onclick: () => { color = c; drawColors(); } })));
  const temps = h('div', { class: 'seg' });
  const drawTemps = () => temps.replaceChildren(...TEMPLATES.map(([v, l]) => h('button', { class: `seg-btn ${template === v ? 'active' : ''}`, onclick: () => { template = v; drawTemps(); } }, l)));
  drawColors(); drawTemps();
  const o = A.sheet(isNew ? 'Neues Notizbuch' : 'Notizbuch', [
    h('div', { class: 'label' }, 'Name'), title,
    h('div', { class: 'label' }, 'Fach (optional)'), sub,
    h('div', { class: 'label' }, isNew ? 'Papier' : 'Papier für neue Seiten'), temps,
    h('div', { class: 'label' }, 'Farbe'), colors,
    h('button', { class: 'btn primary block', onclick: () => {
      const t = title.value.trim() || A.subjectById(sub.value)?.name || 'Notizbuch';
      if (isNew) {
        const nb = { id: uid(), title: t, subjectId: sub.value || null, color, template, pages: [newPage(template)], createdAt: Date.now(), updatedAt: Date.now() };
        books().push(nb); save(); o.remove(); A.go('notebook', { id: nb.id });
      } else { Object.assign(b, { title: t, subjectId: sub.value || null, color, template, updatedAt: Date.now() }); save(); o.remove(); A.render(); }
    } }, isNew ? 'Anlegen' : 'Speichern'),
    isNew ? null : h('button', { class: 'btn ghost block danger-text', onclick: async () => {
      if (!(await confirmDialog(`„${b.title}“ mit allen ${b.pages.length} Seiten löschen?`, 'Löschen'))) return;
      state.notebooks = books().filter((x) => x !== b); save(); o.remove(); A.go('notes');
    } }, 'Notizbuch löschen'),
  ]);
}

// ================================================================ Zeichnen
function drawTemplate(ctx, template, u) {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W * u, H * u);
  if (template === 'leer') return;
  ctx.strokeStyle = template === 'kariert' ? '#dfe4ec' : '#d3d9e2';
  ctx.lineWidth = Math.max(1, u * 1.2);
  ctx.beginPath();
  for (let y = template === 'kariert' ? LINE : 2 * LINE; y < H; y += LINE) { ctx.moveTo(0, y * u); ctx.lineTo(W * u, y * u); }
  if (template === 'kariert') for (let x = LINE; x < W; x += LINE) { ctx.moveTo(x * u, 0); ctx.lineTo(x * u, H * u); }
  ctx.stroke();
}

function drawStroke(ctx, s, u) {
  const p = s.p;
  if (p.length < 3) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = s.c;
  if (s.hl) { ctx.globalAlpha = 0.38; ctx.globalCompositeOperation = 'multiply'; ctx.lineCap = 'butt'; }
  if (p.length === 3) { // ein Punkt
    ctx.fillStyle = s.c;
    ctx.beginPath(); ctx.arc(p[0] * u, p[1] * u, (s.w * u) / 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore(); return;
  }
  // Abschnittsweise, damit der Druck die Breite verändern kann
  for (let i = 3; i < p.length; i += 3) {
    const pr = s.hl ? 1 : 0.45 + (p[i + 2] / 100) * 0.9;
    ctx.lineWidth = Math.max(0.6, s.w * u * pr);
    ctx.beginPath();
    const mx0 = (p[i - 3] + (i >= 6 ? p[i - 6] : p[i - 3])) / 2, my0 = (p[i - 2] + (i >= 6 ? p[i - 5] : p[i - 2])) / 2;
    const mx1 = (p[i] + p[i - 3]) / 2, my1 = (p[i + 1] + p[i - 2]) / 2;
    ctx.moveTo(mx0 * u, my0 * u);
    ctx.quadraticCurveTo(p[i - 3] * u, p[i - 2] * u, mx1 * u, my1 * u);
    ctx.stroke();
  }
  ctx.restore();
}

function redraw(canvas, page) {
  const ctx = canvas.getContext('2d');
  const u = canvas.width / W;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawTemplate(ctx, page.template, u);
  for (const s of page.strokes) if (s.hl) drawStroke(ctx, s, u); // Textmarker unter die Schrift
  for (const s of page.strokes) if (!s.hl) drawStroke(ctx, s, u);
}

// ================================================================ Notizbuch
export function viewNotebook({ id }) {
  const b = bookById(id);
  if (!b) { A.go('notes'); return h('div'); }
  const undo = [];
  const redoStack = [];
  const snapshot = (page) => ({ page, before: JSON.stringify({ strokes: page.strokes, texts: page.texts, template: page.template }) });
  // Nur die Knöpfe Rückgängig/Wiederholen auffrischen – die Leiste nicht neu bauen (sonst geht ein Tipp verloren)
  let undoBtn = null, redoBtn = null;
  const updateUndo = () => { if (undoBtn) undoBtn.disabled = !undo.length; if (redoBtn) redoBtn.disabled = !redoStack.length; };
  const remember = (page) => { undo.push(snapshot(page)); if (undo.length > 80) undo.shift(); redoStack.length = 0; updateUndo(); };
  const touched = () => { b.updatedAt = Date.now(); save(); };
  const restore = (from, to) => {
    const e = from.pop(); if (!e) return;
    to.push(snapshot(e.page));
    Object.assign(e.page, JSON.parse(e.before));
    touched(); drawPages(); updateUndo();
  };

  const scroller = h('div', { class: 'nb-scroll' });
  const pagesEl = h('div', { class: 'nb-pages' });
  add(scroller, pagesEl);
  const bar = h('div', { class: 'nb-bar' });
  let activePage = b.pages[0];

  // ---------- Werkzeugleiste
  const toolBtn = (t, ic, label) => h('button', { class: `nb-tool ${prefs.tool === t ? 'on' : ''}`, 'aria-label': label, title: label, onclick: () => { prefs.tool = t; savePrefs(); drawBar(); updateCursor(); } }, icon(ic, 22));
  function drawBar() {
    const colors = prefs.tool === 'marker' ? MARKERS : PENS;
    const curColor = prefs.tool === 'marker' ? prefs.marker : prefs.pen;
    bar.replaceChildren(
      h('button', { class: 'nb-tool', 'aria-label': 'Zurück', onclick: () => A.go('notes') }, icon('back', 22)),
      h('div', { class: 'nb-name' }, b.title),
      h('div', { class: 'nb-tools' },
        toolBtn('pen', 'pencil', 'Stift'), toolBtn('marker', 'highlighter', 'Textmarker'), toolBtn('eraser', 'eraser', 'Radierer'), toolBtn('text', 'type', 'Text (Tastatur)'), toolBtn('hand', 'hand', 'Blättern'),
        ['pen', 'marker'].includes(prefs.tool) ? h('span', { class: 'nb-sep' }) : null,
        ['pen', 'marker'].includes(prefs.tool) ? colors.map((c) => h('button', { class: `nb-color ${c === curColor ? 'on' : ''}`, style: { background: c }, 'aria-label': `Farbe ${c}`, onclick: () => { prefs[prefs.tool === 'marker' ? 'marker' : 'pen'] = c; savePrefs(); drawBar(); } })) : null,
        prefs.tool === 'pen' ? [1.5, 3, 6].map((w) => h('button', { class: `nb-size ${prefs.size === w ? 'on' : ''}`, 'aria-label': `Stärke ${w}`, onclick: () => { prefs.size = w; savePrefs(); drawBar(); } }, h('i', { style: { width: `${w * 2 + 2}px`, height: `${w * 2 + 2}px` } }))) : null),
      h('div', { class: 'nb-tools right' },
        (undoBtn = h('button', { class: 'nb-tool', 'aria-label': 'Rückgängig', disabled: !undo.length, onclick: () => restore(undo, redoStack) }, icon('undo', 20))),
        (redoBtn = h('button', { class: 'nb-tool', 'aria-label': 'Wiederholen', disabled: !redoStack.length, onclick: () => restore(redoStack, undo) }, icon('redo', 20))),
        h('button', { class: 'nb-tool', 'aria-label': 'Seite hinzufügen', onclick: () => addPageSheet() }, icon('filePlus', 22)),
        h('button', { class: 'nb-tool', 'aria-label': 'Mehr', onclick: () => moreSheet() }, icon('more', 22))));
  }

  function addPageSheet() {
    let where = 'nach';
    const seg = h('div', { class: 'seg' });
    const drawSeg = () => seg.replaceChildren(...[['vor', 'Vor dieser'], ['nach', 'Nach dieser'], ['ende', 'Letzte Seite']].map(([v, l]) => h('button', { class: `seg-btn ${where === v ? 'active' : ''}`, onclick: () => { where = v; drawSeg(); } }, l)));
    drawSeg();
    const make = (template) => {
      const p = newPage(template);
      const i = b.pages.indexOf(activePage);
      if (where === 'vor') b.pages.splice(Math.max(0, i), 0, p);
      else if (where === 'nach' && i >= 0) b.pages.splice(i + 1, 0, p);
      else b.pages.push(p);
      activePage = p; touched(); o.remove(); drawPages();
      setTimeout(() => pagesEl.querySelector(`[data-page="${p.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    };
    const o = A.sheet('Seite hinzufügen', [seg,
      h('div', { class: 'nb-templates' }, [[activePage?.template || b.template, 'Aktuelle Vorlage'], ...TEMPLATES.map(([v, l]) => [v, l])].map(([v, l]) =>
        h('button', { class: 'nb-tpl', onclick: () => make(v) }, h('span', { class: `nb-tpl-prev tpl-${v}` }), l)))]);
  }

  function moreSheet() {
    const p = activePage;
    const n = b.pages.indexOf(p) + 1;
    const o = A.sheet(`Seite ${n} von ${b.pages.length}`, [h('div', { class: 'menu' },
      A.menuRow('layers', 'Vorlage wechseln', TEMPLATES.find(([v]) => v === p.template)?.[1], () => { o.remove(); templateSheet(p); }),
      A.menuRow('upload', 'Seite als Bild teilen', 'z. B. in Fotos sichern oder verschicken', () => { o.remove(); sharePage(p); }),
      A.menuRow('hand', prefs.finger === false ? 'Finger: Blättern' : 'Finger: Zeichnen', prefs.finger === false ? 'Nur der Apple Pencil schreibt' : 'Finger und Stift schreiben', () => { prefs.finger = prefs.finger === false; savePrefs(); o.remove(); toast(prefs.finger ? 'Der Finger zeichnet jetzt mit.' : 'Mit dem Finger blätterst du jetzt, der Pencil schreibt.'); }),
      A.menuRow('edit', 'Notizbuch umbenennen / Farbe', null, () => { o.remove(); editBook(b); }),
      A.menuRow('trash', 'Seite leeren', null, () => { remember(p); p.strokes = []; p.texts = []; touched(); o.remove(); drawPages(); }, 'danger'),
      b.pages.length > 1 ? A.menuRow('trash', 'Seite löschen', null, async () => {
        o.remove();
        if (!(await confirmDialog(`Seite ${n} löschen?`, 'Löschen'))) return;
        b.pages = b.pages.filter((x) => x !== p); activePage = b.pages[Math.max(0, n - 2)]; touched(); drawPages();
      }, 'danger') : null)]);
  }

  function templateSheet(p) {
    const o = A.sheet('Vorlage', [h('div', { class: 'nb-templates' }, TEMPLATES.map(([v, l]) => h('button', { class: `nb-tpl ${p.template === v ? 'on' : ''}`, onclick: () => { remember(p); p.template = v; touched(); o.remove(); drawPages(); } }, h('span', { class: `nb-tpl-prev tpl-${v}` }), l)))]);
  }

  async function sharePage(p) {
    const c = document.createElement('canvas');
    c.width = 1240; c.height = Math.round(1240 * H / W);
    redraw(c, p);
    const ctx = c.getContext('2d');
    const u = c.width / W;
    for (const t of p.texts) {
      ctx.fillStyle = t.color || '#111827';
      ctx.font = `${(t.size || 24) * u}px Inter, sans-serif`;
      String(t.text || '').split('\n').forEach((line, i) => ctx.fillText(line, t.x * u, (t.y + (t.size || 24) * (1.05 + i * 1.35)) * u));
    }
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const file = new File([blob], `${b.title} – Seite ${b.pages.indexOf(p) + 1}.png`, { type: 'image/png' });
    try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; } } catch (e) { if (e?.name === 'AbortError') return; }
    const a = h('a', { href: URL.createObjectURL(blob), download: file.name }); document.body.append(a); a.click(); a.remove();
  }

  // ---------- Seiten
  const canvases = new Map();
  function pageWidth() { return Math.min(scroller.clientWidth - 24, 900) * prefs.zoom; }

  // Textfeld (Tastatur): Rahmen mit Griff zum Verschieben, darin der eigentliche Text
  function textBox(p, t, pageEl) {
    const el = h('div', { class: 'nb-text', contenteditable: 'true', spellcheck: 'true' });
    el.innerText = t.text || '';
    const grip = h('span', { class: 'nb-grip', 'aria-label': 'Verschieben' }, '⠿');
    const box = h('div', { class: 'nb-text-wrap', 'data-id': t.id }, grip, el);
    const place = () => {
      const pw = pageEl.clientWidth || pageWidth();
      box.style.left = `${(t.x / W) * 100}%`;
      box.style.top = `${(t.y / H) * 100}%`;
      el.style.fontSize = `${((t.size || 24) * pw) / W}px`;
      el.style.color = t.color || '#111827';
    };
    place();
    let before = null;
    el.addEventListener('focus', () => { before = JSON.stringify({ strokes: p.strokes, texts: p.texts, template: p.template }); activePage = p; box.classList.add('on'); });
    el.addEventListener('input', () => { t.text = el.innerText.replace(/\n$/, ''); touched(); });
    el.addEventListener('blur', () => {
      box.classList.remove('on');
      if (!t.text?.trim()) { p.texts = p.texts.filter((x) => x !== t); box.remove(); touched(); }
      if (before && before !== JSON.stringify({ strokes: p.strokes, texts: p.texts, template: p.template })) { undo.push({ page: p, before }); redoStack.length = 0; updateUndo(); }
    });
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const r = pageEl.getBoundingClientRect();
      const start = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y };
      remember(p);
      const move = (ev) => { t.x = Math.max(0, Math.min(W - 40, start.tx + ((ev.clientX - start.x) / r.width) * W)); t.y = Math.max(0, Math.min(H - 40, start.ty + ((ev.clientY - start.y) / r.width) * W)); place(); };
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); touched(); };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    });
    box.focusText = () => el.focus();
    return box;
  }

  function drawPages() {
    const w = pageWidth();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    pagesEl.replaceChildren();
    canvases.clear();
    b.pages.forEach((p, i) => {
      const canvas = h('canvas', { class: 'nb-canvas' });
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round((w * H / W) * ratio);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${(w * H) / W}px`;
      const pageEl = h('div', { class: `nb-page ${p === activePage ? 'active' : ''}`, 'data-page': p.id, style: { width: `${w}px`, height: `${(w * H) / W}px` } }, canvas);
      for (const t of p.texts) add(pageEl, textBox(p, t, pageEl));
      add(pagesEl, pageEl, h('div', { class: 'nb-pno' }, `${i + 1} / ${b.pages.length}`));
      canvases.set(p.id, canvas);
      redraw(canvas, p);
      attachInput(canvas, p, pageEl);
    });
    add(pagesEl, h('button', { class: 'nb-addpage', onclick: () => { const p = newPage(b.pages.at(-1)?.template || b.template); b.pages.push(p); activePage = p; touched(); drawPages(); setTimeout(() => pagesEl.querySelector(`[data-page="${p.id}"]`)?.scrollIntoView({ behavior: 'smooth' }), 60); } }, icon('plus', 22), 'Seite hinzufügen'));
    updateCursor();
  }

  function updateCursor() { pagesEl.dataset.tool = prefs.tool; }

  // ---------- Eingabe: Pencil, Finger, Maus
  function attachInput(canvas, p, pageEl) {
    let stroke = null;
    let scrollFrom = null;
    let lastPt = null;
    const toUnits = (e) => {
      const r = canvas.getBoundingClientRect();
      return [Math.round(((e.clientX - r.left) / r.width) * W * 10) / 10, Math.round(((e.clientY - r.top) / r.height) * H * 10) / 10, Math.round((e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5) * 100)];
    };
    const eraseAt = ([x, y]) => {
      const rad = 14;
      const keep = p.strokes.filter((s) => { for (let i = 0; i < s.p.length; i += 3) if (Math.hypot(s.p[i] - x, s.p[i + 1] - y) < rad + s.w) return false; return true; });
      if (keep.length !== p.strokes.length) { p.strokes = keep; redraw(canvas, p); }
    };
    canvas.addEventListener('pointerdown', (e) => {
      activePage = p;
      pagesEl.querySelectorAll('.nb-page.active').forEach((x) => x.classList.remove('active'));
      pageEl.classList.add('active');
      if (e.pointerType === 'pen' && prefs.finger === null) { prefs.finger = false; savePrefs(); toast('Apple Pencil erkannt: Der Stift schreibt, mit dem Finger blätterst du. Umstellen unter ⋯'); }
      if (e.pointerType === 'touch' && (touches.size > 1 || pinch || prefs.finger === false || prefs.tool === 'hand')) return; // Blättern/Zoomen macht die Seitenansicht
      if (prefs.tool === 'hand') { scrollFrom = { y: e.clientY, x: e.clientX, top: scroller.scrollTop, left: scroller.scrollLeft }; try { canvas.setPointerCapture(e.pointerId); } catch {} return; }
      if (prefs.tool === 'text') {
        e.preventDefault();
        const [x, y] = toUnits(e);
        remember(p);
        const t = { id: uid(), x: Math.max(0, x - 6), y: Math.max(0, y - 20), text: '', size: 24, color: prefs.pen };
        p.texts.push(t);
        const el = textBox(p, t, pageEl);
        add(pageEl, el);
        setTimeout(() => el.focusText(), 0);
        return;
      }
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      const pt = toUnits(e);
      // Kommt ein zweiter Finger dazu (Zoomen), wird der angefangene Strich verworfen
      cancelStroke = () => {
        if (!stroke) return;
        stroke = null; lastPt = null;
        const last = undo.pop();
        if (last?.page === p) Object.assign(p, JSON.parse(last.before));
        redraw(canvas, p); updateUndo();
      };
      if (prefs.tool === 'eraser') { remember(p); stroke = { erase: true }; eraseAt(pt); return; }
      remember(p);
      const hl = prefs.tool === 'marker';
      stroke = { c: hl ? prefs.marker : prefs.pen, w: hl ? 22 : prefs.size, hl, p: [...pt] };
      lastPt = pt;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (scrollFrom) { scroller.scrollTop = scrollFrom.top - (e.clientY - scrollFrom.y); scroller.scrollLeft = scrollFrom.left - (e.clientX - scrollFrom.x); return; }
      if (!stroke || pinch) return;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of evs.length ? evs : [e]) {
        const pt = toUnits(ev);
        if (stroke.erase) { eraseAt(pt); continue; }
        if (lastPt && Math.hypot(pt[0] - lastPt[0], pt[1] - lastPt[1]) < 0.8) continue;
        stroke.p.push(...pt);
        // Live zeichnen: nur das neue Stück
        const ctx = canvas.getContext('2d');
        const u = canvas.width / W;
        ctx.save();
        ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = stroke.c;
        if (stroke.hl) { ctx.globalAlpha = 0.38; ctx.globalCompositeOperation = 'multiply'; }
        ctx.lineWidth = Math.max(0.6, stroke.w * u * (stroke.hl ? 1 : 0.45 + (pt[2] / 100) * 0.9));
        ctx.beginPath(); ctx.moveTo(lastPt[0] * u, lastPt[1] * u); ctx.lineTo(pt[0] * u, pt[1] * u); ctx.stroke();
        ctx.restore();
        lastPt = pt;
      }
    });
    const end = () => {
      if (scrollFrom) { scrollFrom = null; return; }
      if (!stroke) return;
      if (!stroke.erase) { p.strokes.push(stroke); }
      else if (undo.length && undo.at(-1).page === p && undo.at(-1).before === JSON.stringify({ strokes: p.strokes, texts: p.texts, template: p.template })) undo.pop(); // nichts radiert
      stroke = null; lastPt = null;
      redraw(canvas, p); touched(); updateUndo();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  // ---------- Finger: Blättern (mit Schwung) und Zoomen mit zwei Fingern
  // Die Seitenansicht hat touch-action: none – alles läuft hier selbst, damit Pencil, Finger und Zoom sich nicht stören.
  const touches = new Map();
  let pinch = null;
  let pan = null;
  let cancelStroke = null;
  let glide = 0;
  const clampZoom = (z) => Math.max(0.6, Math.min(3, z));
  const two = () => [...touches.values()];

  function startPinch() {
    const [a, c] = two();
    const r = scroller.getBoundingClientRect();
    const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
    pinch = { d0: Math.hypot(a.x - c.x, a.y - c.y) || 1, z0: prefs.zoom, fx: scroller.scrollLeft + mid.x - r.left, fy: scroller.scrollTop + mid.y - r.top, m0: mid, s: 1, dx: 0, dy: 0 };
    pagesEl.style.transformOrigin = `${pinch.fx}px ${pinch.fy}px`;
    pagesEl.style.willChange = 'transform';
  }
  function updatePinch() {
    const [a, c] = two();
    const z = clampZoom(pinch.z0 * (Math.hypot(a.x - c.x, a.y - c.y) / pinch.d0));
    pinch.s = z / pinch.z0;
    pinch.dx = (a.x + c.x) / 2 - pinch.m0.x;
    pinch.dy = (a.y + c.y) / 2 - pinch.m0.y;
    pagesEl.style.transform = `translate(${pinch.dx}px, ${pinch.dy}px) scale(${pinch.s})`;
  }
  function endPinch() {
    const { s, fx, fy, m0, dx, dy, z0 } = pinch;
    pinch = null;
    pagesEl.style.transform = ''; pagesEl.style.willChange = '';
    if (Math.abs(s - 1) < 0.02) { scroller.scrollLeft -= dx; scroller.scrollTop -= dy; return; }
    prefs.zoom = +clampZoom(z0 * s).toFixed(2); savePrefs();
    drawPages();
    const r = scroller.getBoundingClientRect();
    scroller.scrollLeft = fx * s - (m0.x + dx - r.left);
    scroller.scrollTop = fy * s - (m0.y + dy - r.top);
  }
  scroller.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    cancelAnimationFrame(glide);
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) { cancelStroke?.(); cancelStroke = null; pan = null; startPinch(); return; }
    if (touches.size > 2 || e.target.closest?.('.nb-text-wrap, .nb-addpage')) return;
    const fingerDraws = e.target.classList?.contains('nb-canvas') && prefs.finger !== false && !['hand', 'text'].includes(prefs.tool);
    if (!fingerDraws) pan = { x: e.clientX, y: e.clientY, vx: 0, vy: 0, t: performance.now() };
  }, true);
  scroller.addEventListener('pointermove', (e) => {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch) { updatePinch(); return; }
    if (!pan) return;
    const now = performance.now();
    const dx = e.clientX - pan.x, dy = e.clientY - pan.y, dt = Math.max(1, now - pan.t);
    scroller.scrollLeft -= dx; scroller.scrollTop -= dy;
    pan = { x: e.clientX, y: e.clientY, vx: 0.8 * (dx / dt) + 0.2 * pan.vx, vy: 0.8 * (dy / dt) + 0.2 * pan.vy, t: now };
  }, true);
  const lift = (e) => {
    if (!touches.has(e.pointerId)) return;
    touches.delete(e.pointerId);
    if (pinch && touches.size < 2) { endPinch(); pan = null; return; }
    if (pan && !touches.size) {
      let { vx, vy } = pan; pan = null;
      const step = () => { // Schwung auslaufen lassen
        if (Math.abs(vx) < 0.02 && Math.abs(vy) < 0.02) return;
        scroller.scrollLeft -= vx * 16; scroller.scrollTop -= vy * 16; vx *= 0.94; vy *= 0.94;
        glide = requestAnimationFrame(step);
      };
      glide = requestAnimationFrame(step);
    }
  };
  scroller.addEventListener('pointerup', lift, true);
  scroller.addEventListener('pointercancel', lift, true);

  // Zoom auch mit Knöpfen
  const zoomBox = h('div', { class: 'nb-zoom' },
    h('button', { class: 'nb-tool', 'aria-label': 'Verkleinern', onclick: () => { prefs.zoom = Math.max(0.6, +(prefs.zoom - 0.2).toFixed(1)); savePrefs(); drawPages(); } }, icon('minus', 18)),
    h('button', { class: 'nb-tool', 'aria-label': 'Vergrößern', onclick: () => { prefs.zoom = Math.min(2.2, +(prefs.zoom + 0.2).toFixed(1)); savePrefs(); drawPages(); } }, icon('plus', 18)));

  drawBar();
  const screen = h('div', { class: 'screen nb-screen' }, bar, scroller, zoomBox);
  // erst zeichnen, wenn die Breite bekannt ist
  requestAnimationFrame(() => drawPages());
  let rw = 0;
  const ro = new ResizeObserver(() => { if (!scroller.isConnected) { ro.disconnect(); return; } if (Math.abs(scroller.clientWidth - rw) > 30) { rw = scroller.clientWidth; drawPages(); } });
  ro.observe(scroller);
  return screen;
}
