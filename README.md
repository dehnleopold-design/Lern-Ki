# Lern-KI – kostenlose Klausurvorbereitung mit KI

Mit Jelly, der kleinen Lern-Qualle.

Eine Web-App (läuft auf iPad, Handy und PC), die dich gezielt auf Klassenarbeiten vorbereitet:

- **Fragebogen beim Start**: Klasse, Schulform, Bundesland, Fächer, Unterrichtssprache je Fach, Selbsteinschätzung, Lernzeit, Lernweise, Korrekturstil, Notenskala.
- **Klausur anlegen**: Fach → Datum → Zielnote → Material hochladen (Fotos, PDFs). Die KI liest jedes Blatt einmal gründlich und teilt den Stoff in **Themen** auf, verteilt auf die Tage bis zur Klausur.
- **Jedes Thema in 3 Schritten**: 1. **Lernzettel** (auch als PDF speicherbar), 2. **Quiz** mit Begriffen, Fakten und Zahlen (sofort ausgewertet, ohne KI-Wartezeit), 3. **Anwendungsaufgaben**, kreativ (Fallbeispiele, Material auswerten, Fehler finden, Stellung nehmen …) und in der Sprache der Lehrkraft.
- **Abschluss-Bereich**, jederzeit erreichbar: Gesamt-Lernzettel + Probeklassenarbeit mit Timer.
- **Überspringen**: Einzelne Schritte oder ganze Themen lassen sich überspringen und wieder aufnehmen (Thema-Balken antippen).
- **Ehrliche Korrektur**: Punkte, zitierte Fehler, was fehlt, Musterlösung, Erwartungshorizont, Notenschätzung. Danach stellt die KI eine **Nachfrage**, die du beantwortest.
- **Klausur-Archiv pro Fach**: Lade alte (am besten korrigierte) Klausuren hoch. Daraus entsteht ein **Lehrerprofil**, nach dem Aufgaben und Korrektur ausgerichtet werden.
- **Schwächen-Liste**: Erkannte Schwächen fließen in alle weiteren Aufgaben ein.
- **Tutor-Chat** zum Stoff der jeweiligen Klausur.
- **Arbeitsblatt lösen** (Tab Fächer): leeres Blatt einscannen → Jelly löst alle Aufgaben mit Musterlösung, Lösungsweg und Fehler-Hinweisen. Die Lösungen sind zum Selbsttesten zugeklappt, es gibt einen PDF-Download und eine Nachfrage-Funktion.
- **Vokabeln** (eigener Tab): Vokabelseite fotografieren → Jelly liest alle Wörter aus (bearbeitbare Liste). Dazu gibt es einen **Lernplan** bis zum Test (Tagesportionen plus Wiederholung nach 1 und 3 Tagen), **Schnell-Quiz**, **Fehler üben** (Lernkartei mit 5 Stufen) und einen **Probe-Test**. Lädst du alte Vokabeltests hoch, orientiert sich der Probe-Test an Aufgabentypen und Strenge deiner Lehrkraft. Die Schreibweise zählt: Akzente wie in „niño“ müssen stimmen.
- **Bilinguale Fächer** (z. B. Geography): Aufgaben, Korrektur und Sprachkorrektur auf Englisch.
- Fächer jederzeit nachtragen (Tab „Fächer“ → +).

## Was kostet das?

Die App selbst kostet nichts und hat keinen eigenen Server. Alle Daten bleiben im Browser auf deinem Gerät.
Die KI ist **Google Gemini** über einen eigenen API-Schlüssel. Google bietet dafür eine kostenlose Stufe an. Dazu musst du Folgendes wissen:

- Die kostenlose Stufe hat **Tageslimits**. Wird ein Limit erreicht, zeigt die App das an. Dann später weitermachen oder in den Einstellungen ein anderes Modell wählen.
- Laut Googles Gemini-Bedingungen gelten für Nutzer in der EU auch in der kostenlosen Stufe die Datenregeln der bezahlten Stufe: Eingaben werden nicht zur Produktverbesserung genutzt. Lade trotzdem keine Namen oder Noten anderer Personen hoch.
- Für einen API-Schlüssel verlangt Google, dass der Kontoinhaber volljährig ist. Gegebenenfalls erstellt ein Elternteil den Schlüssel.
- Welche Modelle gerade kostenlos sind, ändert Google regelmäßig. Deshalb lädt die App die Modellliste live. Die aktuellen Bedingungen stehen unter https://ai.google.dev/pricing.

Alternativ geht jeder OpenAI-kompatible Anbieter (Einstellungen → „Anderer Anbieter“). Dort kann die App aber nur Fotos lesen, keine PDFs.

## Einrichten (einmalig)

1. **App online stellen** (eine der beiden Varianten):
   - **GitHub Pages**: Repo → Settings → Pages → „Deploy from a branch“, Branch `main`, Ordner `/ (root)`. Nach 1–2 Minuten ist die App unter `https://<benutzername>.github.io/<repo>/` erreichbar.
     Achtung: Bei einem **privaten** Repo gibt es GitHub Pages nur mit einem kostenpflichtigen GitHub-Plan. Das Repo enthält keine Geheimnisse (der API-Schlüssel liegt nur auf deinem Gerät), du kannst es also öffentlich machen.
   - **Netlify Drop** (kostenlos, das Repo kann privat bleiben): Den Projektordner auf https://app.netlify.com/drop ziehen.
2. Die Adresse auf dem iPad in **Safari** öffnen, dann Teilen → **„Zum Home-Bildschirm“**. Danach startet die App wie eine normale App.
3. Den Fragebogen ausfüllen. Im letzten Schritt den Gemini-Schlüssel von https://aistudio.google.com/apikey einfügen und „prüfen“ tippen.

## Tipps für gute Ergebnisse

- Möglichst **alle** Arbeitsblätter und Hefteinträge zum Thema hochladen. Die KI arbeitet nur mit dem, was sie bekommt, und meldet Lücken.
- Alte Klausuren **mit Korrektur** (Rotstift, Punkte) bringen am meisten für das Lehrerprofil.
- Unter Fächer → Fach kannst du notieren, worauf deine Lehrkraft achtet. Das Lehrerprofil lässt sich dort auch von Hand bearbeiten.
- Handschriftliche Lösungen (z. B. in Mathe) kannst du bei jeder Aufgabe fotografieren.
- Ab und zu **Backup herunterladen** (Einstellungen). Wenn die Safari-Daten gelöscht werden, sind die Daten sonst weg.

## Grenzen

- Die KI kann sich irren, auch bei der Korrektur. Bei Zweifeln im Material oder bei der Lehrkraft nachprüfen.
- Die Notenschätzung nutzt einen verbreiteten Oberstufen-Schlüssel (15 Punkte ab 95 % … 1 Punkt ab 20 %). Der Schlüssel deiner Schule kann davon abweichen.
- Sehr große PDFs (über 18 MB) müssen geteilt werden.

## Technik

Reines HTML/CSS/JavaScript ohne Build-Schritt. Gespeichert wird in IndexedDB, mit Service Worker für Offline-Start.
Die Anweisungen an die KI stehen in `js/prompts.js`. Dort lassen sich Strenge und Aufgabenstil anpassen.

Lokal testen: `python3 -m http.server` im Projektordner, dann http://localhost:8000 öffnen.

## Anmeldung (optional, Firebase)

Solange in `js/firebase-config.js` `null` steht, läuft die App ohne Anmeldung. Ist Firebase eingerichtet, wird die Anmeldung **nur bei einem frischen Start ohne Daten** angeboten (mit „Ohne Konto weiter“). Wer die App schon nutzt, wird nicht gefragt. Mit Anmeldung bekommt jedes Konto auf dem Gerät einen eigenen, getrennten Speicher. Die Daten von vorher übernimmt das erste Konto, das sich auf dem Gerät anmeldet. In die Cloud wird nichts hochgeladen.

Einrichtung (kostenloser Spark-Tarif, keine Kreditkarte):
1. https://console.firebase.google.com → **Projekt erstellen** (z. B. „Lern-KI“), Google Analytics kann aus bleiben.
2. **Authentication** → *Jetzt starten* → *Anmeldemethode*: **E-Mail/Passwort** und **Google** aktivieren (bei Google eine Support-E-Mail wählen).
3. **Authentication → Einstellungen → Autorisierte Domains** → `dehnleopold-design.github.io` hinzufügen.
4. **Projekteinstellungen** (Zahnrad) → *Meine Apps* → Web-App (`</>`) registrieren → den `firebaseConfig`-Block in `js/firebase-config.js` eintragen.

**Geräte-Sync:** Mit Konto wird alles (auch Fotos/PDFs) über Firestore zwischen Geräten abgeglichen – der neuere Stand gewinnt. Einrichtung: Firestore → Datenbank erstellen (europe-west3, Produktionsmodus) und diese Regeln veröffentlichen:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

Hinweis: In Home-Bildschirm-Apps auf iPhone/iPad kann das Google-Popup unzuverlässig sein. E-Mail/Passwort funktioniert immer.

## Jelly im Hintergrund (optional, Firebase Cloud Functions)

Mit Konto erstellt Jelly auch bei **geschlossener App** weiter: Blätter lesen, Lehrerprofil, Lernplan, Lernzettel, Quiz, Aufgaben, Vokabeln auslesen, Vokabeltest-Profile und gelöste Arbeitsblätter. Das läuft über Firebase Cloud Functions im Rechenzentrum Frankfurt (`functions/index.js`, Logik in `server/worker.mjs`).

1. Die App legt Aufträge in Firestore an (`users/{uid}/bgjobs`).
2. Sobald die App geschlossen wird, startet die Funktion. Alle 10 Minuten schaut sie zusätzlich nach Liegengebliebenem.
3. Sie nutzt den KI-Schlüssel aus dem synchronisierten Stand und legt die Ergebnisse getrennt ab (`users/{uid}/bgresults`). Die App übernimmt sie beim nächsten Öffnen.

Solange die App offen ist, erstellt sie selbst und die Funktion pausiert (sonst teilen sich beide die Gratis-Limits des Schlüssels).
Die Funktion lädt `server/worker.mjs` und die App-Module bei jeder neuen Version von der Website (Liste in `server/files.json`). Änderungen daran brauchen deshalb kein neues Deployment, nur Änderungen an `functions/index.js`.

Einrichtung (einmalig):
1. Firebase-Konsole → Projekt → Tarif auf **Blaze** umstellen. Danach unter Google Cloud → Abrechnung → **Budgets & Benachrichtigungen** ein Budget von z. B. 1 € mit E-Mail-Warnung anlegen (Warnung, keine harte Grenze).
2. **Google Cloud Shell** öffnen: https://shell.cloud.google.com/?project=jelly-721e4 und dort ausführen:
   ```
   git clone -b claude/knowunity-exam-prep-app-ycrff7 https://github.com/dehnleopold-design/Lern-Ki.git && cd Lern-Ki && (cd functions && npm install) && npx -y firebase-tools@latest deploy --only functions --project jelly-721e4
   ```
   Fragt das Programm nach einer Anmeldung, `npx -y firebase-tools@latest login --no-localhost` ausführen und den Anweisungen folgen, danach den Befehl wiederholen.
