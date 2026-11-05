// Verbindung zur KI. Standard: Google Gemini (hat eine kostenlose Stufe und liest Bilder + PDFs).
// Alternative: jeder OpenAI-kompatible Anbieter (z. B. Groq, OpenRouter) – dort nur Text + Bilder.

import { state } from './store.js';

export class AIError extends Error {}

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

export function aiReady() {
  const s = state.settings;
  if (s.provider === 'openai') return !!(s.baseUrl && s.oaModel);
  return !!(s.apiKey && s.model);
}

export async function listGeminiModels(key) {
  const res = await fetch(`${GEMINI}/models?pageSize=200&key=${encodeURIComponent(key)}`);
  if (!res.ok) {
    const body = await res.text();
    throw new AIError(res.status === 400 || res.status === 403
      ? 'Der API-Schlüssel wurde abgelehnt. Bitte prüfen.'
      : `Fehler ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name }))
    .filter((m) => /gemini/i.test(m.id) && !/(image|tts|audio|live|embed|vision-only|robotics|computer-use)/i.test(m.id));
}

// Bevorzugt ein aktuelles "Flash"-Modell (schnell, in der Regel in der Gratis-Stufe).
function modelScore(id) {
  let sc = 0;
  if (/flash/i.test(id)) sc += 100;
  if (/lite/i.test(id)) sc -= 30;
  if (/preview|exp/i.test(id)) sc -= 10;
  if (/latest/i.test(id)) sc += 5;
  const v = parseFloat((id.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || '0');
  return sc + v * 10;
}

// Bevorzugt ein aktuelles "Flash"-Modell (schnell, in der Regel in der Gratis-Stufe).
export function pickDefaultModel(models) {
  return [...models].sort((a, b) => modelScore(b.id) - modelScore(a.id))[0]?.id || '';
}

function friendly(status, body) {
  if (status === 429) return 'Limit der kostenlosen Stufe erreicht. Warte ein paar Minuten (oder bis morgen) oder wähle in den Einstellungen ein anderes Modell.';
  if (status === 400 && /API key/i.test(body)) return 'Der API-Schlüssel ist ungültig.';
  if (status === 403) return 'Zugriff verweigert – API-Schlüssel oder Modell prüfen.';
  if (status === 404) return 'Dieses Modell gibt es nicht (mehr). Bitte in den Einstellungen ein anderes wählen.';
  if (status === 503 || status === 500 || status === 502 || status === 504) return 'Die Google-Server sind gerade überlastet (passiert in der kostenlosen Stufe öfter). Ich habe es mehrmals und mit anderen Modellen versucht. Bitte in ein paar Minuten nochmal – bisher Gelesenes bleibt gespeichert.';
  if (status === 413) return 'Die Dateien sind zu groß für eine Anfrage. Bitte weniger oder kleinere Dateien hochladen.';
  return `KI-Fehler ${status}: ${body.slice(0, 300)}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Statusmeldungen (z. B. "Server überlastet, neuer Versuch …") an die Oberfläche melden.
let statusListener = null;
export function onAIStatus(fn) { statusListener = fn; }
const report = (msg) => { try { statusListener?.(msg); } catch {} };

// Ersatzmodelle, falls das gewählte Modell überlastet ist oder sein Limit erreicht hat.
// Nur Flash-Modelle, weil nur die in der kostenlosen Stufe sind.
async function fallbackModels() {
  const s = state.settings;
  if (s.provider === 'openai') return [];
  if (!s.models?.length) {
    try { s.models = await listGeminiModels(s.apiKey); } catch { return []; }
  }
  return s.models
    .filter((m) => m.id !== s.model && /flash/i.test(m.id) && !/preview|exp/i.test(m.id))
    .sort((a, b) => modelScore(b.id) - modelScore(a.id))
    .slice(0, 2)
    .map((m) => m.id);
}

const RETRY_WAIT = [3000, 8000, 15000];
// Modelle, die gerade überlastet waren, werden 5 Minuten lang hintenangestellt.
const cooldown = {};
const COOLDOWN_MS = 5 * 60 * 1000;
const cooling = (m) => cooldown[m] && Date.now() - cooldown[m] < COOLDOWN_MS;

/**
 * parts: Array aus { text } oder { file: { mime, data } } (data = base64)
 * history: Array aus { role: 'user'|'model', text } (für Chats)
 * Bei Überlastung (503) bis zu 3 neue Versuche, danach automatisch ein anderes Flash-Modell.
 * Bei erreichtem Limit (429) sofort ein anderes Modell.
 */
export async function generate({ system, parts, history = [], json = false, temperature = 0.4 }) {
  if (!aiReady()) throw new AIError('Die KI ist noch nicht eingerichtet. Gehe zu Einstellungen → KI.');
  const s = state.settings;
  const args = { system, parts, history, json, temperature };
  let models = [s.model];
  let fallbacksLoaded = false;
  if (cooling(s.model)) {
    const fb = (await fallbackModels()).filter((m) => !cooling(m));
    models = [...fb, s.model];
    fallbacksLoaded = true;
  }
  let lastErr = null;
  for (let mi = 0; mi < models.length; mi++) {
    const model = models[mi];
    if (mi > 0) report(`Wechsle auf ${model} …`);
    for (let attempt = 0; attempt <= RETRY_WAIT.length; attempt++) {
      try {
        const text = s.provider === 'openai' ? await callOpenAI(args) : await callGemini(args, model);
        report('');
        return json ? parseJSON(text) : text;
      } catch (e) {
        lastErr = e;
        if (e.status === 429 || (e.retryable && attempt === RETRY_WAIT.length)) cooldown[model] = Date.now();
        if (!e.retryable || attempt === RETRY_WAIT.length || e.status === 429) break;
        const wait = RETRY_WAIT[attempt];
        report(`Google-Server gerade überlastet – neuer Versuch in ${wait / 1000} s (${attempt + 1}/${RETRY_WAIT.length}) …`);
        await sleep(wait);
      }
    }
    if (!(lastErr?.retryable || lastErr?.status === 429)) break;
    if (!fallbacksLoaded) { models = [...models, ...(await fallbackModels())]; fallbacksLoaded = true; }
  }
  report('');
  throw lastErr;
}

async function callGemini({ system, parts, history, json, temperature }, model) {
  const s = state.settings;
  const toParts = (ps) => ps.map((p) => (p.file
    ? { inline_data: { mime_type: p.file.mime, data: p.file.data } }
    : { text: p.text }));
  const contents = [
    ...history.map((m) => ({ role: m.role === 'model' ? 'model' : 'user', parts: [{ text: m.text }] })),
    { role: 'user', parts: toParts(parts) },
  ];
  const body = {
    contents,
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    generationConfig: { temperature, ...(json ? { responseMimeType: 'application/json' } : {}) },
  };
  let res;
  try {
    res = await fetch(`${GEMINI}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(s.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    const err = new AIError('Keine Verbindung zur KI. Bist du online?');
    err.retryable = true;
    throw err;
  }
  if (!res.ok) {
    const txt = await res.text();
    const err = new AIError(friendly(res.status, txt));
    err.retryable = res.status >= 500;
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const cand = data.candidates?.[0];
  if (!cand) throw new AIError(`Die KI hat nichts geantwortet${data.promptFeedback?.blockReason ? ` (blockiert: ${data.promptFeedback.blockReason})` : ''}.`);
  const text = (cand.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
  if (!text) throw new AIError(`Leere Antwort (Grund: ${cand.finishReason || 'unbekannt'}).`);
  return text;
}

async function callOpenAI({ system, parts, history, json, temperature }) {
  const s = state.settings;
  const content = parts.map((p) => {
    if (!p.file) return { type: 'text', text: p.text };
    if (p.file.mime.startsWith('image/')) return { type: 'image_url', image_url: { url: `data:${p.file.mime};base64,${p.file.data}` } };
    if (p.file.mime.startsWith('text/')) return { type: 'text', text: b64ToText(p.file.data) };
    throw new AIError('PDFs kann nur Gemini lesen. Fotografiere die Seiten oder wechsle in den Einstellungen zu Gemini.');
  });
  const messages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    ...history.map((m) => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text })),
    { role: 'user', content },
  ];
  const url = s.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(s.oaKey ? { Authorization: `Bearer ${s.oaKey}` } : {}) },
      body: JSON.stringify({ model: s.oaModel, messages, temperature, ...(json ? { response_format: { type: 'json_object' } } : {}) }),
    });
  } catch {
    const err = new AIError('Keine Verbindung zur KI. Bist du online?');
    err.retryable = true;
    throw err;
  }
  if (!res.ok) {
    const txt = await res.text();
    const err = new AIError(friendly(res.status, txt));
    err.retryable = res.status >= 500;
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

function b64ToText(b64) {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function parseJSON(text) {
  try { return JSON.parse(text); } catch {}
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const a = cleaned.indexOf('{');
  const b = cleaned.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(cleaned.slice(a, b + 1)); } catch {}
  }
  throw new AIError('Die KI hat ungültige Daten geliefert. Bitte nochmal versuchen.');
}
