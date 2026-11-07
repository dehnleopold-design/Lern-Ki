// Hochgeladene Dateien ansehen: Fotos (mit Zoom), PDFs (alle Seiten, über pdf.js) und Textdateien.

import { state, getBlob } from './store.js';
import { h, icon, toast } from './ui.js';

const PDFJS = 'assets/vendor/pdfjs/pdf.min.mjs';
const PDFJS_WORKER = 'assets/vendor/pdfjs/pdf.worker.min.mjs';
let pdfjsPromise = null;

function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(new URL(PDFJS, document.baseURI).href).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL(PDFJS_WORKER, document.baseURI).href;
      return lib;
    }).catch((e) => { pdfjsPromise = null; throw e; });
  }
  return pdfjsPromise;
}

export const fileKindLabel = (kind) => ({
  material: 'Unterrichtsmaterial', archive: 'Alte Klausuren', sheet: 'Arbeitsblätter', vocab: 'Vokabelseiten', vtest: 'Vokabeltests', answer: 'Deine Antwort-Fotos',
}[kind] || 'Datei');

const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function renderPdf(body, data) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: b64ToBytes(data) }).promise;
  body.replaceChildren();
  const width = Math.min(body.clientWidth || 800, 1100);
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: (width / base.width) * ratio });
    const canvas = h('canvas', { class: 'viewer-page' });
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    body.append(canvas, h('div', { class: 'viewer-pno muted small' }, `Seite ${n} von ${doc.numPages}`));
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    if (!body.isConnected) break; // geschlossen
  }
}

/** Öffnet eine hochgeladene Datei bildschirmfüllend. */
export async function openFile(id) {
  const f = state.files[id];
  const b = await getBlob(id).catch(() => null);
  if (!f || !b?.data) { toast('Die Datei ist auf diesem Gerät nicht (mehr) vorhanden.', 'error'); return; }
  const body = h('div', { class: 'viewer-body' }, h('p', { class: 'muted center' }, 'Lade …'));
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const zoomBtn = h('button', { class: 'iconbtn', 'aria-label': 'Zoom', onclick: () => { overlay.classList.toggle('zoomed'); } }, icon('zoom', 20));
  const overlay = h('div', { class: 'viewer', role: 'dialog', 'aria-label': f.name },
    h('header', { class: 'viewer-head' },
      h('button', { class: 'iconbtn', 'aria-label': 'Schließen', onclick: close }, icon('close', 22)),
      h('div', { class: 'viewer-title' }, h('div', { class: 'viewer-name' }, f.digest?.titel || f.name), h('div', { class: 'muted small' }, fileKindLabel(f.kind))),
      zoomBtn),
    body);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  try {
    if (b.mime.startsWith('image/')) {
      body.replaceChildren(h('img', { class: 'viewer-img', src: `data:${b.mime};base64,${b.data}`, alt: f.name }));
    } else if (b.mime === 'application/pdf') {
      await renderPdf(body, b.data);
    } else {
      body.replaceChildren(h('pre', { class: 'viewer-text' }, new TextDecoder().decode(b64ToBytes(b.data))));
      zoomBtn.remove();
    }
  } catch (e) {
    console.warn(e);
    body.replaceChildren(h('p', { class: 'muted center' }, 'Die Datei konnte nicht angezeigt werden.'));
  }
}
