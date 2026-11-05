// Lernzettel als PDF speichern. Die PDF-Bibliothek wird erst beim ersten Download geladen.
// Auf iPad/iPhone öffnet sich das Teilen-Menü ("In Dateien sichern", AirDrop, …).

import { md, esc } from './ui.js';

const LIB = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
let libPromise = null;

function loadLib() {
  if (window.html2pdf) return Promise.resolve(window.html2pdf);
  if (!libPromise) {
    libPromise = new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = LIB;
      sc.onload = () => resolve(window.html2pdf);
      sc.onerror = () => { libPromise = null; reject(new Error('PDF-Erstellung braucht Internet.')); };
      document.head.append(sc);
    });
  }
  return libPromise;
}

const PRINT_CSS = `
  .lz-print { font-family: Helvetica, Arial, sans-serif; color: #111; font-size: 11pt; line-height: 1.4; padding: 4px 6px; }
  .lz-print h1 { font-size: 18pt; margin: 0 0 2px; }
  .lz-print .sub { color: #555; font-size: 9.5pt; margin-bottom: 12px; border-bottom: 2px solid #3dd6b5; padding-bottom: 6px; }
  .lz-print h4 { font-size: 12.5pt; margin: 14px 0 4px; color: #0b6b58; page-break-after: avoid; }
  .lz-print p { margin: 0 0 6px; }
  .lz-print ul, .lz-print ol { margin: 2px 0 8px; padding-left: 18px; }
  .lz-print li { margin-bottom: 2px; page-break-inside: avoid; }
  .lz-print code { background: #eee; padding: 0 3px; border-radius: 3px; }
`;

const safeName = (s) => String(s).replace(/[^\wäöüÄÖÜß -]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'Lernzettel';

export function lernzettelHTML(title, subtitle, markdown) {
  return `<div class="lz-print"><style>${PRINT_CSS}</style><h1>${esc(title)}</h1><div class="sub">${esc(subtitle)}</div>${md(markdown)}</div>`;
}

async function shareOrDownload(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function downloadLernzettel(title, subtitle, markdown) {
  const html = lernzettelHTML(title, subtitle, markdown);
  const filename = `${safeName(title)}.pdf`;
  try {
    const html2pdf = await loadLib();
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:720px;background:#fff';
    holder.innerHTML = html;
    document.body.append(holder);
    try {
      const blob = await html2pdf().set({
        margin: [12, 12, 14, 12],
        filename,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'], avoid: ['li', 'h4'] },
      }).from(holder.firstChild).outputPdf('blob');
      await shareOrDownload(blob, filename);
    } finally { holder.remove(); }
  } catch (e) {
    // Rückfall: als HTML-Datei (lässt sich in Safari öffnen und drucken)
    const doc = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head><body style="max-width:760px;margin:20px auto;padding:0 16px">${html}</body></html>`;
    await shareOrDownload(new Blob([doc], { type: 'text/html' }), `${safeName(title)}.html`);
    if (!(e instanceof Error && /Internet/.test(e.message))) console.warn(e);
  }
}
