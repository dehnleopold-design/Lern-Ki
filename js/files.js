// Dateien einlesen: Fotos werden verkleinert (spart Datenvolumen und KI-Limit), PDFs bleiben wie sie sind.

import { state, save, putBlob, getBlob, deleteBlob, uid } from './store.js';

const MAX_SIDE = 2000;

function readAsDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function compressImage(file) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    return { blob, mime: 'image/jpeg' };
  } catch {
    return { blob: file, mime: file.type || 'image/jpeg' };
  }
}

export async function fileToStored(file) {
  let blob = file;
  let mime = file.type || '';
  if (!mime && /\.pdf$/i.test(file.name)) mime = 'application/pdf';
  if (!mime && /\.(txt|md)$/i.test(file.name)) mime = 'text/plain';
  if (mime.startsWith('image/')) ({ blob, mime } = await compressImage(file));
  if (!(mime.startsWith('image/') || mime === 'application/pdf' || mime.startsWith('text/'))) {
    throw new Error(`Dateityp nicht unterstützt: ${file.name}. Erlaubt sind Fotos, PDFs und Textdateien.`);
  }
  const dataUrl = await readAsDataURL(blob);
  const data = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return { mime: mime.startsWith('text/') ? 'text/plain' : mime, data, size: blob.size };
}

export async function addFile(file, { kind, subjectId }) {
  const stored = await fileToStored(file);
  if (stored.size > 18 * 1024 * 1024) throw new Error(`${file.name} ist größer als 18 MB. Bitte aufteilen.`);
  const id = uid();
  await putBlob(id, { mime: stored.mime, data: stored.data });
  state.files[id] = { id, name: file.name || 'Foto', mime: stored.mime, size: stored.size, kind, subjectId, digest: null, addedAt: Date.now() };
  save();
  return id;
}

export async function removeFile(id) {
  delete state.files[id];
  save();
  try { await deleteBlob(id); } catch {}
}

export async function filePart(id) {
  const b = await getBlob(id);
  if (!b) throw new Error('Datei nicht gefunden.');
  return { file: { mime: b.mime, data: b.data } };
}

export async function thumbURL(id) {
  const f = state.files[id];
  if (!f || !f.mime.startsWith('image/')) return null;
  const b = await getBlob(id);
  return b ? `data:${b.mime};base64,${b.data}` : null;
}

export function pickFiles({ accept = 'image/*,application/pdf,.pdf,.txt', multiple = true, capture } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    if (capture) input.capture = capture;
    input.onchange = () => resolve([...(input.files || [])]);
    input.click();
  });
}
