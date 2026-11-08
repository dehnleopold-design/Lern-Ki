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
  material: 'Unterrichtsmaterial', archive: 'Alte Klausuren', sheet: 'Arbeitsblätter', vocab: 'Vokabelseiten', vtest: 'Vokabeltests', answer: 'Deine Antwort-Fotos', timetable: 'Stundenplan', examplan: 'Klassenarbeitsplan',
}[kind] || 'Datei');

const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function renderPdf(body, data, label) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: b64ToBytes(data) }).promise;
  const width = Math.min(body.clientWidth || 800, 1100);
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: (width / base.width) * ratio });
    const canvas = h('canvas', { class: 'viewer-page' });
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    body.append(canvas, h('div', { class: 'viewer-pno muted small' }, `${label}Seite ${n} von ${doc.numPages}`));
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    if (!body.isConnected) break; // geschlossen
  }
}

// Alle Seiten eines Dokuments (mehrere Bilder, die zusammengehören), erste Seite zuerst
function pagesOf(id) {
  const g = state.files[id]?.group || id;
  return Object.values(state.files).filter((x) => (x.group || x.id) === g)
    .sort((a, b) => (a.id === g ? -1 : b.id === g ? 1 : (a.addedAt || 0) - (b.addedAt || 0))).map((x) => x.id);
}

/** Öffnet eine hochgeladene Datei bildschirmfüllend – bei mehrseitigen Dokumenten alle Seiten. */
export async function openFile(id) {
  const ids = pagesOf(id);
  const f = state.files[ids[0]];
  if (!f) { toast('Die Datei ist auf diesem Gerät nicht (mehr) vorhanden.', 'error'); return; }
  const lead = state.files[ids[0]];
  const body = h('div', { class: 'viewer-body' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const zoomBtn = h('button', { class: 'iconbtn', 'aria-label': 'Zoom', onclick: () => { overlay.classList.toggle('zoomed'); } }, icon('zoom', 20));
  const overlay = h('div', { class: 'viewer', role: 'dialog', 'aria-label': lead.name },
    h('header', { class: 'viewer-head' },
      h('button', { class: 'iconbtn', 'aria-label': 'Schließen', onclick: close }, icon('close', 22)),
      h('div', { class: 'viewer-title' }, h('div', { class: 'viewer-name' }, lead.digest?.titel || lead.name), h('div', { class: 'muted small' }, `${fileKindLabel(lead.kind)}${ids.length > 1 ? ` · ${ids.length} Seiten` : ''}`)),
      zoomBtn),
    body);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  let missing = 0;
  for (let i = 0; i < ids.length; i++) {
    if (!body.isConnected) break;
    const label = ids.length > 1 ? `Bild ${i + 1} von ${ids.length} · ` : '';
    const b = await getBlob(ids[i]).catch(() => null);
    if (!b?.data) { missing++; continue; }
    try {
      if (b.mime.startsWith('image/')) {
        body.append(h('img', { class: 'viewer-img', src: `data:${b.mime};base64,${b.data}`, alt: state.files[ids[i]]?.name || '' }));
        if (ids.length > 1) body.append(h('div', { class: 'viewer-pno muted small' }, `Seite ${i + 1} von ${ids.length}`));
      } else if (b.mime === 'application/pdf') {
        await renderPdf(body, b.data, label);
      } else {
        body.append(h('pre', { class: 'viewer-text' }, new TextDecoder().decode(b64ToBytes(b.data))));
      }
    } catch (e) {
      console.warn(e);
      body.append(h('p', { class: 'muted center' }, 'Diese Seite konnte nicht angezeigt werden.'));
    }
  }
  if (missing) body.append(h('p', { class: 'muted center' }, missing === ids.length ? 'Die Datei ist auf diesem Gerät nicht (mehr) vorhanden.' : `${missing} Seite(n) fehlen auf diesem Gerät.`));
}
