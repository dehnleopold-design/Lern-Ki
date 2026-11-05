# Lern-KI – kostenlose Klausurvorbereitung mit KI

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
- **Bilinguale Fächer** (z. B. Geography): Aufgaben, Korrektur und Sprachkorrektur auf Englisch.
- Fächer jederzeit nachtragen (Tab „Fächer“ → +).

## Was kostet das?

Die App selbst kostet nichts und hat keinen eigenen Server. Alle Daten bleiben im Browser auf deinem Gerät.
Die KI ist **Google Gemini** über einen eigenen API-Schlüssel. Google bietet dafür eine kostenlose Stufe an. Dazu musst du Folgendes wissen:

- Die kostenlose Stufe hat **Tageslimits**. Wird ein Limit erreicht, zeigt die App das an. Dann später weitermachen oder in den Einstellungen ein anderes Modell wählen.
- In der kostenlosen Stufe darf Google Eingaben zur Verbesserung seiner Dienste nutzen. Lade also nichts Sensibles hoch.
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
