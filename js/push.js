// Push-Mitteilungen (Firebase Cloud Messaging). Funktioniert auf iPhone/iPad nur, wenn Jelly über
// „Zum Home-Bildschirm“ installiert ist (ab iOS/iPadOS 16.4).
// Die App legt pro Gerät ein Token ab (users/{uid}/pushtokens) und hält eine kleine Übersicht aktuell
// (users/{uid}/pushinfo/profile): Uhrzeit, gewählte Arten, letzter Lerntag, Serie, Klausuren, To-dos.
// Verschickt wird vom Server (server/push.mjs) – auch wenn die App geschlossen ist.

import { state, save } from './store.js';
import { firebaseApp, currentUser } from './auth.js';
import { pushVapidKey } from './firebase-config.js';
import { streak, stats } from './rewards.js';

const V = '10.12.2';
export const PUSH_TYPES = [
  { id: 'done', name: 'Jelly ist fertig', sub: 'Wenn Lernplan, Blatt oder Lernzettel im Hintergrund fertig sind' },
  { id: 'daily', name: 'Tägliche Lern-Erinnerung', sub: 'Zu deiner Uhrzeit – nur wenn du heute noch nicht gelernt hast' },
  { id: 'streak', name: 'Lernserie in Gefahr', sub: 'Abends, wenn deine Serie sonst um Mitternacht endet' },
  { id: 'exam', name: 'Klausur morgen', sub: 'Am Vortag einer Klausur' },
  { id: 'todo', name: 'To-dos fällig', sub: 'Am Tag, an dem eine Aufgabe fällig ist' },
];

export const pushSettings = () => {
  const p = (state.settings.push ||= {});
  p.types ||= Object.fromEntries(PUSH_TYPES.map((t) => [t.id, true]));
  p.time ||= '17:00';
  return p;
};

const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const isApple = () => /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document;

/** Kann dieses Gerät Mitteilungen bekommen? { ok, reason } */
export function pushSupport() {
  if (!pushVapidKey) return { ok: false, reason: 'setup', text: 'Mitteilungen sind auf dem Server noch nicht eingerichtet.' };
  if (!currentUser()) return { ok: false, reason: 'account', text: 'Dafür brauchst du ein Konto (Mehr → Konto & Sync).' };
  if (isApple() && !standalone()) return { ok: false, reason: 'install', text: 'Öffne Jelly über das Symbol auf dem Home-Bildschirm. In Safari: Teilen → „Zum Home-Bildschirm“, dann von dort starten.' };
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return { ok: false, reason: 'browser', text: 'Dieser Browser kann keine Mitteilungen empfangen (auf dem iPad: iPadOS 16.4 oder neuer).' };
  if (Notification.permission === 'denied') return { ok: false, reason: 'denied', text: 'Mitteilungen sind für Jelly blockiert. Erlauben unter iPad-Einstellungen → Mitteilungen → Jelly.' };
  return { ok: true };
}

let fsMod = null, db = null;
async function firestore() {
  if (!fsMod) { fsMod = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`); db = fsMod.getFirestore(firebaseApp()); }
  return { fs: fsMod, db };
}
const hash = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');

/** Fragt nach der Erlaubnis und meldet dieses Gerät an. Muss durch einen Tipp ausgelöst werden. */
export async function enablePush() {
  const sup = pushSupport();
  if (!sup.ok) throw new Error(sup.text);
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Ohne Erlaubnis kann Jelly keine Mitteilungen schicken.');
  const reg = await navigator.serviceWorker.ready;
  const msg = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-messaging.js`);
  const token = await msg.getToken(msg.getMessaging(firebaseApp()), { vapidKey: pushVapidKey, serviceWorkerRegistration: reg });
  if (!token) throw new Error('Das Gerät konnte nicht angemeldet werden. Bitte nochmal versuchen.');
  const { fs, db: d } = await firestore();
  const uid = currentUser().uid;
  const id = await hash(token);
  await fs.setDoc(fs.doc(d, 'users', uid, 'pushtokens', id), { token, at: Date.now(), device: /iPad/.test(navigator.userAgent) || isApple() ? 'iPad/iPhone' : navigator.platform || 'Gerät' });
  try { localStorage.setItem('jelly-push-token', id); } catch {}
  const p = pushSettings();
  p.enabled = true; save();
  lastSig = '';
  await publishPushProfile(true);
}

/** Mitteilungen aus (dieses Gerät abmelden, Übersicht deaktivieren). */
export async function disablePush() {
  const p = pushSettings();
  p.enabled = false; save();
  try {
    const { fs, db: d } = await firestore();
    const uid = currentUser()?.uid;
    let id = null; try { id = localStorage.getItem('jelly-push-token'); } catch {}
    if (uid && id) await fs.deleteDoc(fs.doc(d, 'users', uid, 'pushtokens', id));
  } catch {}
  lastSig = '';
  await publishPushProfile(true);
}

export const deviceRegistered = () => { try { return !!localStorage.getItem('jelly-push-token') && Notification.permission === 'granted'; } catch { return false; } };

// ---------------------------------------------------------------- Übersicht für den Server
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function profile() {
  const p = pushSettings();
  const days = Object.keys(stats().days || {}).sort();
  const today = iso(new Date());
  const subjectName = (id) => (state.subjects || []).find((s) => s.id === id)?.name || 'Klausur';
  const exams = (state.exams || []).filter((e) => e.date && e.date >= today).map((e) => ({ date: e.date, name: subjectName(e.subjectId) })).slice(0, 20);
  const todos = (state.todos || []).filter((t) => !t.done && t.due && t.due >= today).map((t) => ({ date: t.due, title: String(t.title || '').slice(0, 80) })).slice(0, 30);
  // Nächste offene Einheit der aktiven Klausur (für die Tages-Erinnerung)
  let next = '';
  const ex = (state.exams || []).find((e) => e.id === state.activeExamId);
  for (const sec of ex?.plan?.abschnitte || []) { const u = sec.einheiten?.find((x) => x.status !== 'done' && x.status !== 'skipped'); if (u) { next = String(u.titel || '').slice(0, 60); break; } }
  return {
    enabled: !!p.enabled, types: p.types, time: p.time,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin',
    lastLearnDay: days.at(-1) || '', streak: streak(), exams, todos, next, name: state.profile?.name || '',
  };
}

let lastSig = '', timer = null;
/** Schreibt die Übersicht, wenn sich etwas geändert hat. */
export async function publishPushProfile(force = false) {
  const uid = currentUser()?.uid;
  if (!uid || (!pushSettings().enabled && !force)) return;
  const data = profile();
  const sig = JSON.stringify(data);
  if (sig === lastSig) return;
  try {
    const { fs, db: d } = await firestore();
    await fs.setDoc(fs.doc(d, 'users', uid, 'pushinfo', 'profile'), { ...data, updatedAt: Date.now() }, { merge: true });
    lastSig = sig;
  } catch (e) { console.warn('Push-Übersicht nicht gespeichert', e); }
}
/** Regelmäßig und beim Schließen der App aktualisieren. */
export function startPushProfileSync() {
  if (timer) return;
  timer = setInterval(() => publishPushProfile(), 5 * 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') publishPushProfile(); });
  setTimeout(() => publishPushProfile(), 4000);
}
