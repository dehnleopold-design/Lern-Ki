// Offline-Tutor: eine kleine KI läuft direkt auf dem Gerät (WebLLM über WebGPU),
// dazu ein eingebauter Rechner, damit Rechenaufgaben immer stimmen.
// Das Modell wird einmal heruntergeladen und liegt dann im Browser-Speicher.

import { ASSETS } from './env.js';
const LIB = `${ASSETS}vendor/web-llm/web-llm.js`;
const WORKER = new URL(`${ASSETS}vendor/web-llm/worker.js`);

export const OFFLINE_MODELS = {
  normal: { name: 'Standard', size: 'ca. 1 GB', f16: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', f32: 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC' },
  klein: { name: 'Klein', size: 'ca. 400 MB', f16: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC', f32: 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC' },
};
const LS_SIZE = 'jelly-offline-size';
const LS_LOADING = 'jelly-offline-loading';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };

let lib = null;
let engine = null;
let engineModel = null;
let loading = null;
let f16 = null;

// Ist die App beim letzten Laden abgestürzt (zu wenig Speicher)? Dann aufs kleine Modell wechseln.
let crashNote = '';
{
  const was = lsGet(LS_LOADING);
  if (was) {
    lsSet(LS_LOADING, null);
    if (OFFLINE_MODELS.normal.f16 === was || OFFLINE_MODELS.normal.f32 === was) {
      lsSet(LS_SIZE, 'klein');
      crashNote = 'Das Standard-Modell war zu groß für dieses Gerät. Ich habe auf das kleine Modell umgestellt.';
    }
  }
}
export const takeCrashNote = () => { const n = crashNote; crashNote = ''; return n; };

export const offlineSize = () => (lsGet(LS_SIZE) === 'klein' ? 'klein' : 'normal');
export function setOfflineSize(s) { lsSet(LS_SIZE, s === 'klein' ? 'klein' : 'normal'); }

// WebGPU vorhanden? Gibt null zurück, wenn alles passt, sonst einen Grund.
export async function offlineSupport() {
  if (!('gpu' in navigator)) return 'Dieser Browser kann keine KI auf dem Gerät rechnen (WebGPU fehlt). Auf dem iPad: neuestes iPadOS und Safari nutzen.';
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return 'Die Grafikeinheit dieses Geräts ist für die Offline-KI nicht verfügbar.';
    f16 = adapter.features.has('shader-f16');
    return null;
  } catch { return 'WebGPU konnte nicht gestartet werden.'; }
}

async function modelId() {
  if (f16 === null) await offlineSupport();
  const m = OFFLINE_MODELS[offlineSize()];
  return f16 ? m.f16 : m.f32;
}

async function loadLib() {
  if (!lib) lib = await import(LIB);
  return lib;
}

export async function offlineDownloaded() {
  try {
    if (await offlineSupport()) return false;
    const { hasModelInCache } = await loadLib();
    return await hasModelInCache(await modelId());
  } catch { return false; }
}

// Lädt (beim ersten Mal: herunterladen) und startet das Modell. onProgress(0..1, text)
export async function offlineLoad(onProgress) {
  const id = await modelId();
  if (engine && engineModel === id) return engine;
  if (loading) return loading;
  loading = (async () => {
    const why = await offlineSupport();
    if (why) throw new Error(why);
    const { CreateWebWorkerMLCEngine } = await loadLib();
    try { await navigator.storage?.persist?.(); } catch {}
    if (engine) { try { await engine.unload(); } catch {} engine = null; }
    // Merker nur für die Phase, in der das Modell in den Speicher geladen wird (dort stürzt ein zu kleines Gerät ab)
    const cached = await lib.hasModelInCache(id).catch(() => false);
    if (cached) lsSet(LS_LOADING, id);
    try {
      engine = await CreateWebWorkerMLCEngine(new Worker(WORKER, { type: 'module' }), id, {
        initProgressCallback: (r) => { if ((r.progress ?? 0) >= 0.99) lsSet(LS_LOADING, id); onProgress?.(r.progress ?? 0, r.text || ''); },
      });
      engineModel = id;
      return engine;
    } finally { lsSet(LS_LOADING, null); }
  })();
  try { return await loading; } finally { loading = null; }
}

export async function offlineDelete() {
  const { deleteModelAllInfoInCache } = await loadLib();
  if (engine) { try { await engine.unload(); } catch {} engine = null; engineModel = null; }
  for (const m of Object.values(OFFLINE_MODELS)) for (const id of [m.f16, m.f32]) { try { await deleteModelAllInfoInCache(id); } catch {} }
}

// ---------------------------------------------------------------- Rechner
// Versteht z. B. „Wurzel aus 121“, „12 mal 7“, „2 hoch 10“, „15 % von 80“, „(3+4)*2“, „3,5 geteilt durch 2“.
const fmt = (x) => {
  if (!Number.isFinite(x)) return null;
  const r = Math.round(x * 1e6) / 1e6;
  return String(r).replace('.', ',');
};

function normalizeMath(text) {
  let s = ` ${String(text).toLowerCase()} `
    .replace(/[?!=]/g, ' ')
    .replace(/\b(was|wie ?viel|wieviel|ist|sind|ergibt|ergeben|berechne|rechne|bitte|mal eben|kannst du|sag mir|mir|die|das|der|von der|aus der|ungefähr|genau|denn|eigentlich|nochmal)\b/g, ' ')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/²/g, ' ^2 ').replace(/³/g, ' ^3 ')
    .replace(/(quadrat)?wurzel\s*(aus|von)?/g, ' √ ')
    .replace(/zum quadrat|quadrat/g, ' ^2 ')
    .replace(/hoch/g, ' ^ ')
    .replace(/(\d)\s*x\s*(\d)/g, '$1*$2')
    .replace(/\bmal\b|[×·]/g, ' * ')
    .replace(/geteilt durch|durch|÷|:/g, ' / ')
    .replace(/\bplus\b|\bund\b/g, ' + ')
    .replace(/\bminus\b|\bweniger\b|−/g, ' - ')
    .replace(/(prozent|%)\s*(von)?/g, ' % ')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

function parseMath(src) {
  const toks = src.match(/\d+(?:\.\d+)?|[-+*/^()√%]/g);
  if (!toks || toks.join('') !== src.replace(/\s+/g, '')) return null;
  let i = 0;
  const peek = () => toks[i];
  const take = () => toks[i++];
  const expr = () => { let v = term(); while (peek() === '+' || peek() === '-') { const op = take(); const r = term(); v = op === '+' ? v + r : v - r; } return v; };
  const term = () => {
    let v = unary();
    while (['*', '/', '%'].includes(peek())) {
      const op = take();
      if (op === '%') { const r = unary(); v = (v / 100) * r; continue; } // „15 % von 80“
      const r = unary(); v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const unary = () => { if (peek() === '-') { take(); return -unary(); } if (peek() === '√') { take(); return Math.sqrt(unary()); } return power(); };
  const power = () => { const b = primary(); if (peek() === '^') { take(); return b ** unary(); } return b; };
  const primary = () => {
    const t = take();
    if (t === '(') { const v = expr(); if (take() !== ')') throw new Error('Klammer'); return v; }
    if (t !== undefined && /^\d/.test(t)) return parseFloat(t);
    throw new Error('Zahl erwartet');
  };
  try { const v = expr(); return i === toks.length ? v : null; } catch { return null; }
}

/** Gibt { frage, ergebnis, text } zurück, wenn die Nachricht eine reine Rechenaufgabe ist – sonst null. */
export function mathAnswer(text) {
  const s = normalizeMath(text);
  if (!s || !/\d/.test(s) || !/[-+*/^√%]/.test(s) || s.length > 80) return null;
  const v = parseMath(s);
  const res = v === null ? null : fmt(v);
  if (res === null) return null;
  const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻' };
  const pretty = s.replace(/\s*\^\s*(-?\d+)(?![.\d])/g, (_, n) => [...n].map((c) => SUP[c]).join(''))
    .replace(/\s*\^\s*/g, '^').replace(/\*/g, ' · ').replace(/\//g, ' : ').replace(/\s*%\s*/g, ' % von ').replace(/\./g, ',').replace(/√ ?/g, '√').replace(/\s+/g, ' ').trim();
  let why = '';
  const m = s.match(/^√ ?(\d+(?:\.\d+)?)$/);
  if (m && Number.isInteger(v)) why = `\n\nWeil ${fmt(v)} · ${fmt(v)} = ${fmt(+m[1])}.`;
  else if (m) why = `\n\n${fmt(+m[1])} ist keine Quadratzahl, deshalb ist das Ergebnis gerundet.`;
  const pm = s.match(/^(\d+(?:\.\d+)?) % (\d+(?:\.\d+)?)$/);
  if (pm) why = `\n\nRechnung: ${fmt(+pm[2])} : 100 · ${fmt(+pm[1])} = ${res}.`;
  return { frage: pretty, ergebnis: res, text: `**${pretty} = ${res}**${why}` };
}

// ---------------------------------------------------------------- Material passend zur Frage
const STOP = new Set('aber alle als also auch auf aus bei bin bis bitte dann dass dem den der des die dies diese dir doch dort durch ein eine einem einen einer eines erklär erkläre erklären etwas für gibt habe haben hast hat hier ich ihr ist jetzt kann kannst keine mal man mehr mich mir mit muss nach nicht noch nur oder ohne sich sie sind so über um und uns unter vom von vor war was weil welche welcher wenn wer wie wieder wir wird wo zu zum zur zwischen'.split(' '));
const words = (t) => String(t).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[a-zß0-9]{4,}/g) || [];

export function pickContext(fullText, question, maxChars = 1800) {
  const paras = String(fullText || '').split(/\n{2,}|\n(?=#{1,3} |- )/).map((x) => x.trim()).filter(Boolean);
  const chunks = [];
  let cur = '';
  for (const p of paras) { if ((cur + '\n' + p).length > 600 && cur) { chunks.push(cur); cur = p; } else cur = cur ? `${cur}\n${p}` : p; }
  if (cur) chunks.push(cur);
  const q = [...new Set(words(question).filter((w) => !STOP.has(w)))].map((w) => w.slice(0, 6));
  const scored = chunks.map((c, i) => {
    const cw = words(c);
    const score = q.reduce((a, w) => a + cw.filter((x) => x.startsWith(w)).length, 0);
    return { c, i, score };
  });
  let pick = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  if (!pick.length) pick = scored.slice(0, 2); // nichts Passendes: Überblick vom Anfang
  const out = [];
  let len = 0;
  for (const x of pick) { if (len + x.c.length > maxChars) { if (!out.length) out.push(x.c.slice(0, maxChars)); break; } out.push(x.c); len += x.c.length; }
  return out.join('\n\n');
}

/**
 * Antwortet offline. history: [{ role: 'user'|'model', text }], onToken(textBisher) für Live-Anzeige.
 */
export async function offlineChat({ system, history = [], text, onToken, onProgress }) {
  const eng = await offlineLoad(onProgress);
  const messages = [{ role: 'system', content: system }];
  for (const m of history.slice(-4)) messages.push({ role: m.role === 'model' ? 'assistant' : 'user', content: String(m.text).slice(0, 800) });
  messages.push({ role: 'user', content: text });
  const stream = await eng.chat.completions.create({ messages, stream: true, temperature: 0.3, max_tokens: 380 });
  let out = '';
  for await (const chunk of stream) {
    out += chunk.choices?.[0]?.delta?.content || '';
    onToken?.(out);
  }
  return out.trim();
}

export function offlineSystem({ subject, grade, material }) {
  return `Du bist Jelly, ein freundlicher Lern-Tutor für Schüler${grade ? ` der Klasse ${grade}` : ''}${subject ? ` im Fach ${subject}` : ''}.
Regeln:
- Antworte immer auf Deutsch, kurz und einfach: höchstens 6 Sätze oder eine kurze Liste.
- Nutze das MATERIAL unten, wenn es zur Frage passt. Erfinde nichts dazu.
- Wenn du dir nicht sicher bist, sag ehrlich: „Da bin ich offline nicht sicher – frag mich nochmal, wenn du Internet hast.“
- Bei „Frag mich ab“: stelle EINE kurze Frage zum Material und warte auf die Antwort.
- Kein LaTeX, keine Formelzeichen wie $; schreib Formeln einfach (x², 3/4).

MATERIAL:
${material || '(kein passendes Material gefunden)'}`;
}
