// Jahreszeiten-Deko: Weihnachten, Silvester, Halloween, Ostern – automatisch nach Datum oder fest gewählt.
// Fügt eine leichte Effekt-Ebene hinzu und setzt Jelly einen passenden Hut auf.

import { setJellyHat } from './ui.js';

export const SEASONS = [
  { id: 'auto', name: 'Automatisch' },
  { id: 'weihnachten', name: 'Weihnachten' },
  { id: 'silvester', name: 'Silvester' },
  { id: 'halloween', name: 'Halloween' },
  { id: 'ostern', name: 'Ostern' },
  { id: 'aus', name: 'Aus' },
];

// Ostersonntag (Gauß/Meeus)
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}

export function seasonFor(date = new Date()) {
  const m = date.getMonth() + 1, d = date.getDate();
  if ((m === 12 && d >= 30) || (m === 1 && d <= 1)) return 'silvester';
  if (m === 12 && d <= 26) return 'weihnachten';
  if (m === 10 && d >= 24) return 'halloween';
  const e = easter(date.getFullYear());
  const diff = Math.round((new Date(date.getFullYear(), m - 1, d) - e) / 86400000);
  if (diff >= -3 && diff <= 1) return 'ostern';
  return null;
}

export const activeSeason = (setting = 'auto') => (setting === 'aus' ? null : setting === 'auto' || !setting ? seasonFor() : setting);
export const seasonName = (id) => SEASONS.find((s) => s.id === id)?.name || '';

const rnd = (a, b) => a + Math.random() * (b - a);
let current = undefined;
let layer = null;

function build(season) {
  const el = document.createElement('div');
  el.className = `season season-${season}`;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (season === 'weihnachten') {
    for (let i = 0; i < (reduced ? 0 : 36); i++) {
      const f = document.createElement('i');
      f.className = 'snow';
      const s = rnd(3, 8);
      f.style.cssText = `left:${rnd(0, 100)}vw;width:${s}px;height:${s}px;opacity:${rnd(.35, .85)};animation-duration:${rnd(9, 18)}s;animation-delay:${rnd(-18, 0)}s;--drift:${rnd(-40, 40)}px`;
      el.append(f);
    }
  } else if (season === 'halloween') {
    for (let i = 0; i < (reduced ? 0 : 4); i++) {
      const b = document.createElement('i');
      b.className = 'bat';
      b.textContent = '🦇';
      b.style.cssText = `top:${rnd(8, 40)}vh;animation-duration:${rnd(14, 22)}s;animation-delay:${rnd(-20, 0)}s;font-size:${rnd(18, 30)}px`;
      el.append(b);
    }
  } else if (season === 'silvester') {
    for (let i = 0; i < (reduced ? 0 : 5); i++) {
      const fw = document.createElement('i');
      fw.className = 'firework';
      fw.style.cssText = `left:${rnd(10, 90)}vw;top:${rnd(6, 30)}vh;animation-delay:${rnd(0, 6)}s;--c:${['#fbbf24', '#f472b6', '#60a5fa', '#34d399', '#c084fc'][i % 5]}`;
      el.append(fw);
    }
  } else if (season === 'ostern') {
    for (let i = 0; i < 5; i++) {
      const egg = document.createElement('i');
      egg.className = 'egg';
      egg.textContent = ['🥚', '🐣', '🌷', '🥚', '🌼'][i];
      egg.style.cssText = `left:${8 + i * 21}vw;animation-delay:${i * .4}s`;
      el.append(egg);
    }
  }
  return el;
}

/** Wendet die Jahreszeit an (nur wenn sie sich geändert hat). */
export function applySeason(setting) {
  const season = activeSeason(setting);
  if (season === current && (!season || layer?.isConnected)) return;
  current = season;
  layer?.remove();
  layer = null;
  setJellyHat(season);
  document.documentElement.dataset.season = season || '';
  if (season) { layer = build(season); document.body.append(layer); }
}
