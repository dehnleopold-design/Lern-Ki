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
export const authActive = false;
