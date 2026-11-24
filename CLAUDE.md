# Jelly (Lern-KI) – Hinweise für Claude-Sitzungen

Lern-App (PWA, Vanilla-JS-Module, kein Build) auf GitHub Pages: https://dehnleopold-design.github.io/Lern-Ki/
Nutzer: Schüler, schreibt Deutsch, nutzt ein iPad. Antworten auf Deutsch, faktenbasiert, kurz.

## Arbeitsweise (wichtig)
- Branch: `claude/knowunity-exam-prep-app-ycrff7` – nur dorthin pushen, kein PR ohne Auftrag.
- Vor jedem Push: `git pull --rebase origin claude/knowunity-exam-prep-app-ycrff7` (mehrere Sitzungen arbeiten parallel).
- **Neue Funktionen nur in `dev/`** (Jelly Developer, https://dehnleopold-design.github.io/Lern-Ki/dev/). Das echte Jelly (`js/`, `styles.css`, `index.html`) nicht direkt ändern – außer bei dringenden Fehlern.
- Werkzeug `tools/dev.py`:
  - `python3 tools/dev.py bump "2.71-dev.2"` – nach jeder Änderung in dev/ (Update-Hinweis, Service-Worker-Liste).
  - `python3 tools/dev.py status`
  - Dringende Änderung direkt im echten Jelly (gleich auch in dev/ gemacht): danach `python3 tools/dev.py accept-root`.
  - Nutzer sagt „übertragen“: `python3 tools/dev.py promote "2.72 (TT.MM.)"` und danach `bump` auf die nächste dev-Version. Bricht ab, wenn das echte Jelly direkt geändert wurde → Änderungen erst per `git merge-file` in dev/ übernehmen, dann `promote … --merged`.
- Nach dem Push prüfen, dass `version.json` bzw. `dev/version.json` live ist.
- Keine Modellnamen in Commits/Code. Keine E-Mail-Adressen oder Schlüssel ins Repo.

## Aufbau (Kurz)
- `js/app.js` Hauptansichten (Routen über `go(name, params)`), `js/store.js` IndexedDB-Stand, `js/sync.js` Firestore-Sync (`users/{uid}/…`, in Developer `dev_…`), `js/gen.js` + `js/prompts.js` KI-Abläufe (Gemini), `js/hand.js` Handschrift, `js/hand-fallback.js` Ersatz-Zeichen (Hershey, gemeinfrei), `js/hand-words.js` Wortliste, `js/push.js` Mitteilungen (andere Sitzung), `js/env.js` Developer-Erkennung, `js/devtools.js` DEV-Werkzeuge, `js/inbox.js` Posteingang (Control schickt Klausuren aus anderen Konten ins eigene Konto, `users/{uid}/inbox`).
- `control/` Admin-App (Zugangscodes, Firestore-Regeln in `control/rules.js` – Nutzer fügt sie selbst in Firebase ein). `voice/` Jelly Voice. `server/` + `functions/` Firebase-Hintergrunddienst.
- Blatt-Löser: `solveSheet` (gen.js) → `item.annot[fid]`; Anzeige über `sheetEntries` (Platzprüfung, Ausschnitt, kariertes Blatt) und `inkPlace` in app.js.

## Testen
- Lokal: `python3 -m http.server 8765` im Repo; Playwright (CommonJS `require('playwright')`), Firestore-Emulator mit Fake-Auth (Firebase-Module per `page.route` ersetzen). KI-Antworten per `page.route` auf `generativelanguage.googleapis.com` vortäuschen.
- Auf dem echten iPad kann nur der Nutzer testen – das in Antworten ehrlich sagen.
