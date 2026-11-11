// Zugangsschutz: Neue Konten brauchen einen Einmal-Code (erstellt in Jelly Control).
// Durchgesetzt wird das von den Firestore-Regeln (control/rules.js) – hier nur Prüfen und Einlösen.
// Bestandskonten (schon ein Stand in der Cloud) sind automatisch frei.

import { firebaseApp } from './auth.js';

const V = '10.12.2';
let fs = null;
let db = null;
async function fire() {
  if (!fs) {
    fs = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`);
    db = fs.getFirestore(firebaseApp());
  }
}

const KEY = (uid) => `lernki-access-${uid}`;
const remember = (uid, v) => { try { localStorage.setItem(KEY(uid), v); } catch {} };
export const cachedAccess = (uid) => { try { return localStorage.getItem(KEY(uid)); } catch { return null; } };

const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'unavailable' })), ms))]);

// → 'ok' | 'need-code' | 'revoked'
export async function checkAccess(uid) {
  try {
    await fire();
    let lic;
    try { lic = await timeout(fs.getDoc(fs.doc(db, 'licenses', uid)), 9000); } catch (e) {
      // Alte Regeln ohne Code-Schutz: Lizenzen sind gar nicht lesbar → niemand wird ausgesperrt
      if (e.code === 'permission-denied') return 'ok';
      throw e;
    }
    if (lic.exists()) { const v = lic.data().revoked ? 'revoked' : 'ok'; remember(uid, v); return v; }
    try {
      const meta = await timeout(fs.getDoc(fs.doc(db, 'users', uid, 'state', 'meta')), 9000);
      const v = meta.exists() ? 'ok' : 'need-code';
      remember(uid, v);
      return v;
    } catch (e) {
      if (e.code === 'permission-denied') { remember(uid, 'need-code'); return 'need-code'; }
      throw e;
    }
  } catch {
    // Offline: letztes bekanntes Ergebnis; ohne Wissen nicht aussperren (synchronisieren geht ohne Freigabe eh nicht)
    return cachedAccess(uid) || 'ok';
  }
}

export const normalizeCode = (raw) => {
  const c = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
};

// Löst einen Code für dieses Konto ein. Wirft Fehler mit verständlicher Meldung.
export async function redeemCode(user, raw) {
  const code = normalizeCode(raw);
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) throw new Error('Der Code hat das Format XXXX-XXXX.');
  await fire();
  const ref = fs.doc(db, 'invites', code);
  let inv;
  try { inv = await fs.getDoc(ref); } catch { throw new Error('Keine Verbindung – bitte gleich nochmal versuchen.'); }
  if (!inv.exists()) throw new Error('Diesen Code gibt es nicht. Vertippt?');
  const used = inv.data().usedBy;
  if (used && used !== user.uid) throw new Error('Dieser Code wurde schon benutzt. Jeder Code funktioniert nur einmal.');
  if (!used) {
    const b = fs.writeBatch(db);
    b.set(fs.doc(db, 'licenses', user.uid), { code, at: Date.now(), email: user.email || '' });
    b.update(ref, { usedBy: user.uid, usedAt: Date.now(), usedEmail: user.email || '' });
    try { await b.commit(); } catch { throw new Error('Einlösen hat nicht geklappt. Ist der Code schon benutzt?'); }
  }
  remember(user.uid, 'ok');
}
