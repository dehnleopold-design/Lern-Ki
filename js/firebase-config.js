// Firebase-Projekt für die Anmeldung (Google oder E-Mail/Passwort).
// Diese Werte sind NICHT geheim – sie identifizieren nur das Projekt. Geschützt wird über
// "Autorisierte Domains" in der Firebase-Konsole. (Google Analytics wird bewusst nicht genutzt.)
export const firebaseConfig = {
  apiKey: 'AIzaSyDFaPX0hMbPOzCSZOSqsGa-EzvKPLBxK8A',
  authDomain: 'jelly-721e4.firebaseapp.com',
  projectId: 'jelly-721e4',
  storageBucket: 'jelly-721e4.firebasestorage.app',
  messagingSenderId: '246858325587',
  appId: '1:246858325587:web:5f3c7afabd9c25d41fb0a6',
};

// Erst einschalten, wenn in der Firebase-Konsole Authentication gestartet, E-Mail/Passwort + Google
// aktiviert und die Domain dehnleopold-design.github.io freigegeben ist.
export const authActive = true;

// Hintergrund-Funktion (functions/, Firebase Cloud Functions, braucht den Blaze-Tarif).
// Erst auf true setzen, wenn sie hochgeladen ist – sonst verspricht die App etwas, das nicht passiert.
export const backgroundFunctions = false;

// Push-Mitteilungen: öffentlicher Web-Push-Schlüssel (VAPID) aus der Firebase-Konsole →
// Projekteinstellungen → Cloud Messaging → Web-Push-Zertifikate → „Schlüsselpaar generieren“.
// Nicht geheim. Leer = Mitteilungen in der App als „noch nicht eingerichtet“ anzeigen.
export const pushVapidKey = '';
