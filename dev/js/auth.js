// Anmeldung über Firebase Authentication (kostenloser Spark-Tarif).
// Die Lerndaten bleiben auf dem Gerät – jedes Konto bekommt dort einen eigenen, getrennten Speicher.

import { firebaseConfig, authActive } from './firebase-config.js';

const V = '10.12.2';
let auth = null;
let appInst = null;
let fb = null;

export const authEnabled = !!firebaseConfig && authActive;

export async function initAuth(onUser) {
  const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
  fb = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`);
  appInst = initializeApp(firebaseConfig);
  auth = fb.getAuth(appInst);
  auth.languageCode = 'de';
  fb.onAuthStateChanged(auth, onUser);
}

export const signInGoogle = () => fb.signInWithPopup(auth, new fb.GoogleAuthProvider());
export const signInEmail = (email, pw) => fb.signInWithEmailAndPassword(auth, email, pw);
export async function registerEmail(email, pw, name) {
  const cred = await fb.createUserWithEmailAndPassword(auth, email, pw);
  if (name) { try { await fb.updateProfile(cred.user, { displayName: name }); } catch {} }
  try { await fb.sendEmailVerification(cred.user); } catch {}
  return cred;
}
export const resetPassword = (email) => fb.sendPasswordResetEmail(auth, email);
export const signOutUser = () => fb.signOut(auth);
export const deleteAccount = () => fb.deleteUser(auth.currentUser);
export const currentUser = () => auth?.currentUser || null;
export const firebaseApp = () => appInst;

export function authErrorText(e) {
  const code = e?.code || '';
  const map = {
    'auth/invalid-email': 'Die E-Mail-Adresse ist ungültig.',
    'auth/missing-password': 'Bitte ein Passwort eingeben.',
    'auth/weak-password': 'Das Passwort ist zu kurz (mindestens 6 Zeichen).',
    'auth/email-already-in-use': 'Mit dieser E-Mail gibt es schon ein Konto – melde dich an.',
    'auth/invalid-credential': 'E-Mail oder Passwort stimmt nicht.',
    'auth/wrong-password': 'E-Mail oder Passwort stimmt nicht.',
    'auth/user-not-found': 'Zu dieser E-Mail gibt es kein Konto – registriere dich.',
    'auth/too-many-requests': 'Zu viele Versuche. Bitte kurz warten.',
    'auth/network-request-failed': 'Keine Internetverbindung.',
    'auth/popup-blocked': 'Das Google-Fenster wurde blockiert. Bitte nochmal tippen oder E-Mail-Anmeldung nutzen.',
    'auth/popup-closed-by-user': 'Google-Anmeldung abgebrochen.',
    'auth/cancelled-popup-request': 'Google-Anmeldung abgebrochen.',
    'auth/unauthorized-domain': 'Diese Adresse ist in Firebase noch nicht freigegeben (Autorisierte Domains).',
    'auth/requires-recent-login': 'Zur Sicherheit bitte einmal ab- und wieder anmelden, dann nochmal löschen.',
    'auth/operation-not-allowed': 'Diese Anmeldeart ist in Firebase noch nicht aktiviert.',
  };
  return map[code] || `Anmeldung fehlgeschlagen${code ? ` (${code})` : ''}.`;
}
