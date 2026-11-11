// Firestore-Sicherheitsregeln für Jelly + Control. Werden in der Control-App angezeigt und in der
// Firebase-Konsole eingefügt. Hier liegt der eigentliche Schutz – die App selbst kann man verändern, die Regeln nicht.
//
// Zugang zu Jelly-Daten (users/{uid}/…) hat ein Konto, wenn
//   • es eine Freischaltung hat (licenses/{uid}, nicht gesperrt) – per Einmal-Code oder von Control, oder
//   • es ein Bestandskonto ist (hatte schon vor dem Code-Schutz einen Stand in der Cloud) und nicht gesperrt wurde.
// Einmal-Codes (invites/{code}) erstellt nur Control. Ein Code lässt sich genau einmal einlösen und ist dann
// an dieses Konto gebunden – Weitergeben bringt nichts.

export function rulesText(admins) {
  const list = [...new Set(admins.filter(Boolean))].map((u) => `'${u}'`).join(', ');
  return `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null; }
    function isAdmin() { return signedIn() && request.auth.uid in [${list}]; }
    function licPath(uid) { return /databases/$(database)/documents/licenses/$(uid); }
    function hasLic(uid) { return exists(licPath(uid)); }
    function revoked(uid) { return get(licPath(uid)).data.get('revoked', false) == true; }
    // Bestandskonto: hatte schon vor dem Code-Schutz einen Stand in der Cloud
    function legacy(uid) { return exists(/databases/$(database)/documents/users/$(uid)/state/meta); }
    function mayUse(uid) {
      return signedIn() && request.auth.uid == uid
        && ((hasLic(uid) && !revoked(uid)) || (!hasLic(uid) && legacy(uid)));
    }

    match /users/{uid}/{document=**} {
      allow read, write: if mayUse(uid);
    }
    // Control darf Stand und Dateien lesen (nicht ändern). KI-Schlüssel liegen unter secret/ – dort kein Zugriff.
    match /users/{uid}/state/{doc} {
      allow read: if isAdmin();
    }
    match /users/{uid}/blobs/{doc} {
      allow read: if isAdmin();
    }
    // Kontoübersicht: jedes Konto schreibt nur seinen eigenen Eintrag, lesen darf nur Control
    match /userIndex/{uid} {
      allow write: if signedIn() && request.auth.uid == uid;
      allow read, delete: if isAdmin();
    }
    // Einmal-Codes: nur Control erstellt/listet/löscht. Einlösen = usedBy einmalig auf das eigene Konto setzen,
    // zusammen mit der eigenen Freischaltung (gleicher Schreibvorgang).
    match /invites/{code} {
      allow get: if signedIn();
      allow list, create, delete: if isAdmin();
      allow update: if isAdmin() || (signedIn()
        && resource.data.usedBy == null
        && request.resource.data.usedBy == request.auth.uid
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['usedBy', 'usedAt', 'usedEmail'])
        && getAfter(licPath(request.auth.uid)).data.code == code);
    }
    match /licenses/{uid} {
      allow get: if signedIn() && (request.auth.uid == uid || isAdmin());
      allow list, update, delete: if isAdmin();
      allow create: if isAdmin() || (signedIn() && request.auth.uid == uid
        && request.resource.data.keys().hasOnly(['code', 'at', 'email'])
        && request.resource.data.code is string
        && get(/databases/$(database)/documents/invites/$(request.resource.data.code)).data.usedBy == null
        && getAfter(/databases/$(database)/documents/invites/$(request.resource.data.code)).data.usedBy == uid);
    }
    // Weitere Control-Konten (z. B. Partner)
    match /control/{doc} {
      allow read, write: if isAdmin();
    }
  }
}`;
}

// Prüfcode, ob die eingefügten Regeln schon den Code-Schutz kennen (Control liest dafür invites)
export const RULES_VERSION = 2;
