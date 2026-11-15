// Feier-Animationen, passend zum App-Stil. Bei „Bewegung reduzieren“ nur die Nachricht.

import { mascot } from './ui.js';

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const PALETTES = {
  standard: ['#8b5cf6', '#b794ff', '#f472b6', '#fbbf24', '#34d399'],
  hell: ['#7c3aed', '#ec4899', '#f59e0b', '#10b981', '#3b82f6'],
  altmodisch: ['#8c2f22', '#b07a12', '#4d7c3a', '#3a2914', '#d9c49a'],
  pastell: ['#f9a8d4', '#c4b5fd', '#fde68a', '#86efac', '#93c5fd'],
  ozean: ['#26c6f9', '#94e6ff', '#ffffff', '#5eead4', '#a78bfa'],
  schulheft: ['#2557d6', '#dc2626', '#16a34a', '#f59e0b', '#1c2742'],
};

let layer = null;
function stage() {
  if (!layer || !layer.isConnected) {
    layer = document.createElement('div');
    layer.className = 'fx-layer';
    document.body.append(layer);
  }
  return layer;
}

function badge(host, title, sub, skin) {
  const b = document.createElement('div');
  b.className = `fx-badge fx-badge-${skin}`;
  b.innerHTML = '<div class="fx-badge-j"></div><div class="fx-badge-t"></div><div class="fx-badge-s"></div>';
  b.querySelector('.fx-badge-j').append(mascot(70, 'normal'));
  b.querySelector('.fx-badge-t').textContent = title;
  b.querySelector('.fx-badge-s').textContent = sub || '';
  host.append(b);
}

function confetti(host, colors, n = 70, jellies = true) {
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    const isJelly = jellies && i % 9 === 0;
    p.className = isJelly ? 'fx-p fx-jelly' : 'fx-p';
    if (isJelly) p.append(mascot(34));
    else { p.style.background = pick(colors); p.style.width = `${rnd(7, 13)}px`; p.style.height = `${rnd(10, 18)}px`; p.style.borderRadius = Math.random() < .3 ? '50%' : '2px'; }
    p.style.setProperty('--x0', `${rnd(35, 65)}vw`);
    p.style.setProperty('--dx', `${rnd(-45, 45)}vw`);
    p.style.setProperty('--up', `${rnd(30, 62)}vh`);
    p.style.setProperty('--rot', `${rnd(-720, 720)}deg`);
    p.style.animationDuration = `${rnd(1.6, 2.6)}s`;
    p.style.animationDelay = `${rnd(0, .25)}s`;
    host.append(p);
  }
}

function pixels(host) {
  const cols = ['#ff4f8b', '#ffd23f', '#3ddc84', '#4fc3ff', '#ffffff'];
  for (let i = 0; i < 48; i++) {
    const p = document.createElement('i');
    p.className = 'fx-px';
    p.style.background = pick(cols);
    const a = (i / 48) * Math.PI * 2;
    const r = rnd(18, 42);
    p.style.setProperty('--tx', `${Math.cos(a) * r}vmin`);
    p.style.setProperty('--ty', `${Math.sin(a) * r}vmin`);
    p.style.animationDelay = `${(i % 4) * .05}s`;
    host.append(p);
  }
}

function stars(host) {
  for (let i = 0; i < 14; i++) {
    const s = document.createElement('i');
    s.className = 'fx-star';
    s.style.top = `${rnd(5, 55)}vh`;
    s.style.left = `${rnd(-10, 60)}vw`;
    s.style.animationDelay = `${rnd(0, .9)}s`;
    host.append(s);
  }
  for (let i = 0; i < 40; i++) {
    const g = document.createElement('i');
    g.className = 'fx-glint';
    g.style.top = `${rnd(10, 90)}vh`; g.style.left = `${rnd(5, 95)}vw`;
    g.style.animationDelay = `${rnd(0, 1.2)}s`;
    host.append(g);
  }
}

function rings(host) {
  for (let i = 0; i < 4; i++) {
    const r = document.createElement('i');
    r.className = 'fx-ring';
    r.style.animationDelay = `${i * .18}s`;
    host.append(r);
  }
}

function glyphs(host) {
  for (let i = 0; i < 26; i++) {
    const g = document.createElement('i');
    g.className = 'fx-glyph';
    g.textContent = Array.from({ length: 8 }, () => pick(['0', '1', '>', '_', '#', '+'])).join('\n');
    g.style.left = `${(i / 26) * 100}vw`;
    g.style.animationDelay = `${rnd(0, .6)}s`;
    g.style.animationDuration = `${rnd(1.4, 2.4)}s`;
    host.append(g);
  }
}

/** Zeigt eine Feier. title/sub: Text in der Mitte. */
export function celebrate({ title, sub = '' }) {
  const skin = document.documentElement.dataset.skin || 'standard';
  const host = document.createElement('div');
  host.className = `fx fx-${skin}`;
  stage().append(host);
  if (!reduced()) {
    if (skin === 'pixel') pixels(host);
    else if (skin === 'galaxis') stars(host);
    else if (skin === 'futuristisch') { rings(host); confetti(host, ['#00e5ff', '#7df9ff', '#a855f7'], 30, false); }
    else if (skin === 'terminal') glyphs(host);
    else confetti(host, PALETTES[skin] || PALETTES.standard);
  }
  badge(host, skin === 'terminal' ? `> ${title}` : title, sub, skin);
  try { navigator.vibrate?.(30); } catch {}
  host.addEventListener('click', () => host.remove());
  setTimeout(() => host.classList.add('fx-out'), 2600);
  setTimeout(() => host.remove(), 3100);
}
