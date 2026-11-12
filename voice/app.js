// Jelly Voice: Unterricht aufnehmen oder Sprachmemo importieren → Gemini hört zu → Transkript, Notizen, Lernzettel.
// Gleiches Konto wie Jelly (Anmeldung, Zugangscode, KI-Schlüssel). Notizen liegen in users/{uid}/voice/{id}.
// Die Aufnahme selbst bleibt nur auf diesem Gerät; bei Google liegt sie nur zum Auswerten (wird danach gelöscht).

import { initAuth, signInGoogle, signInEmail, registerEmail, resetPassword, signOutUser, authErrorText, firebaseApp } from '../js/auth.js';
import { state, setState, setReadOnly, peekState } from '../js/store.js';
import { generate, aiReady, listGeminiModels, pickDefaultModel, onAIStatus } from '../js/ai.js';
import { checkAccess, redeemCode, normalizeCode } from '../js/license.js';
import { h, icon, toast, mdEl, mascot, confirmDialog } from '../js/ui.js';
import { SYSTEM, TRANSCRIBE, notesPrompt, chatSystem } from './prompts.js';

const V = '10.12.2';
const GEMINI = 'https://generativelanguage.googleapis.com';
const app = document.getElementById('app');
setReadOnly(true); // Jellys Stand nur lesen (KI-Einstellungen), nie überschreiben

let F = null, db = null, user = null, unsub = null;
let items = {}; // id → Ordner/Notiz aus Firestore
const ui = { folder: 'all', note: null, tab: 'notes', q: '', drawer: false };
const jobs = {}; // noteId → { stage, progress, msg }
const audioUrls = {};

// ---------------------------------------------------------------- lokale Aufnahmen (IndexedDB)
const audioDB = () => new Promise((res, rej) => {
  const r = indexedDB.open('jelly-voice', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('audio');
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
async function audioOp(mode, fn) {
  const d = await audioDB();
  return new Promise((res, rej) => { const t = d.transaction('audio', mode); const q = fn(t.objectStore('audio')); t.oncomplete = () => { d.close(); res(q?.result); }; t.onerror = () => rej(t.error); });
}
const putAudio = (id, blob) => audioOp('readwrite', (s) => s.put(blob, id));
const getAudio = (id) => audioOp('readonly', (s) => s.get(id)).catch(() => null);
const delAudio = (id) => audioOp('readwrite', (s) => s.delete(id)).catch(() => {});
const allAudioKeys = () => audioOp('readonly', (s) => s.getAllKeys()).catch(() => []);

// ---------------------------------------------------------------- Firestore
const col = () => F.collection(db, 'users', user.uid, 'voice');
const ref = (id) => F.doc(db, 'users', user.uid, 'voice', id);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const patch = (id, data) => F.setDoc(ref(id), data, { merge: true }).catch((e) => toast(`Speichern fehlgeschlagen: ${e.message}`, 'error'));
const folders = () => Object.values(items).filter((x) => x.type === 'folder').sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
const notes = () => Object.values(items).filter((x) => x.type === 'note').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

async function initDb() {
  F = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`);
  try { db = F.initializeFirestore(firebaseApp(), { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); }
  catch { db = F.getFirestore(firebaseApp()); }
}

// KI-Einstellungen aus Jelly übernehmen (nur lesen); fehlt der Schlüssel auf diesem Gerät, aus dem Konto holen
async function loadAI() {
  const st = (await peekState(user.uid)) || {};
  setState(st);
  if (!state.settings.apiKey) {
    try { const k = await F.getDoc(F.doc(db, 'users', user.uid, 'secret', 'keys')); if (k.exists()) state.settings.apiKey = k.data().apiKey || ''; } catch {}
  }
  if (state.settings.provider === 'openai' && !state.settings.apiKey) return;
  if (state.settings.apiKey) state.settings.provider = 'gemini';
  if (state.settings.apiKey && !state.settings.model) {
    try { state.settings.models = await listGeminiModels(state.settings.apiKey); state.settings.model = pickDefaultModel(state.settings.models); } catch {}
  }
}

// ---------------------------------------------------------------- Start & Anmeldung
function boot(text = 'Lade …') { app.replaceChildren(h('div', { class: 'boot' }, mascot(90), h('p', { class: 'muted' }, text))); }

async function onUser(u) {
  unsub?.(); unsub = null;
  if (!u) { user = null; viewLogin(); return; }
  if (user?.uid === u.uid) return;
  user = u;
  boot('Prüfe Zugang …');
  if (!db) await initDb();
  const access = await checkAccess(u.uid);
  if (access !== 'ok' && !(await accessGate(u, access))) return;
  await loadAI();
  unsub = F.onSnapshot(col(), (snap) => {
    items = Object.fromEntries(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
    if (!document.querySelector('.overlay') && !document.querySelector('.vx-rec')) render();
  }, (e) => { app.replaceChildren(h('div', { class: 'boot' }, mascot(80), h('p', {}, `Notizen konnten nicht geladen werden: ${e.message}`), h('button', { class: 'btn', onclick: () => location.reload() }, 'Nochmal'))); });
  render();
  firstHint();
}

function viewLogin() {
  const mode = ui.loginMode || 'login';
  const err = h('div', { class: 'login-err' });
  const email = h('input', { class: 'input', type: 'email', placeholder: 'E-Mail', autocomplete: 'email', autocapitalize: 'off' });
  const pw = h('input', { class: 'input', type: 'password', placeholder: 'Passwort', autocomplete: mode === 'login' ? 'current-password' : 'new-password' });
  const submit = h('button', { class: 'btn primary block', onclick: async () => {
    err.textContent = ''; submit.disabled = true;
    try { if (mode === 'login') await signInEmail(email.value.trim(), pw.value); else await registerEmail(email.value.trim(), pw.value, ''); }
    catch (e) { err.textContent = authErrorText(e); submit.disabled = false; }
  } }, mode === 'login' ? 'Anmelden' : 'Konto erstellen');
  app.replaceChildren(h('div', { class: 'screen login' }, h('main', { class: 'content narrow login-box' },
    h('div', { class: 'vx-logo big' }),
    h('h1', { class: 'display' }, 'Jelly Voice'),
    h('p', { class: 'muted' }, 'Unterricht aufnehmen – Jelly macht Notizen und Lernzettel daraus. Melde dich mit deinem Jelly-Konto an.'),
    h('button', { class: 'btn google block', onclick: async () => { try { await signInGoogle(); } catch (e) { err.textContent = authErrorText(e); } } }, 'Mit Google anmelden'),
    h('div', { class: 'or' }, h('span', {}, 'oder mit E-Mail')), email, pw, err, submit,
    h('button', { class: 'link-small', onclick: () => { ui.loginMode = mode === 'login' ? 'register' : 'login'; viewLogin(); } }, mode === 'login' ? 'Noch kein Konto? Registrieren' : 'Schon ein Konto? Anmelden'),
    mode === 'login' ? h('button', { class: 'link-small', onclick: async () => { if (!email.value.trim()) { err.textContent = 'Gib zuerst deine E-Mail ein.'; return; } try { await resetPassword(email.value.trim()); toast('E-Mail ist unterwegs.', 'ok'); } catch (e) { err.textContent = authErrorText(e); } } }, 'Passwort vergessen?') : null)));
}

function accessGate(u, access) {
  return new Promise((resolve) => {
    const err = h('div', { class: 'login-err' });
    const input = h('input', { class: 'input code-input', placeholder: 'XXXX-XXXX', maxlength: 9, autocapitalize: 'characters', oninput: (e) => { e.target.value = normalizeCode(e.target.value).slice(0, 9); } });
    const btn = h('button', { class: 'btn primary block', onclick: async () => {
      err.textContent = ''; btn.disabled = true;
      try { await redeemCode(u, input.value); resolve(true); } catch (e) { err.textContent = e.message; btn.disabled = false; }
    } }, 'Freischalten');
    app.replaceChildren(h('div', { class: 'screen login' }, h('main', { class: 'content narrow login-box' },
      mascot(100), h('h1', { class: 'display' }, access === 'revoked' ? 'Zugang gesperrt' : 'Zugangscode'),
      h('p', { class: 'muted' }, access === 'revoked' ? 'Dein Zugang wurde gesperrt.' : 'Jelly Voice gehört zu Jelly und ist nur mit Einladung nutzbar. Gib deinen Code ein.'),
      access === 'revoked' ? null : [input, err, btn],
      h('button', { class: 'link-small', onclick: () => signOutUser() }, 'Mit anderem Konto anmelden'))));
  });
}

function firstHint() {
  try { if (localStorage.getItem('voice-hint')) return; } catch {}
  sheet('Bevor du aufnimmst', [
    h('p', {}, 'Nimm Unterricht nur auf, wenn deine Lehrkraft einverstanden ist – und denk daran, dass auch Mitschüler:innen zu hören sind. Aufnahmen nur für dich selbst nutzen, nicht weitergeben.'),
    h('p', { class: 'muted small' }, 'Zum Auswerten geht die Aufnahme an Google (Gemini, mit deinem eigenen Schlüssel) und wird dort danach gelöscht. Notizen und Transkript liegen in deinem Konto, die Aufnahme selbst nur auf diesem Gerät.'),
    h('button', { class: 'btn primary block', onclick: (e) => { try { localStorage.setItem('voice-hint', '1'); } catch {} e.target.closest('.overlay').remove(); } }, 'Verstanden')]);
}

// ---------------------------------------------------------------- kleine Bausteine
function sheet(title, children) {
  const ov = h('div', { class: 'overlay', onclick: (e) => { if (e.target === ov) ov.remove(); } },
    h('div', { class: 'sheet' }, h('div', { class: 'sheet-head' }, h('div', { class: 'sheet-title' }, title), h('button', { class: 'iconbtn', 'aria-label': 'Schließen', onclick: () => ov.remove() }, icon('close'))), ...children));
  document.body.append(ov);
  return ov;
}
const fmtDur = (s) => { s = Math.round(s || 0); const m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : m ? `${m} min` : `${s} s`; };
const fmtDate = (ms) => new Date(ms).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
const folderName = (id) => items[id]?.name || '';
const busy = (n) => ['upload', 'transcribe', 'notes'].includes(n.status);

// ---------------------------------------------------------------- Ansicht
function render() {
  if (!user) return;
  const note = ui.note && items[ui.note];
  if (ui.note && !note) ui.note = null;
  // Angefangene Eingabe im Chat behalten, wenn neu gezeichnet wird
  const ta = document.querySelector('.vx textarea');
  const draft = ta?.value || '', focused = ta && document.activeElement === ta;
  const scroller = document.scrollingElement, y = scroller?.scrollTop || 0;
  app.replaceChildren(h('div', { class: `vx ${ui.drawer ? 'drawer-open' : ''} ${note ? 'has-note' : ''}` },
    sidebar(),
    h('div', { class: 'vx-scrim', onclick: () => { ui.drawer = false; render(); } }),
    note ? noteView(note) : listView()));
  const ta2 = document.querySelector('.vx textarea');
  if (ta2 && draft) ta2.value = draft;
  if (ta2 && focused) ta2.focus({ preventScroll: true });
  if (scroller && note) scroller.scrollTop = y;
}
let renderTimer = 0;
const softRender = () => { if (renderTimer) return; renderTimer = setTimeout(() => { renderTimer = 0; if (!document.querySelector('.overlay')) render(); }, 400); };

function sidebar() {
  const all = notes();
  const row = (id, ic, label, n) => h('button', { class: `vx-nav ${ui.folder === id && !ui.note ? 'on' : ''}`, onclick: () => { ui.folder = id; ui.note = null; ui.drawer = false; render(); } },
    icon(ic, 20), h('span', { class: 'grow' }, label), n ? h('span', { class: 'vx-count' }, n) : null);
  return h('aside', { class: 'vx-side' },
    h('div', { class: 'vx-brand' }, h('div', { class: 'vx-logo' }), h('div', {}, h('div', { class: 'vx-name' }, 'Jelly Voice'), h('div', { class: 'muted small' }, 'Unterricht → Lernzettel'))),
    row('all', 'notes', 'Alle Notizen', all.length),
    h('div', { class: 'vx-sec' }, 'Ordner'),
    folders().map((f) => row(f.id, 'folder', f.name, all.filter((n) => n.folderId === f.id).length)),
    h('button', { class: 'vx-nav add', onclick: newFolder }, icon('folderPlus', 20), h('span', { class: 'grow' }, 'Neuer Ordner')),
    h('div', { class: 'grow' }),
    h('button', { class: 'vx-nav', onclick: settingsSheet }, icon('gear', 20), h('span', { class: 'grow' }, 'Einstellungen')),
    h('a', { class: 'vx-nav', href: '../' }, icon('back', 20), h('span', { class: 'grow' }, 'Zu Jelly')));
}

function listView() {
  const f = ui.folder !== 'all' ? items[ui.folder] : null;
  if (ui.folder !== 'all' && !f) ui.folder = 'all';
  const q = ui.q.trim().toLowerCase();
  const list = notes().filter((n) => (!f || n.folderId === f.id) && (!q || `${n.title} ${n.summary || ''} ${n.transcript || ''}`.toLowerCase().includes(q)));
  const search = h('input', { class: 'input vx-search', type: 'search', placeholder: 'Suchen', value: ui.q, oninput: (e) => { ui.q = e.target.value; const pos = e.target.selectionStart; render(); const s = document.querySelector('.vx-search'); s?.focus(); s?.setSelectionRange(pos, pos); } });
  return h('main', { class: 'vx-main' },
    h('header', { class: 'vx-top' },
      h('button', { class: 'iconbtn vx-menu', 'aria-label': 'Ordner', onclick: () => { ui.drawer = true; render(); } }, icon('list')),
      h('h1', { class: 'grow' }, f ? f.name : 'Alle Notizen'),
      f ? h('button', { class: 'iconbtn', 'aria-label': 'Ordner bearbeiten', onclick: () => folderMenu(f) }, icon('more')) : null),
    h('div', { class: 'vx-searchwrap' }, icon('search', 18), search),
    list.length ? h('div', { class: 'vx-list' }, list.map(noteRow))
      : h('div', { class: 'vx-empty' }, mascot(90), h('p', { class: 'strong' }, q ? 'Nichts gefunden.' : 'Noch keine Aufnahmen'), q ? null : h('p', { class: 'muted' }, 'Nimm deinen Unterricht auf oder importiere eine Sprachmemo – Jelly macht daraus Notizen und einen Lernzettel.')),
    h('button', { class: 'vx-fab', onclick: newRecording }, icon('mic', 22), 'Neue Aufnahme'));
}

function noteRow(n) {
  const job = jobs[n.id];
  const sub = busy(n) ? (job ? stageText(job) : 'Unterbrochen – zum Fortsetzen öffnen') : n.status === 'error' ? 'Fehler – zum Wiederholen öffnen' : [fmtDate(n.createdAt), n.duration ? fmtDur(n.duration) : '', ui.folder === 'all' && n.folderId ? folderName(n.folderId) : ''].filter(Boolean).join(' · ');
  return h('button', { class: 'vx-row', onclick: () => { ui.note = n.id; ui.tab = 'notes'; render(); } },
    h('span', { class: 'vx-emoji' }, busy(n) && job ? h('span', { class: 'spinner' }) : (n.emoji || '🎙️')),
    h('span', { class: 'grow' }, h('span', { class: 'vx-title' }, n.title || 'Neue Aufnahme'), h('span', { class: `vx-sub ${n.status === 'error' ? 'bad' : ''}` }, sub)),
    icon('chev', 18));
}

function stageText(j) {
  return j.stage === 'upload' ? `Lade hoch … ${Math.round((j.progress || 0) * 100)} %` : j.stage === 'transcribe' ? 'Jelly hört zu und schreibt mit …' : j.stage === 'notes' ? 'Jelly schreibt den Lernzettel …' : 'Bereite vor …';
}

// ---------------------------------------------------------------- Notiz
function noteView(n) {
  const tabs = [['notes', 'Notizen'], ['transcript', 'Transkript'], ['chat', 'Fragen an Jelly']];
  const folderSel = h('select', { class: 'input vx-folder', onchange: (e) => patch(n.id, { folderId: e.target.value || null }) },
    h('option', { value: '' }, 'Kein Ordner'), folders().map((f) => h('option', { value: f.id, selected: n.folderId === f.id ? '' : null }, f.name)));
  const body = h('div', { class: 'vx-body' });
  const done = n.status === 'done';
  if (!done) body.append(progressCard(n));
  else if (ui.tab === 'notes') body.append(notesTab(n));
  else if (ui.tab === 'transcript') body.append(n.transcript ? h('div', { class: 'vx-transcript' }, n.transcript.split(/\n+/).filter(Boolean).map((p) => h('p', {}, p))) : h('p', { class: 'muted' }, 'Kein Transkript.'));
  else body.append(chatTab(n));
  const player = h('div', { class: 'vx-player' });
  const showAudio = (src) => { if (src && player.isConnected) player.replaceChildren(h('audio', { controls: '', preload: 'metadata', src })); };
  if (audioUrls[n.id]) showAudio(audioUrls[n.id]);
  else getAudio(n.id).then((b) => { if (b) { audioUrls[n.id] = URL.createObjectURL(b); showAudio(audioUrls[n.id]); } });
  return h('main', { class: 'vx-main vx-note' },
    h('header', { class: 'vx-top' },
      h('button', { class: 'iconbtn', 'aria-label': 'Zurück', onclick: () => { ui.note = null; render(); } }, icon('back')),
      h('div', { class: 'grow' }),
      h('button', { class: 'iconbtn', 'aria-label': 'Mehr', onclick: () => noteMenu(n) }, icon('more'))),
    h('div', { class: 'vx-head' },
      h('span', { class: 'vx-emoji big' }, n.emoji || '🎙️'),
      h('div', { class: 'grow' },
        h('h1', { class: 'vx-h1' }, n.title || 'Neue Aufnahme'),
        h('div', { class: 'muted small' }, [fmtDate(n.createdAt), n.duration ? fmtDur(n.duration) : '', n.fach || ''].filter(Boolean).join(' · ')))),
    h('div', { class: 'vx-meta' }, folderSel, player),
    done ? h('div', { class: 'seg vx-tabs' }, tabs.map(([k, l]) => h('button', { class: `seg-btn ${ui.tab === k ? 'active' : ''}`, onclick: () => { ui.tab = k; render(); } }, l))) : null,
    body);
}

function progressCard(n) {
  const job = jobs[n.id];
  const steps = [['upload', 'Aufnahme hochladen'], ['transcribe', 'Zuhören & mitschreiben'], ['notes', 'Notizen & Lernzettel']];
  const idx = steps.findIndex(([k]) => k === (job?.stage || n.status));
  const status = h('div', { class: 'wait-status' }, job?.msg || '');
  if (job) job.statusEl = status;
  const card = h('div', { class: 'wait-card' },
    h('div', { class: 'row gap' }, mascot(52, 'think'), h('div', { class: 'wait-title' }, n.status === 'error' ? 'Das hat nicht geklappt' : job ? stageText(job) : 'Auswertung unterbrochen')),
    h('ol', { class: 'steps' }, steps.map(([k, l], i) => h('li', { class: `step st-${n.status === 'error' && i === idx ? 'fail' : i < idx ? 'done' : i === idx && job ? 'run' : 'wait'}` },
      h('span', { class: 'step-dot' }, i < idx ? icon('check', 14) : i === idx && job ? h('span', { class: 'spinner' }) : null), h('span', {}, k === 'upload' && job?.stage === 'upload' ? `${l} (${Math.round((job.progress || 0) * 100)} %)` : l)))),
    status);
  if (n.status === 'error') card.append(h('div', { class: 'card warn' }, h('p', {}, n.error || 'Unbekannter Fehler.')));
  if (job) card.append(h('p', { class: 'muted small' }, 'Lass Jelly Voice dabei geöffnet – iOS pausiert Apps im Hintergrund. Eine Stunde dauert meist 1–3 Minuten.'));
  else card.append(h('button', { class: 'btn primary block', onclick: () => process(n.id) }, icon('refresh', 18), n.status === 'error' ? 'Nochmal versuchen' : 'Weiter auswerten'));
  return card;
}

function notesTab(n) {
  const wrap = h('div', { class: 'vx-notes' });
  if (n.summary) wrap.append(h('div', { class: 'vx-summary' }, n.summary));
  const hw = n.homework || [], dates = n.dates || [];
  if (hw.length || dates.length) {
    wrap.append(h('div', { class: 'vx-todo' },
      hw.length ? [h('div', { class: 'label' }, '📌 Hausaufgaben'), h('ul', {}, hw.map((x) => h('li', {}, x.aufgabe, x.bis ? h('span', { class: 'muted' }, ` – bis ${x.bis}`) : null)))] : null,
      dates.length ? [h('div', { class: 'label' }, '📅 Termine'), h('ul', {}, dates.map((x) => h('li', {}, x.was, x.wann ? h('span', { class: 'muted' }, ` – ${x.wann}`) : null)))] : null));
  }
  wrap.append(h('div', { class: 'lernzettel vx-paper' }, mdEl(n.notes || '')));
  if (n.terms?.length) wrap.append(h('details', { class: 'details', open: '' }, h('summary', {}, `Begriffe (${n.terms.length})`), h('dl', { class: 'vx-terms' }, n.terms.flatMap((t) => [h('dt', {}, t.begriff), h('dd', {}, t.erklaerung)]))));
  if (n.questions?.length) wrap.append(h('details', { class: 'details' }, h('summary', {}, 'Teste dich selbst'), h('ol', {}, n.questions.map((q) => h('li', {}, q))),
    h('button', { class: 'btn ghost block', onclick: () => { ui.tab = 'chat'; render(); } }, icon('chat', 18), 'Antworten mit Jelly besprechen')));
  return wrap;
}

function chatTab(n) {
  const msgs = n.chat || [];
  const list = h('div', { class: 'chat-list' },
    h('div', { class: 'msg model' }, mdEl('Frag mich alles zu dieser Stunde – ich antworte mit dem, was im Unterricht gesagt wurde.')),
    msgs.map((m) => h('div', { class: `msg ${m.role}` }, m.role === 'model' ? mdEl(m.text) : m.text)));
  const input = h('textarea', { class: 'input', rows: 2, placeholder: 'Frage zur Stunde …' });
  const quick = h('div', { class: 'chips' }, ['Erklär mir das Wichtigste nochmal', 'Was sollte ich auswendig können?', 'Stell mir 3 Fragen'].map((q) => h('button', { class: 'chip', onclick: () => { input.value = q; send.click(); } }, q)));
  const send = h('button', { class: 'iconbtn send', 'aria-label': 'Senden', onclick: async () => {
    const text = input.value.trim();
    if (!text || !aiReady()) { if (!aiReady()) toast('Richte zuerst die KI in Jelly ein.', 'error'); return; }
    input.value = ''; send.disabled = true;
    list.append(h('div', { class: 'msg user' }, text));
    const think = h('div', { class: 'msg model thinking' }, h('div', { class: 'think-row' }, h('span', { class: 'think-dot' }), h('span', { class: 'think-text' }, 'Denkt nach …')));
    list.append(think); think.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    try {
      const reply = await generate({ system: chatSystem(n), parts: [{ text }], history: msgs.slice(-12), temperature: 0.4 });
      await patch(n.id, { chat: [...msgs, { role: 'user', text }, { role: 'model', text: reply }].slice(-40) });
    } catch (e) { think.remove(); input.value = text; toast(e.message, 'error'); }
    send.disabled = false;
  } }, icon('send'));
  return h('div', { class: 'chat compact' }, list, quick, h('div', { class: 'chat-input' }, input, send));
}

function noteMenu(n) {
  const o = sheet(n.title || 'Aufnahme', [
    h('button', { class: 'btn block', onclick: () => { o.remove(); const t = prompt('Titel:', n.title || ''); if (t?.trim()) patch(n.id, { title: t.trim(), titleSet: true }); } }, icon('edit', 18), 'Umbenennen'),
    n.status === 'done' ? h('button', { class: 'btn block', onclick: () => { o.remove(); copyNotes(n); } }, icon('file', 18), 'Lernzettel kopieren') : null,
    n.status === 'done' ? h('button', { class: 'btn block', onclick: async () => { o.remove(); if (await confirmDialog('Notizen neu erstellen? (Das Transkript bleibt.)', 'Neu erstellen', 'Abbrechen', 'primary')) { await patch(n.id, { status: 'notes' }); process(n.id); } } }, icon('refresh', 18), 'Lernzettel neu erstellen') : null,
    h('button', { class: 'btn block danger', onclick: async () => {
      o.remove();
      if (!(await confirmDialog('Diese Aufnahme mit Notizen löschen?', 'Löschen'))) return;
      ui.note = null; await F.deleteDoc(ref(n.id)).catch(() => {}); delAudio(n.id); render();
    } }, icon('trash', 18), 'Löschen')]);
}

async function copyNotes(n) {
  const text = [`# ${n.title}`, n.summary || '', n.notes || ''].join('\n\n');
  try { await navigator.clipboard.writeText(text); toast('Lernzettel kopiert.', 'ok'); } catch { toast('Kopieren nicht erlaubt.', 'error'); }
}

// ---------------------------------------------------------------- Ordner
async function newFolder() {
  const name = (prompt('Name des Ordners (z. B. Biologie):') || '').trim();
  if (!name) return;
  const id = newId();
  await F.setDoc(ref(id), { type: 'folder', name, createdAt: Date.now() });
  ui.folder = id; ui.note = null; ui.drawer = false; render();
}

function folderMenu(f) {
  const o = sheet(f.name, [
    h('button', { class: 'btn block', onclick: () => { o.remove(); const t = prompt('Neuer Name:', f.name); if (t?.trim()) patch(f.id, { name: t.trim() }); } }, icon('edit', 18), 'Umbenennen'),
    h('button', { class: 'btn block danger', onclick: async () => {
      o.remove();
      if (!(await confirmDialog(`Ordner „${f.name}“ löschen? Die Aufnahmen darin bleiben (ohne Ordner).`, 'Löschen'))) return;
      for (const n of notes().filter((x) => x.folderId === f.id)) await patch(n.id, { folderId: null });
      await F.deleteDoc(ref(f.id)); ui.folder = 'all'; render();
    } }, icon('trash', 18), 'Ordner löschen')]);
}

// ---------------------------------------------------------------- Neue Aufnahme
function newRecording() {
  const fid = ui.folder !== 'all' ? ui.folder : '';
  const sel = h('select', { class: 'input' }, h('option', { value: '' }, 'Kein Ordner'), folders().map((f) => h('option', { value: f.id, selected: f.id === fid ? '' : null }, f.name)));
  const file = h('input', { type: 'file', accept: 'audio/*,.m4a,.mp3,.wav,.aac,.caf,.ogg,.flac,.mp4', style: 'display:none', onchange: async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    o.remove();
    await addAudio(f, f.name.replace(/\.[^.]+$/, ''), sel.value);
  } });
  const o = sheet('Neue Aufnahme', [
    h('div', { class: 'label' }, 'Ordner'), sel,
    h('button', { class: 'btn primary block', onclick: () => file.click() }, icon('upload', 18), 'Sprachmemo / Audiodatei importieren'),
    h('p', { class: 'muted small' }, 'So geht’s mit Sprachmemos: Aufnahme antippen → ⋯ → Teilen → „In Dateien sichern“. Dann hier importieren. Sprachmemos nimmt auch im Hintergrund und bei gesperrtem Bildschirm weiter auf.'),
    h('button', { class: 'btn block', onclick: () => { o.remove(); recorder(sel.value); } }, icon('mic', 18), 'Direkt hier aufnehmen'),
    h('p', { class: 'muted small' }, 'Direkt aufnehmen klappt nur, solange Jelly Voice offen und der Bildschirm an bleibt.'),
    file]);
}

function audioDuration(blob) {
  return new Promise((res) => {
    const a = new Audio();
    const done = (v) => { URL.revokeObjectURL(a.src); res(v); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => done(0);
    setTimeout(() => done(0), 8000);
    a.src = URL.createObjectURL(blob);
  });
}

async function addAudio(blob, name, folderId) {
  const id = newId();
  const duration = await audioDuration(blob);
  await putAudio(id, blob);
  await F.setDoc(ref(id), { type: 'note', title: 'Neue Aufnahme', origName: name || '', emoji: '🎙️', folderId: folderId || null, createdAt: Date.now(), duration, size: blob.size, mime: mimeOf(blob, name), status: 'upload' });
  ui.note = id; ui.drawer = false; render();
  process(id);
}

function mimeOf(blob, name = '') {
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  const t = blob.type || '';
  if (/wav/.test(t) || ext === 'wav') return 'audio/wav';
  if (/mpeg|mp3/.test(t) || ext === 'mp3') return 'audio/mp3';
  if (/ogg/.test(t) || ext === 'ogg') return 'audio/ogg';
  if (/flac/.test(t) || ext === 'flac') return 'audio/flac';
  if (/aiff/.test(t) || ext === 'aiff') return 'audio/aiff';
  if (/aac/.test(t) || ext === 'aac') return 'audio/aac';
  return 'audio/mp4'; // m4a/mp4/caf aus Sprachmemos & Safari-Aufnahmen
}

// Direkt aufnehmen (nur im Vordergrund)
async function recorder(folderId) {
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true } }); }
  catch { toast('Kein Zugriff aufs Mikrofon. Erlaube es in den Einstellungen.', 'error'); return; }
  const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
  const rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 64000 } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  let lock = null;
  try { lock = await navigator.wakeLock?.request('screen'); } catch {}
  const t0 = Date.now(); let paused = 0, pauseAt = 0;
  const time = h('div', { class: 'vx-rec-time' }, '0:00');
  const bars = h('div', { class: 'vx-bars' }, Array.from({ length: 24 }, () => h('i')));
  const ac = new AudioContext(); const an = ac.createAnalyser(); an.fftSize = 64; ac.createMediaStreamSource(stream).connect(an);
  const buf = new Uint8Array(an.frequencyBinCount);
  let raf = 0;
  const tick = () => {
    const s = Math.floor((Date.now() - t0 - paused - (pauseAt ? Date.now() - pauseAt : 0)) / 1000);
    time.textContent = `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}` : Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    an.getByteFrequencyData(buf);
    [...bars.children].forEach((b, i) => { b.style.height = `${8 + (buf[i % buf.length] / 255) * 56}px`; });
    raf = requestAnimationFrame(tick);
  };
  const stopAll = () => { cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); ac.close().catch(() => {}); lock?.release?.().catch?.(() => {}); ov.remove(); };
  const pauseBtn = h('button', { class: 'btn', onclick: () => {
    if (rec.state === 'recording') { rec.pause(); pauseAt = Date.now(); pauseBtn.replaceChildren(icon('mic', 18), 'Weiter'); }
    else { rec.resume(); paused += Date.now() - pauseAt; pauseAt = 0; pauseBtn.replaceChildren(icon('pause', 18), 'Pause'); }
  } }, icon('pause', 18), 'Pause');
  const ov = h('div', { class: 'overlay vx-rec' }, h('div', { class: 'vx-rec-box' },
    h('div', { class: 'vx-rec-dot' }), time, bars,
    h('p', { class: 'muted small' }, 'Bildschirm anlassen und Jelly Voice nicht verlassen – sonst stoppt iOS die Aufnahme.'),
    h('div', { class: 'row gap center' }, pauseBtn,
      h('button', { class: 'btn primary', onclick: () => { rec.onstop = async () => { stopAll(); const blob = new Blob(chunks, { type: rec.mimeType || 'audio/mp4' }); if (blob.size < 2000) { toast('Aufnahme ist leer.', 'error'); render(); return; } await addAudio(blob, '', folderId); }; rec.stop(); } }, icon('stop', 18), 'Stopp & auswerten')),
    h('button', { class: 'link-small', onclick: async () => { if (await confirmDialog('Aufnahme verwerfen?', 'Verwerfen')) { rec.onstop = null; rec.stop(); stopAll(); render(); } } }, 'Verwerfen')));
  document.body.append(ov);
  rec.start(10000);
  tick();
}

// ---------------------------------------------------------------- Auswertung
function setJob(id, stage, progress) {
  jobs[id] = { ...(jobs[id] || {}), stage, progress };
  if (!document.querySelector('.overlay')) render();
}

async function process(id) {
  if (jobs[id]) return;
  const n = items[id];
  if (!n) return;
  if (!aiReady()) { await patch(id, { status: 'error', error: 'Die KI ist nicht eingerichtet. Richte in Jelly unter Mehr → KI-Verbindung einen Gemini-Schlüssel ein.' }); return; }
  jobs[id] = { stage: 'prep' };
  onAIStatus((msg) => { if (jobs[id]) { jobs[id].msg = msg; if (jobs[id].statusEl) jobs[id].statusEl.textContent = msg; } });
  try {
    let { transcript, fileUri, fileName, fileAt, mime } = items[id];
    if (!transcript) {
      if (!fileUri || Date.now() - (fileAt || 0) > 46 * 3600000) {
        const blob = await getAudio(id);
        if (!blob) throw new Error('Die Aufnahme liegt nicht auf diesem Gerät. Öffne die Notiz auf dem Gerät, auf dem du sie hinzugefügt hast.');
        setJob(id, 'upload', 0);
        mime = mime || mimeOf(blob);
        ({ uri: fileUri, name: fileName } = await uploadToGemini(blob, mime, (p) => { jobs[id].progress = p; softRender(); }));
        fileAt = Date.now();
        await patch(id, { fileUri, fileName, fileAt, mime, status: 'transcribe' });
      }
      setJob(id, 'transcribe');
      transcript = String(await generate({ system: SYSTEM, parts: [{ fileUri, mime }, { text: TRANSCRIBE }], temperature: 0.1, timeout: 600000 })).trim();
      if (/^KEIN_UNTERRICHT/.test(transcript)) throw new Error('Auf der Aufnahme ist kaum Unterricht zu hören. Ist es die richtige Datei?');
      await patch(id, { transcript, status: 'notes' });
    }
    setJob(id, 'notes');
    const r = await generate({ system: SYSTEM, parts: [{ text: notesPrompt(transcript, folderName(items[id]?.folderId)) }], json: true, temperature: 0.3, timeout: 300000 });
    await patch(id, {
      title: (items[id]?.titleSet ? items[id].title : r.titel) || 'Unterricht',
      emoji: r.emoji || '📝', fach: r.fach || '', summary: r.zusammenfassung || '', notes: r.lernzettel || '',
      terms: (r.begriffe || []).filter((x) => x?.begriff), homework: (r.hausaufgaben || []).filter((x) => x?.aufgabe), dates: (r.termine || []).filter((x) => x?.was),
      questions: (r.fragen || []).filter(Boolean), status: 'done', error: null, doneAt: Date.now(),
    });
    if (fileName) deleteGeminiFile(fileName);
    delete jobs[id];
    toast(`Fertig: ${r.titel || 'Notizen'}`, 'ok');
  } catch (e) {
    delete jobs[id];
    await patch(id, { status: 'error', error: e.message || String(e) });
  }
  onAIStatus(null);
  render();
}

// Gemini File API: großes Audio hochladen (bis 2 GB), dann warten bis es verarbeitet ist
async function uploadToGemini(blob, mime, onProgress) {
  const key = encodeURIComponent(state.settings.apiKey);
  const start = await fetch(`${GEMINI}/upload/v1beta/files?key=${key}`, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(blob.size), 'X-Goog-Upload-Header-Content-Type': mime, 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: { display_name: `jelly-voice-${Date.now()}` } }),
  });
  if (!start.ok) throw new Error(start.status === 400 || start.status === 403 ? 'Google hat den Schlüssel für das Hochladen abgelehnt.' : `Hochladen fehlgeschlagen (${start.status}).`);
  const url = start.headers.get('x-goog-upload-url');
  let file;
  if (url) {
    file = await new Promise((res, rej) => {
      const x = new XMLHttpRequest();
      x.open('POST', url);
      x.setRequestHeader('X-Goog-Upload-Offset', '0');
      x.setRequestHeader('X-Goog-Upload-Command', 'upload, finalize');
      x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      x.onload = () => { try { if (x.status >= 300) throw new Error(); res(JSON.parse(x.responseText).file); } catch { rej(new Error(`Hochladen fehlgeschlagen (${x.status}).`)); } };
      x.onerror = () => rej(new Error('Keine Verbindung beim Hochladen.'));
      x.send(blob);
    });
  } else {
    // Falls der Browser die Upload-Adresse nicht lesen darf: in einem Stück (multipart)
    const boundary = `jv${Date.now()}`;
    const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ file: { display_name: 'jelly-voice' } })}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`, blob, `\r\n--${boundary}--`]);
    const r = await fetch(`${GEMINI}/upload/v1beta/files?key=${key}`, { method: 'POST', headers: { 'X-Goog-Upload-Protocol': 'multipart', 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
    if (!r.ok) throw new Error(`Hochladen fehlgeschlagen (${r.status}).`);
    file = (await r.json()).file;
    onProgress(1);
  }
  for (let i = 0; i < 90 && file.state === 'PROCESSING'; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    file = await (await fetch(`${GEMINI}/v1beta/${file.name}?key=${key}`)).json();
  }
  if (file.state === 'FAILED') throw new Error('Google konnte die Audiodatei nicht verarbeiten. Ist es eine normale Aufnahme (m4a, mp3, wav)?');
  return { uri: file.uri, name: file.name };
}

function deleteGeminiFile(name) {
  fetch(`${GEMINI}/v1beta/${name}?key=${encodeURIComponent(state.settings.apiKey)}`, { method: 'DELETE' }).catch(() => {});
}

// ---------------------------------------------------------------- Einstellungen
async function settingsSheet() {
  const keys = await allAudioKeys();
  let size = 0;
  for (const k of keys) size += (await getAudio(k))?.size || 0;
  const o = sheet('Einstellungen', [
    h('div', { class: 'label' }, 'Konto'), h('p', {}, user.email || ''),
    h('div', { class: 'label' }, 'KI'), h('p', { class: aiReady() ? '' : 'bad' }, aiReady() ? `Gemini verbunden (aus Jelly) · ${state.settings.model}` : 'Nicht eingerichtet – richte in Jelly unter Mehr → KI-Verbindung einen Gemini-Schlüssel ein.'),
    h('div', { class: 'label' }, 'Aufnahmen auf diesem Gerät'), h('p', {}, `${keys.length} Aufnahmen · ${(size / 1048576).toFixed(1)} MB`),
    keys.length ? h('button', { class: 'btn block', onclick: async () => { if (await confirmDialog('Alle Aufnahmen auf diesem Gerät löschen? Notizen und Transkripte bleiben.', 'Löschen')) { for (const k of keys) await delAudio(k); o.remove(); toast('Gelöscht.', 'ok'); } } }, 'Aufnahmen löschen (Notizen bleiben)') : null,
    h('div', { class: 'label' }, 'Datenschutz'),
    h('p', { class: 'muted small' }, 'Zum Auswerten geht die Aufnahme mit deinem eigenen Schlüssel an Google Gemini und wird dort danach gelöscht (spätestens nach 48 Stunden automatisch). Transkript und Notizen liegen in deinem Konto (Firebase, Frankfurt). Die Aufnahme selbst bleibt nur auf diesem Gerät. Der Betreiber sieht in Control keine Jelly-Voice-Notizen.'),
    h('button', { class: 'btn block danger', onclick: () => signOutUser() }, 'Abmelden')]);
}

// ---------------------------------------------------------------- los
boot();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('../sw.js').catch(() => {});
initAuth(onUser).catch(() => app.replaceChildren(h('div', { class: 'boot' }, mascot(90), h('p', {}, 'Für die Anmeldung brauchst du Internet.'), h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Nochmal'))));
window.__voice = { items: () => items, jobs, state: () => state };
