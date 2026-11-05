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
export function pickDefaultModel(models) {
  const score = (id) => {
    let s = 0;
    if (/flash/i.test(id)) s += 100;
    if (/lite/i.test(id)) s -= 30;
    if (/preview|exp/i.test(id)) s -= 10;
    if (/latest/i.test(id)) s += 5;
    const v = parseFloat((id.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || '0');
    return s + v * 10;
  };
  return [...models].sort((a, b) => score(b.id) - score(a.id))[0]?.id || '';
}

function friendly(status, body) {
  if (status === 429) return 'Limit der kostenlosen Stufe erreicht. Warte ein paar Minuten (oder bis morgen) oder wähle in den Einstellungen ein anderes Modell.';
  if (status === 400 && /API key/i.test(body)) return 'Der API-Schlüssel ist ungültig.';
  if (status === 403) return 'Zugriff verweigert – API-Schlüssel oder Modell prüfen.';
  if (status === 404) return 'Dieses Modell gibt es nicht (mehr). Bitte in den Einstellungen ein anderes wählen.';
  if (status === 413) return 'Die Dateien sind zu groß für eine Anfrage. Bitte weniger oder kleinere Dateien hochladen.';
  return `KI-Fehler ${status}: ${body.slice(0, 300)}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * parts: Array aus { text } oder { file: { mime, data } } (data = base64)
 * history: Array aus { role: 'user'|'model', text } (für Chats)
 */
export async function generate({ system, parts, history = [], json = false, temperature = 0.4 }) {
  if (!aiReady()) throw new AIError('Die KI ist noch nicht eingerichtet. Gehe zu Einstellungen → KI.');
  const s = state.settings;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const text = s.provider === 'openai'
        ? await callOpenAI({ system, parts, history, json, temperature })
        : await callGemini({ system, parts, history, json, temperature });
      return json ? parseJSON(text) : text;
    } catch (e) {
      const retry = e.retryable && attempt < 2;
      if (!retry) throw e;
      await sleep(1500 * (attempt + 1));
    }
  }
}

async function callGemini({ system, parts, history, json, temperature }) {
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
    res = await fetch(`${GEMINI}/models/${encodeURIComponent(s.model)}:generateContent?key=${encodeURIComponent(s.apiKey)}`, {
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
