// GoodNotes-Mitschriften: PDFs aus GoodNotes (Export oder Auto-Backup) einem Fach zuordnen
// und große Notizbücher in lesbare Teile zerlegen.

import { state } from './store.js';
import { loadPdfJs } from './viewer.js';

// Ab dieser Größe wird ein PDF in Seitenbilder zerlegt (KI-Limit pro Anfrage ~20 MB)
const SPLIT_BYTES = 14 * 1024 * 1024;
// Ab so vielen Seiten ebenfalls zerlegen – sonst liest die KI ein Riesen-Heft nur oberflächlich
const SPLIT_PAGES = 30;
const PAGES_PER_PART = 15;
const MAX_SIDE = 1600;

export const baseName = (name) => String(name || 'Notizbuch').replace(/\.pdf$/i, '').trim() || 'Notizbuch';

// Übliche Abkürzungen der Fächer, damit „Mathe Heft 10b.pdf“ zu „Mathematik“ findet
const ALIASES = [
  ['mathematik', 'mathe', 'ma'], ['deutsch', 'de'], ['englisch', 'english', 'engl', 'en'], ['französisch', 'franzoesisch', 'franz', 'french', 'fr'],
  ['spanisch', 'span', 'español', 'sp'], ['latein', 'lat', 'la'], ['biologie', 'bio'], ['chemie', 'chem', 'ch'], ['physik', 'phy', 'ph'],
  ['geschichte', 'geschi', 'ge'], ['erdkunde', 'geographie', 'geografie', 'geo', 'ek'], ['politik', 'powi', 'sowi', 'sozialkunde', 'gemeinschaftskunde', 'gk', 'wirtschaft', 'wipo'],
  ['religion', 'reli', 'ethik', 'philosophie', 'philo'], ['informatik', 'info', 'inf'], ['kunst', 'ku'], ['musik', 'mu'], ['sport'], ['nawi', 'naturwissenschaften'],
];
const norm = (s) => String(s || '').toLowerCase().replace(/[_\-.()[\]]+/g, ' ');

// Fach aus dem Dateinamen raten. Gibt die id des Fachs zurück oder null.
export function guessSubject(fileName) {
  const words = ` ${norm(baseName(fileName))} `;
  const has = (w) => w && (w.length >= 4 ? words.includes(w) : new RegExp(`[\\s\\d]${w}[\\s\\d]`).test(words));
  let best = null;
  let bestLen = 0;
  for (const s of state.subjects || []) {
    const name = norm(s.name).trim();
    const group = ALIASES.find((g) => g.some((a) => name === a || name.startsWith(a))) || [];
    const keys = [name, norm(s.short).trim(), ...group];
    for (const k of keys) if (has(k) && k.length > bestLen) { best = s.id; bestLen = k.length; }
  }
  return best;
}

async function pageImage(page, label) {
  const v = page.getViewport({ scale: 1 });
  const scale = Math.min(2, MAX_SIDE / Math.max(v.width, v.height));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
  canvas.width = canvas.height = 0;
  return new File([blob], label, { type: 'image/jpeg' });
}

/**
 * Zerlegt ein GoodNotes-PDF in Teile. Kleine PDFs bleiben ein Teil (das PDF selbst).
 * Große werden als Seitenbilder in Teile zu je 15 Seiten gepackt.
 * Gibt [{ files: File[], label }] zurück. onProgress(seite, seiten) für die Anzeige.
 */
export async function splitNotebook(file, onProgress) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const base = baseName(file.name);
  if (!isPdf) return [{ files: [file], label: base }];
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const n = doc.numPages;
  if (file.size <= SPLIT_BYTES && n <= SPLIT_PAGES) { doc.destroy(); return [{ files: [file], label: base }]; }
  const parts = [];
  const total = Math.ceil(n / PAGES_PER_PART);
  for (let k = 0; k < total; k++) {
    const from = k * PAGES_PER_PART + 1;
    const to = Math.min(n, from + PAGES_PER_PART - 1);
    const label = `${base} (S. ${from}–${to})`;
    const files = [];
    for (let p = from; p <= to; p++) {
      onProgress?.(p, n);
      const page = await doc.getPage(p);
      files.push(await pageImage(page, p === from ? label : `${base} S. ${p}`));
      page.cleanup();
    }
    parts.push({ files, label });
  }
  doc.destroy();
  return parts;
}
