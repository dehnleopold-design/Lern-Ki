// Push-Mitteilungen verschicken (läuft in den Firebase Cloud Functions, geladen wie worker.mjs).
// Tokens: users/{uid}/pushtokens/{id} = { token }
// Übersicht: users/{uid}/pushinfo/profile = { enabled, types, time, tz, lastLearnDay, streak, exams, todos, next, sent }

const SITE = 'https://dehnleopold-design.github.io/Lern-Ki/';
const DONE_TEXT = {
  exam: 'Dein Lernplan mit Lernzetteln, Quiz und Aufgaben ist bereit.',
  solve: 'Dein Arbeitsblatt ist gelöst.',
  subject: 'Das Lehrerprofil ist fertig.',
  vocab: 'Deine Vokabeln sind ausgelesen.',
  vtest: 'Das Profil deiner Vokabeltests ist fertig.',
};

/** Schickt eine Mitteilung an alle Geräte eines Kontos. Abgemeldete Geräte werden entfernt. */
export async function sendTo(db, messaging, uid, { title, body, url = SITE, tag = 'jelly' }, log = console.log) {
  const toks = await db.collection('users').doc(uid).collection('pushtokens').get();
  let sent = 0;
  for (const d of toks.docs) {
    const token = d.data().token;
    if (!token) continue;
    try {
      await messaging.send({
        token,
        data: { title, body, url, tag },
        webpush: {
          headers: { Urgency: 'high', TTL: '43200' },
          notification: { title, body, icon: `${SITE}assets/icon-192.png`, badge: `${SITE}assets/icon-192.png`, tag },
          fcmOptions: { link: url },
        },
      });
      sent++;
    } catch (e) {
      const code = e?.errorInfo?.code || e?.code || '';
      if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test(code)) { await d.ref.delete().catch(() => {}); log(`Push: Gerät abgemeldet (${code}).`); } else log(`Push fehlgeschlagen (${code || e?.message}).`);
    }
  }
  return sent;
}

async function profileOf(db, uid) {
  const s = await db.collection('users').doc(uid).collection('pushinfo').doc('profile').get();
  return s.exists ? s.data() : null;
}

/** „Jelly ist fertig“ – aufgerufen vom Worker, wenn ein Hintergrund-Auftrag erledigt ist. */
export async function notifyDone(db, messaging, uid, type, log) {
  if (!messaging) return;
  const p = await profileOf(db, uid);
  if (!p?.enabled || p.types?.done === false) return;
  await sendTo(db, messaging, uid, { title: 'Jelly ist fertig ✅', body: DONE_TEXT[type] || 'Deine Lernsachen sind fertig.', tag: `done-${type}` }, log);
}

// Ortszeit in der Zeitzone des Kontos
function local(tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const shift = (n) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  return { today, yesterday: shift(-1), tomorrow: shift(1), hm: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}` };
}

/** Regelmäßiger Durchlauf (alle 15 Minuten): Erinnerungen, Serie, Klausur, To-dos. */
export async function runPush(db, messaging, log = console.log) {
  const profiles = await db.collectionGroup('pushinfo').get();
  let n = 0;
  for (const doc of profiles.docs) {
    if (doc.id !== 'profile') continue;
    const p = doc.data();
    if (!p?.enabled) continue;
    const uid = doc.ref.parent.parent.id;
    const t = local(p.tz);
    const sent = { ...(p.sent || {}) };
    const want = (k) => p.types?.[k] !== false && sent[k] !== t.today;
    const quiet = t.hm < '07:00' || t.hm >= '21:30';
    const learnedToday = p.lastLearnDay === t.today;
    const msgs = [];
    if (!quiet && want('daily') && !learnedToday && t.hm >= (p.time || '17:00')) {
      msgs.push(['daily', { title: 'Zeit für Jelly 🪼', body: p.next ? `Heute dran: ${p.next}` : 'Ein paar Minuten lernen? Jelly hat alles vorbereitet.', tag: 'daily' }]);
    }
    if (!quiet && want('streak') && !learnedToday && (p.streak || 0) >= 2 && p.lastLearnDay === t.yesterday && t.hm >= '19:00') {
      msgs.push(['streak', { title: `Deine ${p.streak}-Tage-Serie 🔥`, body: 'Sie endet um Mitternacht – schon eine Einheit rettet sie.', tag: 'streak' }]);
    }
    const examsTomorrow = (p.exams || []).filter((e) => e.date === t.tomorrow);
    if (!quiet && want('exam') && examsTomorrow.length && t.hm >= '16:00') {
      const names = examsTomorrow.map((e) => e.name).join(' & ');
      msgs.push(['exam', { title: `Morgen: ${names}-Klausur 📚`, body: 'Noch ein kurzes Quiz zum Aufwärmen? Du schaffst das!', tag: 'exam' }]);
    }
    const todosToday = (p.todos || []).filter((x) => x.date === t.today);
    if (!quiet && want('todo') && todosToday.length && t.hm >= '14:00') {
      msgs.push(['todo', { title: todosToday.length === 1 ? 'Heute fällig 📝' : `${todosToday.length} To-dos heute fällig 📝`, body: todosToday.slice(0, 3).map((x) => x.title).join(' · '), tag: 'todo' }]);
    }
    // Höchstens zwei Mitteilungen pro Durchlauf, damit es nicht nervt
    for (const [k, m] of msgs.slice(0, 2)) {
      try { if (await sendTo(db, messaging, uid, m, log)) n++; } catch (e) { log(`Push-Fehler: ${e?.message}`); }
      sent[k] = t.today;
    }
    if (msgs.length) await doc.ref.set({ sent }, { merge: true });
  }
  return n;
}
