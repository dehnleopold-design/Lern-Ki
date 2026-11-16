// Ränge: Abzeichen oben rechts, Rang-Ansicht zum Durchblättern, fliegende XP.
// Eigene Embleme (Jelly mit rangtypischem Schmuck) – Farbwelt je Rang: Bronze orange, Silber blau-violett,
// Gold gelb, Diamant blau, Mythisch magenta, Legendär rot, Meister grün, Pro schwarz-gold.

import { h } from './ui.js';
import { RANKS, rankOf, xpTotal, hasTopRank, XP_UNIT } from './rewards.js';

const LOOK = [
  { c: '#d9772a', hi: '#f5a65b', d: '#6e3208', bg: ['#f08a24', '#8a3c06'], ink: '#ffb866' },
  { c: '#6676d9', hi: '#a9b4ff', d: '#232a78', bg: ['#2f7cf0', '#0a2f8c'], ink: '#c9d2ff' },
  { c: '#f4b41c', hi: '#ffe27a', d: '#7a4a00', bg: ['#f5ad0c', '#8a5200'], ink: '#ffe45c' },
  { c: '#1f6bff', hi: '#7ad4ff', d: '#08268c', bg: ['#1a5fe8', '#061c70'], ink: '#4fe0ff' },
  { c: '#c22bd6', hi: '#f08bff', d: '#4c0a70', bg: ['#b322c4', '#3a0766'], ink: '#ff7bf2' },
  { c: '#e3212f', hi: '#ff8a70', d: '#650606', bg: ['#e8301c', '#4d0808'], ink: '#ff5a55' },
  { c: '#3fd62c', hi: '#b6ff7a', d: '#0a4a10', bg: ['#22b83a', '#053818'], ink: '#74ff4a' },
  { c: '#26232b', hi: '#facc15', d: '#0c0b0f', bg: ['#8d8494', '#16141a'], ink: '#ffe94a' },
];
const ROMAN = ['I', 'II', 'III'];

// Schmuck hinter/über der Qualle – macht jeden Rang unterscheidbar
const DECOR = [
  '',
  '<path d="M22 44 8 30l10 30-6 22 18-12zM98 44l14-14-10 30 6 22-18-12z"/>',
  '<path d="M60 4 70 26H50zM30 14l16 16-18 6zM90 14 74 30l18 6z"/>',
  '<path d="M60 2 100 24 108 66 60 98 12 66 20 24z"/>',
  '<path d="M26 40 20 8l20 18L60 2l20 24 20-18-6 32z"/>',
  '<path d="M18 74C2 60 6 38 16 26c0 12 6 18 12 20-2-14 6-26 16-32-2 12 4 18 8 22zM102 74c16-14 12-36 2-48 0 12-6 18-12 20 2-14-6-26-16-32 2 12-4 18-8 22z"/>',
  '<path d="M60 2 74 30 96 12 90 46 108 52 84 70H36L12 52l18-6-6-34 22 18z"/>',
  '<path d="M60 44 6 26l10 30-12 6 22 10-6 18 40-22zM60 44l54-18-10 30 12 6-22 10 6 18-40-22z"/><path d="M42 26 38 6l12 10 10-14 10 14 12-10-4 20z" class="crown"/>',
];
const BODY = 'M26 68C26 38 42 22 60 22s34 16 34 46v8q-8.500 9-17 0-8.500 9-17 0-8.500 9-17 0-8.500 9-17 0z';

export function rankEmblem(index, size = 40) {
  const L = LOOK[index];
  const sticker = (d, fill, cls = '') => `<path d="${d}" fill="none" stroke="#0b0a0e" stroke-width="13" stroke-linejoin="round"/><path d="${d}" fill="${fill}" stroke="#fff" stroke-width="5" stroke-linejoin="round" class="${cls}"/>`;
  const decor = DECOR[index].replace(/<path d="([^"]+)"( class="crown")?\/>/g, (_, d, crown) => sticker(d, crown ? '#facc15' : index === 7 ? '#e7e3ee' : L.hi));
  return `<svg viewBox="-4 -6 128 128" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
${decor}${sticker(BODY, L.c)}
<path d="M34 62C34 42 46 30 60 30" fill="none" stroke="${index === 7 ? '#57505f' : L.hi}" stroke-width="5" stroke-linecap="round" opacity=".8"/>
<path d="M40 52q9-3 15 5-8 5-15-5zM80 52q-9-3-15 5 8 5 15-5z" fill="#fff"/>
<path d="M53 66q7 5 14 0" fill="none" stroke="#fff" stroke-width="3.500" stroke-linecap="round"/>
<g stroke="#0b0a0e" stroke-width="9" stroke-linecap="round"><path d="M40 86v14M60 88v18M80 86v14"/></g>
<g stroke="${index === 7 ? '#facc15' : L.hi}" stroke-width="4.500" stroke-linecap="round"><path d="M40 86v14M60 88v18M80 86v14"/></g>
</svg>`.replace(/\.500/g, '.5');
}

// ---------------------------------------------------------------- Abzeichen oben rechts
let chipEl = null;
export function rankChip() {
  const r = rankOf();
  const fill = h('i', { style: { width: `${Math.round(r.frac * 100)}%`, background: LOOK[r.index].ink } });
  chipEl = h('button', { class: 'rank-chip', 'aria-label': `Dein Rang: ${r.name}`, onclick: () => openRanks() },
    h('span', { class: 'rank-chip-em', html: rankEmblem(r.index, 34) }),
    h('span', { class: 'rank-chip-txt' }, h('span', { class: 'rank-chip-name' }, r.next ? `${r.name} ${ROMAN[r.step]}` : r.name), h('span', { class: 'rank-chip-bar' }, fill)));
  chipEl._fill = fill;
  return chipEl;
}

// Setzt das Abzeichen in die Kopfleiste (rechts) – auf jeder Seite mit Kopfleiste
export function placeRankChip(root) {
  const bar = root.querySelector('.topbar');
  if (!bar) { chipEl = null; return; }
  // Nie doppelt: vorhandene Abzeichen auf der Seite zuerst entfernen
  root.querySelectorAll('.rank-chip').forEach((x) => x.remove());
  const last = bar.lastElementChild;
  const chip = rankChip();
  if (last?.classList.contains('iconbtn-spacer')) last.replaceWith(chip);
  else bar.append(chip);
}

// ---------------------------------------------------------------- XP fliegen zum Abzeichen
// items: [{ xp, label }]; before/after: rankOf() vor und nach dem Gutschreiben; onRankUp(after) für die Feier
export function flyXp(items, before, after, onRankUp) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let chip = chipEl?.isConnected ? chipEl : null;
  let temp = null;
  if (!chip) { // Seite ohne Kopfleiste: Abzeichen kurz einblenden
    temp = rankChip(); temp.classList.add('rank-chip-float'); document.body.append(temp); chip = temp;
  }
  const fill = chip._fill;
  fill.style.width = `${Math.round(before.frac * 100)}%`;
  const total = items.reduce((a, x) => a + x.xp, 0);
  const span = before.next ? before.span : 1;
  let got = 0;
  const land = (xp) => {
    got += xp;
    const frac = after.index > before.index ? Math.min(1, before.frac + got / span) : before.frac + (after.frac - before.frac) * (got / total);
    fill.style.width = `${Math.round(Math.min(1, frac) * 100)}%`;
    chip.classList.remove('bump'); void chip.offsetWidth; chip.classList.add('bump');
    try { navigator.vibrate?.(12); } catch {}
  };
  const finish = () => {
    const up = after.index > before.index;
    setTimeout(() => {
      if (up) onRankUp?.(after);
      if (temp) temp.remove();
      else if (chip.isConnected) { const fresh = rankChip(); chip.replaceWith(fresh); if (up) fresh.classList.add('bump'); }
    }, 500);
  };
  items.forEach((it, i) => {
    setTimeout(() => {
      if (reduced) { land(it.xp); if (i === items.length - 1) finish(); return; }
      // Weiche, geschwungene Bahn: kurz aufsteigen, dann im Bogen zum Abzeichen gleiten
      const inner = h('div', { class: 'xp-pill' }, `+${it.xp} XP`, it.label ? h('small', {}, it.label) : null);
      const pill = h('div', { class: 'xp-fly' }, inner);
      document.body.append(pill);
      const to = chip.getBoundingClientRect();
      const spread = items.length > 1 ? (i - (items.length - 1) / 2) * 70 : 0;
      const x0 = innerWidth / 2 + spread, y0 = innerHeight * 0.6;
      const x1 = to.left + to.width / 2, y1 = to.top + to.height / 2;
      // Kontrollpunkt der Kurve: oberhalb des Starts, leicht zur Seite – ergibt einen ruhigen Bogen
      const cx = x0 + (x1 - x0) * 0.08, cy = y1 + (y0 - y1) * 0.22; // bleibt immer im Bild
      const N = 28, frames = [];
      for (let k = 0; k <= N; k++) {
        const t = k / N, u = 1 - t;
        const x = u * u * x0 + 2 * u * t * cx + t * t * x1, y = u * u * y0 + 2 * u * t * cy + t * t * y1;
        frames.push({ transform: `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%) scale(${(1 - 0.62 * t * t).toFixed(3)})`, opacity: t > 0.85 ? (1 - (t - 0.85) / 0.15 * 0.6).toFixed(2) : 1 });
      }
      pill.style.transform = frames[0].transform;
      // 1) sanft erscheinen und kurz stehen, 2) gleiten
      inner.animate([{ transform: 'translateY(18px) scale(.7)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(.2, .9, .3, 1.2)', fill: 'both' });
      const a = pill.animate(frames, { duration: 950, delay: 620, easing: 'cubic-bezier(.45, 0, .2, 1)', fill: 'forwards' });
      a.onfinish = () => { pill.remove(); land(it.xp); if (i === items.length - 1) finish(); };
    }, i * 260);
  });
}

// ---------------------------------------------------------------- Rang-Ansicht (alle Ränge durchblättern)
export function openRanks() {
  const me = rankOf();
  let at = me.index;
  const view = h('div', { class: 'rk-view' });
  const close = () => view.remove();
  const draw = () => {
    const r = RANKS[at], L = LOOK[at], next = RANKS[at + 1];
    const mine = at === me.index, done = at < me.index;
    const frac = mine ? me.frac : done ? 1 : 0;
    view.style.setProperty('--rk-a', L.bg[0]); view.style.setProperty('--rk-b', L.bg[1]); view.style.setProperty('--rk-ink', L.ink);
    const marks = next ? [0, 1, 2, 3].map((i) => h('span', { class: `rk-mark ${frac >= i / 3 - 0.001 && (mine || done) ? 'on' : ''}`, style: { left: `${(i / 3) * 100}%` } },
      h('b', {}, i < 3 ? ROMAN[i] : ''), h('small', {}, String(Math.round(r.min + ((next.min - r.min) * i) / 3))))) : [];
    view.replaceChildren(
      h('div', { class: 'rk-rays' }),
      h('button', { class: 'rk-close', 'aria-label': 'Schließen', onclick: close }, '‹'),
      h('div', { class: 'rk-top' }, h('div', { class: 'rk-title' }, 'Dein Rang'), h('div', { class: 'rk-xp' }, `${xpTotal()} XP${hasTopRank() ? ' · höchster Rang freigeschaltet' : ''}`)),
      h('div', { class: 'rk-stage' },
        h('button', { class: 'rk-arrow', disabled: at === 0 || undefined, 'aria-label': 'Vorheriger Rang', onclick: () => { at--; draw(); } }, '‹'),
        h('div', { class: 'rk-center' },
          h('div', { class: `rk-emblem ${mine || done ? '' : 'locked'}`, html: rankEmblem(at, 240) }),
          h('div', { class: 'rk-name' }, r.name),
          h('div', { class: 'rk-state' }, mine ? (next ? `Stufe ${ROMAN[me.step]} · noch ${next.min - me.xp} XP bis ${next.name}` : 'Höchster Rang erreicht') : done ? 'Geschafft ✓' : `🔒 Ab ${r.min} XP`)),
        h('button', { class: 'rk-arrow', disabled: at === RANKS.length - 1 || undefined, 'aria-label': 'Nächster Rang', onclick: () => { at++; draw(); } }, '›')),
      next ? h('div', { class: 'rk-bar' }, h('div', { class: 'rk-track' }, h('i', { style: { width: `${Math.round(frac * 100)}%` } })), marks,
        mine ? h('span', { class: 'rk-me', style: { left: `${Math.round(frac * 100)}%` } }, String(me.xp)) : null)
        : h('div', { class: 'rk-bar rk-pro' }, 'Ganz oben. Mehr geht nicht.'),
      h('div', { class: 'rk-dots' }, RANKS.map((x, i) => h('button', { class: `rk-dot ${i === at ? 'on' : ''} ${i <= me.index ? 'have' : ''}`, 'aria-label': x.name, onclick: () => { at = i; draw(); }, html: rankEmblem(i, 30) }))),
      h('div', { class: 'rk-how' }, `So gibt es XP: Lerneinheit +${XP_UNIT} · Quiz +20 bis +100 (je nach Ergebnis) · jede korrigierte Aufgabe +10 bis +50 (je nach Punkten)`));
  };
  // Wischen zum Blättern
  let x0 = null;
  view.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  view.addEventListener('pointerup', (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0; x0 = null;
    if (Math.abs(dx) < 60) return;
    const n = at + (dx < 0 ? 1 : -1);
    if (n >= 0 && n < RANKS.length) { at = n; draw(); }
  });
  draw();
  document.body.append(view);
}
