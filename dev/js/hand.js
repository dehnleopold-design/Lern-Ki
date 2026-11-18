// Meine Handschrift: Buchstaben und Wörter mit dem Apple Pencil nachzeichnen. Daraus schreibt Jelly
// Lösungen in deiner Schrift aufs Arbeitsblatt (Ansicht und gesichertes Bild).
//
// Gespeichert in state.hand = { glyphs: { 'a': [ { id, s: [[x,y,x,y,…], …] } ], … }, at }
// Koordinaten in "Zellen-Einheiten": 1 = Zellenhöhe. Hilfslinien: Oberlänge 0.12, Mittellinie 0.42,
// Grundlinie 0.72, Unterlänge 0.92. Großbuchstaben reichen also von 0.12 bis 0.72 (Höhe 0.6).

import { state, save } from './store.js';
import { h, add, icon, toast, confirmDialog } from './ui.js';

export const LINES = { asc: 0.12, mid: 0.42, base: 0.72, desc: 0.92 };
const CAP = LINES.base - LINES.asc;       // 0.6
const EM = 0.7 / CAP;                     // 1 Einheit = 1.1667 em (Großbuchstabe ≈ 0.7 em wie bei Inter)
const GAP = 0.06;                         // Abstand zwischen Buchstaben
const SPACE = 0.32;                       // Leerzeichen
const LINE_H = 0.95;                      // Zeilenabstand
const STROKE = 0.05;                      // Strichstärke

export const PAGES = [
  { id: 'klein', title: 'Kleinbuchstaben', chars: 'abcdefghijklmnopqrstuvwxyzäöüß' },
  { id: 'gross', title: 'Großbuchstaben', chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ' },
  { id: 'zeichen', title: 'Zahlen & Zeichen', chars: '0123456789.,:;!?-+=()/%"\'<>' },
  { id: 'woerter', title: 'Wörter', words: ['Zellkern', 'Photosynthese', 'Lösung', 'Antwort', 'Gleichung', 'Mitochondrien', 'Jahrhundert', 'Quadratwurzel', 'Verb', 'Größe', 'fünf', 'Experiment'] },
];

const hand = () => state.hand || null;
export const handCount = () => Object.values(hand()?.glyphs || {}).reduce((n, v) => n + v.length, 0);
// Bereit, sobald alle Klein- und Großbuchstaben da sind (fehlende Zahlen/Zeichen erscheinen gedruckt)
const NEEDED = PAGES[0].chars + PAGES[1].chars;
export const handMissing = () => [...NEEDED].filter((c) => !hand()?.glyphs?.[c]?.length);
export const handReady = () => handMissing().length === 0;
export const handActive = () => !!state.settings?.handOn && handReady();
export const handVersion = () => (handActive() ? hand()?.at || 1 : 0);

// ---------- Glyphen: Begrenzung vorberechnen
const boxCache = new WeakMap();
function bounds(v) {
  let b = boxCache.get(v);
  if (b) return b;
  let x0 = Infinity, x1 = -Infinity;
  for (const s of v.s) for (let i = 0; i < s.length; i += 2) { x0 = Math.min(x0, s[i]); x1 = Math.max(x1, s[i]); }
  if (!isFinite(x0)) { x0 = 0; x1 = 0.3; }
  b = { x0, x1, w: Math.max(0.05, x1 - x0) };
  boxCache.set(v, b);
  return b;
}

const hash = (n) => { let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); return (x ^ (x >>> 16)) >>> 0; };

function variantOf(ch, seed) {
  const g = hand()?.glyphs || {};
  const list = g[ch]; // nur genau dieses Zeichen – sonst würde aus „DNA“ „dna“
  if (!list?.length) return null;
  return list[hash(seed) % list.length];
}

// Text in Zeilen und Buchstaben zerlegen (Einheiten wie oben). maxW in Einheiten.
export function layout(text, maxW = Infinity, seed = 1) {
  const lines = [];
  let n = 0;
  for (const para of String(text || '').split(/\n/)) {
    let line = { items: [], w: 0 };
    const words = para.split(/ +/);
    for (let wi = 0; wi < words.length; wi++) {
      const word = words[wi];
      const items = [];
      let w = 0;
      for (const ch of word) {
        const v = variantOf(ch, seed * 7919 + n++);
        if (v) { const b = bounds(v); items.push({ v, x: w - b.x0, dy: ((hash(n * 31 + seed) % 100) / 100 - 0.5) * 0.02 }); w += b.w + GAP; }
        else { const cw = /[ilI.,:;!'|]/.test(ch) ? 0.2 : /[mwMW]/.test(ch) ? 0.62 : 0.45; items.push({ ch, x: w }); w += cw + GAP; }
      }
      const start = line.items.length ? line.w + SPACE : 0;
      if (line.items.length && start + w > maxW) { lines.push(line); line = { items: [], w: 0 }; }
      const off = line.items.length ? line.w + SPACE : 0;
      for (const it of items) line.items.push({ ...it, x: it.x + off });
      line.w = off + Math.max(0, w - GAP);
    }
    lines.push(line);
  }
  return { lines, w: Math.max(0.1, ...lines.map((l) => l.w)), h: Math.max(1, lines.length) * LINE_H + 0.05 };
}

// Glatter Pfad durch die Punkte (Mittelpunkte als Kurvenstützen)
function pathD(s, ox, oy) {
  const P = (i) => `${(s[i] + ox).toFixed(3)} ${(s[i + 1] + oy).toFixed(3)}`;
  if (s.length <= 2) return `M${P(0)} l0.001 0`;
  let d = `M${P(0)}`;
  for (let i = 2; i < s.length - 2; i += 2) {
    const mx = (s[i] + s[i + 2]) / 2 + ox, my = (s[i + 1] + s[i + 3]) / 2 + oy;
    d += ` Q${P(i)} ${mx.toFixed(3)} ${my.toFixed(3)}`;
  }
  return `${d} L${P(s.length - 2)}`;
}

const SVGNS = 'http://www.w3.org/2000/svg';
// SVG in em: Größe richtet sich nach der Schriftgröße des Elternelements. maxWidthEm = verfügbare Breite.
export function handSVG(text, maxWidthEm = Infinity, seed = 1) {
  const L = layout(text, maxWidthEm / EM, seed);
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', `-0.04 0.02 ${(L.w + 0.08).toFixed(3)} ${L.h.toFixed(3)}`);
  svg.setAttribute('class', 'hand-svg');
  svg.style.width = `${((L.w + 0.08) * EM).toFixed(3)}em`;
  svg.style.height = `${(L.h * EM).toFixed(3)}em`;
  const ds = [];
  const texts = [];
  L.lines.forEach((line, li) => {
    const oy = li * LINE_H - 0.06;
    for (const it of line.items) {
      if (it.v) for (const s of it.v.s) ds.push(pathD(s, it.x, oy + it.dy));
      else texts.push({ ch: it.ch, x: it.x, y: oy + LINES.base });
    }
  });
  const d = ds.join(' ');
  const mk = (cls, sw) => { const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', d); p.setAttribute('class', cls); p.setAttribute('stroke-width', sw); return p; };
  svg.append(mk('hand-halo', STROKE * 2.6), mk('hand-ink', STROKE));
  for (const t of texts) {
    const el = document.createElementNS(SVGNS, 'text');
    el.setAttribute('x', t.x); el.setAttribute('y', t.y); el.setAttribute('class', 'hand-fallback'); el.setAttribute('font-size', CAP / 0.72);
    el.textContent = t.ch;
    svg.append(el);
  }
  return svg;
}

// Auf ein Canvas zeichnen. emPx = Schriftgröße in Pixeln, maxW in Pixeln.
export function drawHand(c, text, x, y, emPx, maxW, color, seed = 1) {
  const u = emPx * EM;
  const L = layout(text, maxW / u, seed);
  const each = (fn) => L.lines.forEach((line, li) => { const oy = li * LINE_H - 0.06; for (const it of line.items) fn(it, oy); });
  const stroke = (style, w) => {
    c.strokeStyle = style; c.lineWidth = w * u; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath();
    each((it, oy) => {
      if (!it.v) return;
      for (const s of it.v.s) {
        const X = (i) => x + (s[i] + it.x) * u, Y = (i) => y + (s[i + 1] + oy + it.dy) * u;
        c.moveTo(X(0), Y(0));
        if (s.length <= 2) { c.lineTo(X(0) + 0.5, Y(0)); continue; }
        for (let i = 2; i < s.length - 2; i += 2) c.quadraticCurveTo(X(i), Y(i), (X(i) + X(i + 2)) / 2, (Y(i) + Y(i + 2)) / 2);
        c.lineTo(X(s.length - 2), Y(s.length - 2));
      }
    });
    c.stroke();
  };
  stroke('rgba(255,255,255,.9)', STROKE * 2.6);
  stroke(color, STROKE);
  c.fillStyle = color; c.font = `600 ${(CAP / 0.72) * u}px Inter, system-ui, sans-serif`; c.textBaseline = 'alphabetic';
  each((it, oy) => { if (!it.v) c.fillText(it.ch, x + it.x * u, y + (oy + LINES.base) * u); });
  return L.h * u;
}

// ---------- Erfassen: ein Kästchen zum Nachzeichnen
function simplify(pts, eps = 0.0035) {
  if (pts.length <= 4) return pts;
  const keep = new Uint8Array(pts.length / 2); keep[0] = keep[keep.length - 1] = 1;
  const stack = [[0, keep.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = pts[a * 2], ay = pts[a * 2 + 1], bx = pts[b * 2], by = pts[b * 2 + 1];
    const len = Math.hypot(bx - ax, by - ay) || 1e-9;
    let best = -1, bd = 0;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i * 2 + 1]) - (ax - pts[i * 2]) * (by - ay)) / len;
      if (d > bd) { bd = d; best = i; }
    }
    if (bd > eps) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  const out = [];
  keep.forEach((k, i) => { if (k) out.push(+pts[i * 2].toFixed(4), +pts[i * 2 + 1].toFixed(4)); });
  return out;
}

let penSeen = false;

// Ein Kästchen. ch = Vorlage, id = eindeutige Stelle (damit Neuzeichnen die alte Variante ersetzt)
function cell(ch, id, { w = 0.8, joinL = false, joinR = false } = {}) {
  const cv = h('canvas', { class: `hand-cell-cv ${joinL ? 'jl' : ''} ${joinR ? 'jr' : ''}` });
  const wrap = h('div', { class: 'hand-cell', style: { '--w': w } }, cv);
  let strokes = (hand()?.glyphs?.[ch] || []).find((v) => v.id === id)?.s.map((s) => s.slice()) || [];
  let cur = null;
  let px = 0;
  const draw = () => {
    const r = cv.getBoundingClientRect();
    if (!r.width) return;
    const dpr = devicePixelRatio || 1;
    if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
    const c = cv.getContext('2d');
    const H = cv.height; px = H;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cv.width, H);
    // Linien wie im Schreibheft
    c.lineWidth = dpr;
    const line = (y, dash, col) => { c.setLineDash(dash); c.strokeStyle = col; c.beginPath(); c.moveTo(0, y * H); c.lineTo(cv.width, y * H); c.stroke(); };
    line(LINES.asc, [4 * dpr, 4 * dpr], 'rgba(90,70,200,.18)');
    line(LINES.mid, [4 * dpr, 4 * dpr], 'rgba(90,70,200,.28)');
    line(LINES.base, [], 'rgba(90,70,200,.55)');
    line(LINES.desc, [4 * dpr, 4 * dpr], 'rgba(90,70,200,.18)');
    c.setLineDash([]);
    // Vorlage (hell)
    c.fillStyle = strokes.length ? 'rgba(120,100,220,.12)' : 'rgba(120,100,220,.28)';
    c.font = `500 ${(CAP / 0.72) * H}px Inter, system-ui, sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    c.fillText(ch, cv.width / 2, LINES.base * H);
    // Eigene Striche
    c.strokeStyle = '#1d1640'; c.lineWidth = STROKE * H; c.lineCap = 'round'; c.lineJoin = 'round';
    for (const s of [...strokes, ...(cur ? [cur] : [])]) {
      c.beginPath(); c.moveTo(s[0] * H, s[1] * H);
      for (let i = 2; i < s.length; i += 2) c.lineTo(s[i] * H, s[i + 1] * H);
      if (s.length === 2) c.lineTo(s[0] * H + 0.5, s[1] * H);
      c.stroke();
    }
  };
  const pt = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.height, (e.clientY - r.top) / r.height]; };
  cv.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'pen') penSeen = true;
    else if (penSeen && e.pointerType === 'touch') return; // Handballen ignorieren, sobald ein Stift benutzt wurde
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    cur = pt(e);
    draw();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!cur) return;
    for (const ev of e.getCoalescedEvents?.() || [e]) cur.push(...pt(ev));
    draw();
  });
  const end = () => {
    if (!cur) return;
    strokes.push(simplify(cur));
    cur = null;
    commit();
    draw();
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  const commit = () => {
    state.hand = state.hand || { glyphs: {}, at: 0 };
    const list = (state.hand.glyphs[ch] = (state.hand.glyphs[ch] || []).filter((v) => v.id !== id));
    if (strokes.length) list.push({ id, s: strokes });
    if (!list.length) delete state.hand.glyphs[ch];
    state.hand.at = Date.now();
    scheduleSave();
    wrap.classList.toggle('done', strokes.length > 0);
    wrap.dispatchEvent(new CustomEvent('hand-change', { bubbles: true }));
  };
  wrap.classList.toggle('done', strokes.length > 0);
  wrap.clear = () => { strokes = []; commit(); draw(); };
  wrap.undo = () => { strokes.pop(); commit(); draw(); };
  // Kästchen löschen: zweimal schnell antippen geht mit dem Stift schlecht – kleines × oben
  add(wrap, h('button', { class: 'hand-cell-x', 'aria-label': 'Löschen', onclick: (e) => { e.stopPropagation(); wrap.clear(); } }, icon('close', 12)));
  new ResizeObserver(draw).observe(cv);
  requestAnimationFrame(draw);
  return wrap;
}

let saveT = null;
function scheduleSave() { clearTimeout(saveT); saveT = setTimeout(() => save(), 700); }

// ---------- Seite "Meine Handschrift"
export function handView({ topbar, back }) {
  let page = 0;
  const body = h('div', { class: 'hand-body' });
  const tabs = h('div', { class: 'seg hand-tabs' });
  const preview = h('div', { class: 'hand-preview' });
  const status = h('p', { class: 'muted small' });
  let sample = 'Die Zelle hat einen Zellkern. 3 + 4 = 7';
  const drawPreview = () => {
    preview.replaceChildren(handCount() ? handSVG(sample, 30, 3) : h('p', { class: 'muted small' }, 'Hier erscheint gleich dein Text in deiner Schrift.'));
  };
  const drawStatus = () => {
    const missing = handMissing();
    status.textContent = missing.length ? `Noch ${missing.length} Buchstaben fehlen (${missing.slice(0, 8).join(' ')}${missing.length > 8 ? ' …' : ''}), dann kann Jelly in deiner Schrift schreiben. Zahlen, Zeichen und Wörter sind freiwillig – sie machen es schöner.` : `${handCount()} Zeichen gespeichert – Jelly kann in deiner Schrift schreiben.`;
  };
  const drawTabs = () => tabs.replaceChildren(...PAGES.map((p, i) => {
    const done = p.chars ? [...p.chars].filter((c) => hand()?.glyphs?.[c]?.length).length : (hand()?.glyphs && Object.values(hand().glyphs).flat().filter((v) => v.id.startsWith('W:')).length) || 0;
    const total = p.chars ? p.chars.length : p.words.join('').length;
    return h('button', { class: `seg-btn ${page === i ? 'active' : ''}`, onclick: () => { page = i; drawTabs(); drawPage(); } }, `${p.title} ${Math.min(done, total)}/${total}`);
  }));
  const drawPage = () => {
    const p = PAGES[page];
    if (p.chars) {
      body.replaceChildren(h('p', { class: 'muted small' }, 'Fahre die helle Vorlage mit dem Stift nach – so, wie du normal schreibst. Die Linien sind wie im Schulheft. Mit × löschst du ein Kästchen.'),
        h('div', { class: 'hand-grid' }, [...p.chars].map((ch) => cell(ch, `L:${ch}`))));
    } else {
      body.replaceChildren(h('p', { class: 'muted small' }, 'Schreib die Wörter nach, ein Buchstabe pro Kästchen. So lernt Jelly, wie deine Buchstaben im Wort aussehen (jede Variante macht die Schrift natürlicher).'),
        h('div', { class: 'hand-words' }, p.words.map((word, wi) => h('div', { class: 'hand-word' }, [...word].map((ch, ci, arr) => cell(ch, `W:${wi}:${ci}`, { w: 0.62, joinL: ci > 0, joinR: ci < arr.length - 1 }))))));
    }
  };
  const on = h('input', { type: 'checkbox', checked: !!state.settings.handOn, onchange: (e) => {
    if (e.target.checked && !handReady()) { e.target.checked = false; toast('Erst alle Klein- und Großbuchstaben nachzeichnen.', 'error'); return; }
    state.settings.handOn = e.target.checked; save();
  } });
  const detail = h('input', { type: 'checkbox', checked: state.settings.sheetDetail !== false, onchange: (e) => { state.settings.sheetDetail = e.target.checked; save(); } });
  const root = h('div', { class: 'screen' }, topbar({ back, title: 'Meine Handschrift' }),
    h('main', { class: 'content hand-page' },
      h('div', { class: 'card hand-top' },
        h('div', { class: 'label' }, 'So sieht es aus'),
        preview,
        h('input', { class: 'input', value: sample, placeholder: 'Probetext', oninput: (e) => { sample = e.target.value; drawPreview(); } }),
        status,
        h('label', { class: 'hand-toggle' }, on, h('span', {}, h('b', {}, 'Blatt-Löser schreibt in meiner Handschrift'), h('small', { class: 'muted' }, 'Lösungen auf dem Blatt und im gesicherten Bild'))),
        h('label', { class: 'hand-toggle' }, detail, h('span', {}, h('b', {}, 'Auf dem Blatt ausführlich antworten'), h('small', { class: 'muted' }, 'Wo Linien frei sind, in ganzen Sätzen statt Stichworten')))),
      tabs, body,
      h('button', { class: 'btn ghost block danger-text', onclick: async () => {
        if (!(await confirmDialog('Deine ganze Handschrift löschen?', 'Löschen'))) return;
        state.hand = { glyphs: {}, at: Date.now() }; state.settings.handOn = false; save(); on.checked = false; drawPage(); drawTabs(); drawPreview(); drawStatus();
      } }, 'Handschrift löschen')));
  root.addEventListener('hand-change', () => {
    drawPreview(); drawStatus(); drawTabs();
    if (handReady() && state.settings.handOn === undefined) { state.settings.handOn = true; on.checked = true; toast('Fertig – der Blatt-Löser schreibt ab jetzt in deiner Schrift.', 'ok'); }
  });
  drawTabs(); drawPage(); drawPreview(); drawStatus();
  return root;
}
