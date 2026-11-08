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
  if (status === 429 && /PerDay/i.test(body)) return 'Tageslimit der kostenlosen Stufe erreicht. Es setzt sich um 9 Uhr (deutsche Zeit) zurück.';
  if (status === 429) return 'Limit der kostenlosen Stufe erreicht (zu viele Anfragen pro Minute). Gleich nochmal versuchen.';
  if (status === 413) return 'Die Anfrage ist für diesen Anbieter zu groß.';
  if (status === 400 && /API key/i.test(body)) return 'Der API-Schlüssel ist ungültig.';
  if (status === 403) return 'Zugriff verweigert – API-Schlüssel oder Modell prüfen.';
  if (status === 404) return 'Dieses Modell gibt es nicht (mehr). Bitte in den Einstellungen ein anderes wählen.';
  if (status === 503 || status === 500 || status === 502 || status === 504) return 'Die Google-Server sind gerade überlastet (passiert in der kostenlosen Stufe öfter). Ich habe alle kostenlosen Modelle mehrmals probiert. Bitte später nochmal – bisher Gelesenes bleibt gespeichert. Tipp: Abends/am Wochenende ist oft weniger los.';
  if (status === 413) return 'Die Dateien sind zu groß für eine Anfrage. Bitte weniger oder kleinere Dateien hochladen.';
  return `KI-Fehler ${status}: ${body.slice(0, 300)}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Statusmeldungen (z. B. "Server überlastet, neuer Versuch …") an die Oberfläche melden.
let statusListener = null;
export function onAIStatus(fn) { statusListener = fn; }
const report = (msg) => { try { statusListener?.(msg); } catch {} };

// Alle kostenlosen Modelle (Flash + Flash-Lite), bestes zuerst. Pro-Modelle sind nicht kostenlos.
async function freeModels() {
  const s = state.settings;
  if (!s.models?.length) {
    try { s.models = await listGeminiModels(s.apiKey); } catch { s.models = []; }
  }
  const ids = s.models.map((m) => m.id).filter((id) => /flash/i.test(id) && !/exp/i.test(id));
  return [...new Set([s.model, ...ids.sort((x, y) => modelScore(y) - modelScore(x))])].filter(Boolean).slice(0, 6);
}

// Merkt sich, welches Modell zuletzt funktioniert hat, und welche gerade überlastet sind.
// Überlastete Modelle werden 10 Minuten übersprungen, Modelle am Tageslimit 60 Minuten.
// Im Browser wird das gespeichert, damit nicht jede neue Anfrage erst alle Modelle durchprobiert.
let lastWorking = null;
const COOL_KEY = 'lernki-cool';
const cooldown = (() => { try { return JSON.parse(localStorage.getItem(COOL_KEY)) || {}; } catch { return {}; } })();
const cooling = (m) => (cooldown[m] || 0) > Date.now();
function cool(m, e) {
  cooldown[m] = Date.now() + (e?.daily ? 60 : 10) * 60000;
  try { localStorage.setItem(COOL_KEY, JSON.stringify(cooldown)); } catch {}
}
function uncool(m) {
  if (!cooldown[m]) return;
  delete cooldown[m];
  try { localStorage.setItem(COOL_KEY, JSON.stringify(cooldown)); } catch {}
}
const why = (e) => e?.pdf ? 'kann keine PDFs' : e?.daily ? 'Tageslimit' : e?.status === 429 ? 'Minutenlimit' : e?.status === 413 ? 'Anfrage zu groß' : e?.status ? `überlastet (${e.status})` : /zu lange/.test(e?.message || '') ? 'keine Antwort' : 'Fehler';
const ROUND_WAIT = [0, 10000, 25000, 45000]; // Pausen zwischen den Runden durch alle Modelle

/**
 * parts: Array aus { text } oder { file: { mime, data } } (data = base64)
 * history: Array aus { role: 'user'|'model', text } (für Chats)
 * Ist ein Modell überlastet (503) oder am Limit (429), wird sofort das nächste kostenlose
 * Modell probiert. Sind alle überlastet, wird in bis zu 4 Runden mit Pausen erneut probiert.
 */
// web: true → Gemini darf die Links im Text selbst abrufen (URL context). Ersatz-Anbieter können das nicht.
export async function generate({ system, parts, history = [], json = false, temperature = 0.4, web = false }) {
  if (!aiReady()) throw new AIError('Die KI ist noch nicht eingerichtet. Gehe zu Einstellungen → KI.');
  const s = state.settings;
  const args = { system, parts, history, json, temperature, web };
  if (web && s.provider === 'openai') throw new AIError('Links kann nur Gemini öffnen. Mach stattdessen Screenshots der Seite und lade sie hoch.');
  if (s.provider === 'openai') {
    const text = await callOpenAI(args);
    return json ? parseJSON(text) : text;
  }
  const all = await freeModels();
  let lastErr = null;
  let fallbackTried = false;
  const log = new Map(); // was jedes Modell geantwortet hat (für eine ehrliche Fehlermeldung)
  const fail = (e) => {
    if (log.size) e.message = `${e.message}\n\nAntworten: ${[...log].map(([m, w]) => `${m}: ${w}`).join(' · ')}`;
    return e;
  };
  const fb = async () => {
    try { return await tryFallback(args); } catch (e) { log.set(FALLBACK_PRESETS[s.fb?.preset]?.label || 'Ersatz', why(e)); if (!e.pdf) lastErr = e; return undefined; }
  };
  const canFallback = fallbackReady() && !web; // der Ersatz kann keine Webseiten öffnen
  // Sind gerade alle Gemini-Modelle als überlastet bekannt? Dann direkt den Ersatz fragen.
  if (canFallback && all.length && all.every(cooling)) {
    fallbackTried = true;
    const r = await fb(); if (r !== undefined) return r;
  }
  for (let round = 0; round < ROUND_WAIT.length; round++) {
    if (round === 1 && canFallback) { /* Ersatz sofort, ohne Wartezeit */ } else if (ROUND_WAIT[round]) {
      for (let left = ROUND_WAIT[round] / 1000; left > 0; left--) {
        report(`Alle kostenlosen Google-Modelle sind gerade überlastet. Neuer Versuch in ${left} s (Runde ${round + 1}/${ROUND_WAIT.length}) …${fallbackReady() ? '' : ' Tipp: Unter Mehr → KI-Verbindung einen Ersatz-Anbieter einrichten, dann geht es ohne Warten weiter.'}`);
        await sleep(1000);
      }
    }
    // Reihenfolge: zuletzt funktionierendes Modell, dann nicht überlastete, dann der Rest
    const order = [...new Set([lastWorking, ...all.filter((m) => !cooling(m)), ...all])].filter((m) => m && all.includes(m));
    if (round === 1 && canFallback && !fallbackTried) {
      fallbackTried = true;
      const r = await fb(); if (r !== undefined) return r;
    }
    for (const model of order) {
      if (model !== s.model || round > 0) report(`Versuche ${model} …`);
      try {
        const text = await callGemini(args, model);
        lastWorking = model;
        uncool(model);
        report('');
        return json ? parseJSON(text) : text;
      } catch (e) {
        lastErr = e;
        log.set(model, why(e));
        if (!(e.retryable || e.status === 429 || e.status === 404)) { report(''); throw fail(e); }
        cool(model, e);
        if (lastWorking === model) lastWorking = null;
      }
    }
  }
  if (canFallback && !fallbackTried) {
    const r = await fb(); if (r !== undefined) return r;
  }
  report('');
  // Alle Modelle am Tageslimit? Dann ist "überlastet" die falsche Meldung.
  const g = [...log].filter(([m]) => all.includes(m));
  if (g.length && g.every(([, w]) => w === 'Tageslimit')) {
    lastErr = new AIError('Das Tageslimit aller kostenlosen Gemini-Modelle ist für heute aufgebraucht. Es setzt sich um 9 Uhr (deutsche Zeit) zurück.' + (fallbackReady() ? '' : ' Bis dahin hilft ein Ersatz-Anbieter (Mehr → KI-Verbindung).'));
  }
  throw fail(lastErr);
}

async function callGemini({ system, parts, history, json, temperature, web }, model) {
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
    ...(web ? { tools: [{ url_context: {} }] } : {}),
  };
  let res;
  try {
    res = await fetch(`${GEMINI}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(s.apiKey)}`, {
      signal: AbortSignal.timeout(150000),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const err = new AIError(e?.name === 'TimeoutError' ? 'Die KI hat zu lange nicht geantwortet.' : 'Keine Verbindung zur KI. Bist du online?');
    err.retryable = true;
    throw err;
  }
  if (!res.ok) {
    const txt = await res.text();
    const err = new AIError(web && res.status === 400 && /tool|url_context/i.test(txt) ? 'Google kann die Links mit diesem Schlüssel/Modell gerade nicht öffnen. Mach Screenshots der Seite und lade sie hoch.' : friendly(res.status, txt));
    err.retryable = res.status >= 500;
    err.status = res.status;
    err.daily = res.status === 429 && /PerDay/i.test(txt);
    throw err;
  }
  const data = await res.json();
  const cand = data.candidates?.[0];
  if (!cand) throw new AIError(`Die KI hat nichts geantwortet${data.promptFeedback?.blockReason ? ` (blockiert: ${data.promptFeedback.blockReason})` : ''}.`);
  const text = (cand.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
  if (!text) throw new AIError(`Leere Antwort (Grund: ${cand.finishReason || 'unbekannt'}).`);
  return text;
}

// Kürzt den längsten Textteil (meist das Unterrichtsmaterial), bis alles unter maxChars passt.
function shrinkParts(parts, system, maxChars) {
  const len = (system || '').length + parts.reduce((n, p) => n + (p.text?.length || 0), 0);
  if (len <= maxChars) return parts;
  const out = parts.map((p) => ({ ...p }));
  const big = out.filter((p) => p.text).sort((a, b) => b.text.length - a.text.length)[0];
  if (!big) return parts;
  const keep = Math.max(2000, big.text.length - (len - maxChars));
  big.text = big.text.slice(0, keep) + '\n[… Material gekürzt, weil der Anbieter nur kurze Anfragen erlaubt]';
  return out;
}

// Groq erlaubt kostenlos nur wenige Tausend Tokens pro Minute (Antwort eingerechnet).
const GROQ_MAX_CHARS = 16000;

async function callOpenAI(args, cfg = null) {
  const s = state.settings;
  cfg ||= { baseUrl: s.baseUrl, key: s.oaKey, model: s.oaModel };
  if (!cfg.maxChars && /groq\.com/.test(cfg.baseUrl)) cfg = { ...cfg, maxChars: GROQ_MAX_CHARS };
  try {
    return await callOpenAIOnce(args, cfg);
  } catch (e) {
    // Zu groß? Einmal deutlich gekürzt nochmal versuchen.
    if (e.status === 413 || (e.status === 429 && e.tooBig)) return callOpenAIOnce(args, { ...cfg, maxChars: Math.min(cfg.maxChars || 40000, 10000) });
    throw e;
  }
}

async function callOpenAIOnce({ system, parts, history, json, temperature }, cfg) {
  if (cfg.maxChars) parts = shrinkParts(parts, system, cfg.maxChars);
  const content = parts.map((p) => {
    if (!p.file) return { type: 'text', text: p.text };
    if (p.file.mime.startsWith('image/')) return { type: 'image_url', image_url: { url: `data:${p.file.mime};base64,${p.file.data}` } };
    if (p.file.mime.startsWith('text/')) return { type: 'text', text: b64ToText(p.file.data) };
    const err = new AIError('PDFs kann nur Gemini lesen. Fotografiere die Seiten oder versuch es später nochmal.');
    err.pdf = true;
    throw err;
  });
  const onlyText = content.every((c) => c.type === 'text');
  const messages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    ...history.map((m) => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text })),
    { role: 'user', content: onlyText ? content.map((c) => c.text).join('\n\n') : content },
  ];
  const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const send = async (withJson) => {
    try {
      return await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(150000),
        headers: { 'Content-Type': 'application/json', ...(cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}) },
        body: JSON.stringify({ model: cfg.model, messages, temperature, ...(withJson ? { response_format: { type: 'json_object' } } : {}) }),
      });
    } catch {
      const err = new AIError('Keine Verbindung zur KI. Bist du online?');
      err.retryable = true;
      throw err;
    }
  };
  let res = await send(json);
  if (!res.ok && json && res.status === 400) res = await send(false); // manche Modelle können keinen JSON-Modus
  if (!res.ok) {
    const txt = await res.text();
    const err = new AIError(friendly(res.status, txt));
    err.retryable = res.status >= 500;
    err.status = res.status;
    err.tooBig = /too large|tokens per minute|TPM|context.length/i.test(txt);
    throw err;
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// ---------- Ersatz-Anbieter, wenn alle Gemini-Modelle überlastet sind ----------
export const FALLBACK_PRESETS = {
  groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys' },
  mistral: { label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai/api-keys' },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys' },
};

export function fallbackReady() {
  const f = state.settings.fb;
  return !!(f?.on && f.baseUrl && f.key && f.model);
}

export async function listOpenAIModels(baseUrl, key) {
  const res = await fetch(baseUrl.replace(/\/+$/, '') + '/models', { headers: key ? { Authorization: `Bearer ${key}` } : {} });
  if (!res.ok) throw new AIError(res.status === 401 || res.status === 403 ? 'Der Schlüssel wurde abgelehnt.' : `Fehler ${res.status}`);
  const data = await res.json();
  return (data.data || []).map((m) => m.id).filter((id) => !/(whisper|tts|orpheus|playai|embed|guard|moderation|audio|speech|transcri|image-gen|dall|compound)/i.test(id)).sort();
}

// Bevorzugt Modelle, die Bilder verstehen (für Fotos von Arbeitsblättern)
export function pickFallbackModel(ids) {
  const score = (id) => (/gpt-oss-120b/i.test(id) ? 45 : 0) + (/(allam|-7b|-8b|instant)/i.test(id) ? -40 : 0) + (/(scout|maverick|llama-4)/i.test(id) ? 50 : 0) + (/(pixtral|vision|vl\b|-vl-)/i.test(id) ? 40 : 0) + (/(mistral-medium|mistral-small|mistral-large)/i.test(id) ? 30 : 0) + (/:free$/i.test(id) ? 10 : 0) + (/(70b|large|medium)/i.test(id) ? 5 : 0);
  return [...ids].sort((a, b) => score(b) - score(a))[0] || '';
}

async function tryFallback(args) {
  const f = state.settings.fb;
  report(`Google ist überlastet – frage ${FALLBACK_PRESETS[f.preset]?.label || 'den Ersatz-Anbieter'} …`);
  const text = await callOpenAI(args, { baseUrl: f.baseUrl, key: f.key, model: f.model });
  report('');
  return args.json ? parseJSON(text) : text;
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
