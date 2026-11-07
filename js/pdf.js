// Lernzettel-Dokument (App-Ansicht und PDF). Die PDF-Bibliothek wird erst beim ersten Download geladen.
// Auf iPad/iPhone öffnet sich das Teilen-Menü ("In Dateien sichern", AirDrop, …).

import { md, esc } from './ui.js';

const LIB = 'assets/vendor/html2pdf.bundle.min.js'; // lokal, MIT-Lizenz (html2pdf.js 0.10.1)
let libPromise = null;

function loadLib() {
  if (window.html2pdf) return Promise.resolve(window.html2pdf);
  if (!libPromise) {
    libPromise = new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = LIB;
      sc.onload = () => resolve(window.html2pdf);
      sc.onerror = () => { libPromise = null; reject(new Error('PDF-Bibliothek konnte nicht geladen werden.')); };
      document.head.append(sc);
    });
  }
  return libPromise;
}

// Gemeinsames Aussehen für App und PDF (helles Papier, blaue Akzente).
export const SHEET_CSS = `
.sheet-doc { --ink: #1b2430; --muted: #5d6878; --blue: #1576b8; --blue-soft: #eef5fb; --line: #d9e1ea; --red: #b3261e; --red-soft: #fdf0ef; --green: #127a52; --green-soft: #eaf7f0; --amber: #9a6200; --amber-soft: #fff6e3;
  background: #fff; color: var(--ink); font-family: 'Inter', 'Roboto', Helvetica, Arial, sans-serif; font-size: 10.5pt; line-height: 1.5; }
.sheet-doc .doc-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; border-bottom: 2px solid var(--blue); padding-bottom: 8px; margin-bottom: 14px; }
.sheet-doc .doc-title { font-size: 20pt; font-weight: 800; letter-spacing: -.01em; text-transform: uppercase; line-height: 1.1; margin: 0; color: #111a24; }
.sheet-doc .doc-sub { color: var(--blue); font-weight: 700; font-size: 9.5pt; margin-top: 4px; }
.sheet-doc .doc-meta { text-align: right; color: var(--muted); font-size: 8.5pt; line-height: 1.4; white-space: nowrap; }
.sheet-doc h2 { font-size: 12.5pt; font-weight: 800; text-transform: uppercase; letter-spacing: .02em; color: #111a24; background: #f1f4f8; border-left: 5px solid var(--blue); padding: 6px 10px; margin: 18px 0 10px; break-after: avoid; }
.sheet-doc h3 { font-size: 10.5pt; font-weight: 700; color: var(--blue); margin: 12px 0 5px; break-after: avoid; }
.sheet-doc h4 { font-size: 10pt; font-weight: 700; margin: 10px 0 4px; }
.sheet-doc p { margin: 0 0 7px; }
.sheet-doc ul, .sheet-doc ol { margin: 3px 0 9px; padding-left: 20px; }
.sheet-doc li { margin-bottom: 3px; }
.sheet-doc li > ul, .sheet-doc li > ol { margin: 3px 0 4px; }
.sheet-doc ul ul { list-style: circle; }
.sheet-doc strong { color: #0e151d; }
.sheet-doc em { color: #2d3a4a; }
.sheet-doc code { background: #f1f4f8; padding: 0 4px; border-radius: 3px; font-size: .95em; }
.sheet-doc hr { border: 0; border-top: 1px solid var(--line); margin: 14px 0; }
.sheet-doc .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin: 6px 0 10px; break-inside: avoid; }
.sheet-doc .cols.cards .col { border: 1px solid var(--line); background: #f8fafc; padding: 10px 12px; }
.sheet-doc .cols.cards .col-0 { border-color: #b9cfe2; }
.sheet-doc .cols.cards .col-0 h3 { color: var(--blue); }
.sheet-doc .cols.cards .col-1 { border-color: #f0b8b3; background: var(--red-soft); }
.sheet-doc .cols.cards .col-1 h3 { color: var(--red); }
.sheet-doc .cols .col > :first-child { margin-top: 0; }
.sheet-doc .callout { border: 1px solid #bcd7ee; background: var(--blue-soft); border-radius: 6px; padding: 9px 12px; margin: 10px 0 12px; break-inside: avoid; }
.sheet-doc .callout p:last-child, .sheet-doc .callout ul:last-child { margin-bottom: 0; }
.sheet-doc .c-label { display: inline-block; font-size: 7.5pt; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--blue); background: #dcebf8; padding: 1px 6px; border-radius: 3px; margin-right: 8px; margin-bottom: 4px; }
.sheet-doc .callout.c-example { background: var(--green-soft); border: 0; border-left: 4px solid #2bb37a; border-radius: 0; }
.sheet-doc .callout.c-example .c-label { color: var(--green); background: #d5f0e2; }
.sheet-doc .callout.c-warn { background: var(--red-soft); border-color: #f0c3bf; }
.sheet-doc .callout.c-warn .c-label { color: var(--red); background: #f9dcd9; }
.sheet-doc .callout.c-tip { background: var(--amber-soft); border-color: #f1d9a6; }
.sheet-doc .callout.c-tip .c-label { color: var(--amber); background: #fbe9c2; }
.sheet-doc .tbl-wrap { overflow-x: auto; margin: 8px 0 12px; }
.sheet-doc table { width: 100%; border-collapse: collapse; font-size: 9pt; }
.sheet-doc th { background: #f1f4f8; text-align: left; font-weight: 700; }
.sheet-doc th, .sheet-doc td { border: 1px solid var(--line); padding: 5px 7px; vertical-align: top; }
.sheet-doc tr { break-inside: avoid; }
.sheet-doc blockquote { border-left: 3px solid var(--line); margin: 6px 0; padding-left: 10px; color: var(--muted); }
`;

export function sheetHTML({ title, subtitle, meta = [] }, markdown) {
  return `<div class="sheet-doc"><div class="doc-head"><div><h1 class="doc-title">${esc(title)}</h1>${subtitle ? `<div class="doc-sub">${esc(subtitle)}</div>` : ''}</div>${meta.length ? `<div class="doc-meta">${meta.map(esc).join('<br>')}</div>` : ''}</div>${md(markdown)}</div>`;
}

const safeName = (s) => String(s).replace(/[^\wäöüÄÖÜß -]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'Lernzettel';

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

/** head: { title, subtitle, meta: [..], footer } */
export async function downloadLernzettel(head, markdown) {
  const html = `<style>${SHEET_CSS}</style>${sheetHTML(head, markdown)}`;
  const filename = `${safeName(head.title)}.pdf`;
  try {
    const html2pdf = await loadLib();
    const scrollPos = window.scrollY;
    window.scrollTo(0, 0); // html2canvas rechnet sonst die Scrollposition mit ein
    const holder = document.createElement('div');
    holder.style.cssText = 'position:absolute;left:0;top:0;width:760px;background:#fff;padding:0;z-index:-1';
    holder.innerHTML = html;
    document.body.append(holder);
    try {
      const worker = html2pdf().set({
        margin: [14, 13, 16, 13],
        filename,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'], avoid: ['h2', 'h3', 'li', 'tr', '.callout', '.cols', 'p'] },
      }).from(holder.querySelector('.sheet-doc'));
      const pdf = await worker.toPdf().get('pdf');
      const n = pdf.internal.getNumberOfPages();
      const w = pdf.internal.pageSize.getWidth();
      const hgt = pdf.internal.pageSize.getHeight();
      for (let i = 1; i <= n; i++) {
        pdf.setPage(i);
        pdf.setDrawColor(220, 226, 234);
        pdf.line(13, hgt - 11, w - 13, hgt - 11);
        pdf.setFontSize(8);
        pdf.setTextColor(110, 120, 135);
        pdf.text(head.footer || head.title, 13, hgt - 7);
        pdf.text(`Seite ${i} von ${n}`, w - 13, hgt - 7, { align: 'right' });
      }
      await shareOrDownload(pdf.output('blob'), filename);
    } finally { holder.remove(); window.scrollTo(0, scrollPos); }
  } catch (e) {
    // Rückfall: als HTML-Datei (lässt sich in Safari öffnen und drucken)
    const doc = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(head.title)}</title></head><body style="max-width:800px;margin:20px auto;padding:0 16px">${html}</body></html>`;
    await shareOrDownload(new Blob([doc], { type: 'text/html' }), `${safeName(head.title)}.html`);
    console.warn(e);
  }
}
