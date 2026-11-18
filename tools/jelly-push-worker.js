// Jelly Push – Cloudflare Worker (kostenlos, ohne Kreditkarte)
// Läuft alle 15 Minuten (Cron-Trigger), liest die Mitteilungs-Infos aus Firebase und verschickt fällige
// Push-Mitteilungen über Firebase Cloud Messaging: Lern-Erinnerung, Lernserie, Klausur morgen, To-dos.
//
// Einrichtung in Cloudflare (Workers & Pages → jelly-push):
//  1. Diesen Code komplett einfügen („Code bearbeiten“) und bereitstellen.
//  2. Einstellungen → Variablen und Geheimnisse → Hinzufügen → Typ „Geheimnis“,
//     Name FIREBASE_SA, Wert = kompletter Inhalt der JSON-Datei aus Firebase → Dienstkonten.
//  3. Einstellungen → Trigger → Cron-Trigger hinzufügen: */15 * * * *
// Test: die Worker-Adresse im Browser öffnen – zeigt an, ob alles eingerichtet ist.

const SITE = 'https://dehnleopold-design.github.io/Lern-Ki/';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env).then((r) => console.log(`Jelly Push: ${r.sent} Mitteilungen an ${r.users} Konten`)));
  },
  async fetch(req, env) {
    try {
      const sa = serviceAccount(env);
      const token = await accessToken(sa);
      const profiles = await listProfiles(sa.project_id, token);
      return new Response(`Jelly Push ist eingerichtet ✅\nProjekt: ${sa.project_id}\nKonten mit Mitteilungen: ${profiles.filter((p) => p.data.enabled).length}\n`, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    } catch (e) {
      return new Response(`Noch nicht fertig eingerichtet: ${e.message}\n`, { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
  },
};

// ---------------------------------------------------------------- Google-Anmeldung mit dem Dienstkonto
function serviceAccount(env) {
  if (!env.FIREBASE_SA) throw new Error('Geheimnis FIREBASE_SA fehlt.');
  let sa;
  try { sa = JSON.parse(env.FIREBASE_SA); } catch { throw new Error('FIREBASE_SA ist kein gültiges JSON – bitte den ganzen Dateiinhalt einfügen.'); }
  if (!sa.client_email || !sa.private_key || !sa.project_id) throw new Error('FIREBASE_SA ist unvollständig.');
  return sa;
}
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlStr = (s) => b64url(new TextEncoder().encode(s));
export async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64urlStr(JSON.stringify({
    iss: sa.client_email, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging',
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claim}`));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${head}.${claim}.${b64url(sig)}`,
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`Google-Anmeldung fehlgeschlagen (${j.error_description || j.error || res.status}).`);
  return j.access_token;
}

// ---------------------------------------------------------------- Firestore (REST)
export function fromFs(v) {
  if (!v || typeof v !== 'object') return v;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFs);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fromFs(x)]));
  return null;
}
export function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toFs(x)])) } };
}
const fsBase = (project) => `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
async function fsFetch(url, token, init = {}) {
  const res = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`Firestore ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}
async function listProfiles(project, token) {
  const rows = await fsFetch(`${fsBase(project)}:runQuery`, token, { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'pushinfo', allDescendants: true }] } }) });
  return (rows || []).filter((r) => r.document && r.document.name.endsWith('/pushinfo/profile'))
    .map((r) => ({ name: r.document.name, uid: r.document.name.split('/users/')[1].split('/')[0], data: fromFs({ mapValue: { fields: r.document.fields || {} } }) }));
}
async function listTokens(project, token, uid) {
  const j = await fsFetch(`${fsBase(project)}/users/${uid}/pushtokens?pageSize=50`, token);
  return (j?.documents || []).map((d) => ({ name: d.name, token: fromFs(d.fields?.token) })).filter((t) => t.token);
}

// ---------------------------------------------------------------- Mitteilung senden (FCM HTTP v1)
async function send(project, token, uid, msg) {
  let sent = 0;
  for (const t of await listTokens(project, token, uid)) {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: {
        token: t.token,
        data: { title: msg.title, body: msg.body, url: SITE, tag: msg.tag },
        webpush: { headers: { Urgency: 'high', TTL: '43200' }, notification: { title: msg.title, body: msg.body, icon: `${SITE}assets/icon-192.png`, tag: msg.tag }, fcm_options: { link: SITE } },
      } }),
    });
    if (res.ok) { sent++; continue; }
    const txt = await res.text();
    // Gerät abgemeldet → Token entfernen
    if (res.status === 404 || /UNREGISTERED|registration-token-not-registered/.test(txt)) {
      await fetch(`https://firestore.googleapis.com/v1/${t.name}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
    } else console.log(`Push fehlgeschlagen ${res.status}: ${txt.slice(0, 160)}`);
  }
  return sent;
}

// ---------------------------------------------------------------- Was ist fällig? (wie server/push.mjs)
export function localTime(tz, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now).map((x) => [x.type, x.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const shift = (n) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  return { today, yesterday: shift(-1), tomorrow: shift(1), hm: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}` };
}
export function dueMessages(p, now = new Date()) {
  const t = localTime(p.tz, now);
  const sent = { ...(p.sent || {}) };
  const want = (k) => p.types?.[k] !== false && sent[k] !== t.today;
  if (t.hm < '07:00' || t.hm >= '21:30') return { t, msgs: [] };
  const learnedToday = p.lastLearnDay === t.today;
  const msgs = [];
  if (want('daily') && !learnedToday && t.hm >= (p.time || '17:00')) msgs.push(['daily', { title: 'Zeit für Jelly 🪼', body: p.next ? `Heute dran: ${p.next}` : 'Ein paar Minuten lernen? Jelly hat alles vorbereitet.', tag: 'daily' }]);
  if (want('streak') && !learnedToday && (p.streak || 0) >= 2 && p.lastLearnDay === t.yesterday && t.hm >= '19:00') msgs.push(['streak', { title: `Deine ${p.streak}-Tage-Serie 🔥`, body: 'Sie endet um Mitternacht – schon eine Einheit rettet sie.', tag: 'streak' }]);
  const ex = (p.exams || []).filter((e) => e.date === t.tomorrow);
  if (want('exam') && ex.length && t.hm >= '16:00') msgs.push(['exam', { title: `Morgen: ${ex.map((e) => e.name).join(' & ')}-Klausur 📚`, body: 'Noch ein kurzes Quiz zum Aufwärmen? Du schaffst das!', tag: 'exam' }]);
  const td = (p.todos || []).filter((x) => x.date === t.today);
  if (want('todo') && td.length && t.hm >= '14:00') msgs.push(['todo', { title: td.length === 1 ? 'Heute fällig 📝' : `${td.length} To-dos heute fällig 📝`, body: td.slice(0, 3).map((x) => x.title).join(' · '), tag: 'todo' }]);
  return { t, msgs: msgs.slice(0, 2) };
}

async function run(env) {
  const sa = serviceAccount(env);
  const token = await accessToken(sa);
  const profiles = await listProfiles(sa.project_id, token);
  let sentTotal = 0, users = 0;
  for (const pr of profiles) {
    if (!pr.data.enabled) continue;
    users++;
    const { t, msgs } = dueMessages(pr.data);
    if (!msgs.length) continue;
    const sent = { ...(pr.data.sent || {}) };
    for (const [k, m] of msgs) { sentTotal += await send(sa.project_id, token, pr.uid, m); sent[k] = t.today; }
    await fsFetch(`https://firestore.googleapis.com/v1/${pr.name}?updateMask.fieldPaths=sent`, token, { method: 'PATCH', body: JSON.stringify({ fields: { sent: toFs(sent) } }) });
  }
  return { sent: sentTotal, users };
}
