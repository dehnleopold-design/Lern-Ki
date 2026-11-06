// Alle Anweisungen an die KI an einer Stelle. Hier wird festgelegt, wie streng, prüfungsnah
// und lehrerspezifisch die KI arbeitet.

import { state } from './store.js';
import { gradeLabel, scaleLabel } from './grades.js';

const MAX_CONTEXT_CHARS = 160000;

export function subjectOf(exam) {
  return state.subjects.find((s) => s.id === exam.subjectId);
}

export function baseSystem(subject) {
  const p = state.profile || {};
  const harsh = (p.feedbackStyle || 'hart') === 'hart';
  const lang = subject?.language === 'en'
    ? `\nUNTERRICHTSSPRACHE IN DIESEM FACH: ENGLISCH (bilingualer Unterricht).
- Aufgaben, Materialien, Musterlösungen und Feedback auf Englisch.
- Bewerte zusätzlich Fachsprache und Grammatik: Jeden Sprachfehler zitieren und korrigieren.
- Schwierige Fachbegriffe darfst du kurz in Klammern auf Deutsch erklären.`
    : '';
  return `Du bist "Jelly", ein Lerncoach, der eine Person gezielt auf eine Klassenarbeit/Klausur vorbereitet.

SCHÜLER/IN: ${p.name || 'unbekannt'}, Klasse ${p.grade || '?'}, ${p.schoolType || 'Schule'}, Bundesland ${p.state || 'unbekannt'}.
Lernzeit pro Tag: ca. ${p.minutesPerDay || 30} Minuten. Lernt am besten durch: ${(p.learnStyles || []).join(', ') || 'keine Angabe'}.
Notenskala: ${scaleLabel()}.
${subject ? `FACH: ${subject.name}. Selbsteinschätzung: ${['', 'eher schwach', 'mittel', 'eher stark'][subject.level || 2]}.` : ''}

GRUNDREGELN
1. Ehrlichkeit vor Freundlichkeit. ${harsh
    ? 'Kein Schönreden, kein Lob ohne Grund, keine Gnadenpunkte. Fehler werden klar und ohne Umschweife benannt – immer mit Begründung und Korrektur.'
    : 'Direkt und klar, Fehler werden immer benannt und begründet, aber in ermutigendem Ton.'}
2. Prüfungsnähe: Aufgaben so, wie sie in einer echten Klassenarbeit dieser Klassenstufe und dieses Bundeslands vorkommen – mit Operatoren (nennen, beschreiben, erklären, erläutern, analysieren, vergleichen, interpretieren, beurteilen, bewerten, erörtern, berechnen, begründen …) und Anforderungsbereichen I–III. KEINE Trivia-Quizfragen, KEINE Abfrage nebensächlicher Details (Jahreszahlen, Seitenzahlen, Namen von Beispielen), es sei denn, das Material zeigt, dass genau das abgefragt wird.
3. Lehrerorientierung: Richte dich strikt nach dem Unterrichtsmaterial (Arbeitsblätter, Hefteinträge) und dem Lehrerprofil aus alten Klausuren: gleiche Aufgabenformate, gleiche Operatoren, gleiche Schwerpunkte, gleicher Erwartungshorizont. Was die Lehrkraft in alten Klausuren angestrichen hat, wird auch hier streng bewertet.
4. Keine Erfindungen: Wenn das Material etwas nicht abdeckt oder unklar ist, sag das ausdrücklich, statt zu raten.
5. Formeln in einfacher Textform (x², √, ·, a/b, Δ). Antworte in Markdown (fett, Listen), knapp und konkret.
6. Sprache: Deutsch, außer das Fach verlangt etwas anderes.${lang}`;
}

function fileDigestText(id) {
  const f = state.files[id];
  if (!f?.digest) return '';
  const d = f.digest;
  const list = (x) => (Array.isArray(x) && x.length ? x.map((v) => `- ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n') : '');
  return [
    `### ${f.kind === 'archive' ? 'ALTE KLAUSUR' : 'MATERIAL'}: ${d.titel || f.name}${d.art ? ` (${d.art})` : ''}`,
    d.themen?.length ? `Themen: ${d.themen.join(', ')}` : '',
    d.lehrerSchwerpunkte?.length ? `Schwerpunkte der Lehrkraft:\n${list(d.lehrerSchwerpunkte)}` : '',
    d.aufgabenAufAB?.length ? `Aufgaben auf dem Blatt:\n${list(d.aufgabenAufAB)}` : '',
    d.bewertungshinweise ? `Bewertungshinweise/Korrekturen: ${typeof d.bewertungshinweise === 'string' ? d.bewertungshinweise : JSON.stringify(d.bewertungshinweise)}` : '',
    d.inhalt ? `Inhalt:\n${d.inhalt}` : '',
  ].filter(Boolean).join('\n');
}

export function examContext(exam) {
  const subject = subjectOf(exam);
  const parts = [];
  if (subject?.teacherProfile) parts.push(`## LEHRERPROFIL (aus alten Klausuren abgeleitet)\n${subject.teacherProfile}`);
  if (subject?.teacherNotes) parts.push(`## EIGENE NOTIZEN DES SCHÜLERS ZUR LEHRKRAFT\n${subject.teacherNotes}`);
  if (exam.topicsText) parts.push(`## THEMEN LAUT SCHÜLER\n${exam.topicsText}`);
  if (exam.weaknesses?.length) parts.push(`## BISHER ERKANNTE SCHWÄCHEN (gezielt trainieren!)\n${exam.weaknesses.slice(-15).map((w) => `- ${w}`).join('\n')}`);
  const mats = (exam.materialIds || []).map(fileDigestText).filter(Boolean);
  if (mats.length) parts.push(`## UNTERRICHTSMATERIAL\n${mats.join('\n\n')}`);
  if (exam.useArchive !== false && subject) {
    const arch = (subject.archive || []).map(fileDigestText).filter(Boolean);
    if (arch.length) parts.push(`## ALTE KLAUSUREN DIESER LEHRKRAFT\n${arch.join('\n\n')}`);
  }
  let text = parts.join('\n\n');
  if (text.length > MAX_CONTEXT_CHARS) text = text.slice(0, MAX_CONTEXT_CHARS) + '\n[… gekürzt]';
  return text || '(Kein Material vorhanden – arbeite mit dem üblichen Lehrplan dieser Klassenstufe und sage das offen.)';
}

// ---------- 1. Material genau lesen ----------
export function digestPrompt(kind) {
  if (kind === 'archive') {
    return `Das ist eine ALTE KLAUSUR / KLASSENARBEIT (evtl. mit Korrektur der Lehrkraft). Lies sie vollständig und sehr genau – auch handschriftliche Randbemerkungen, Punkte und Rotstift.
Gib NUR JSON zurück:
{
 "titel": "kurzer Titel",
 "art": "Klausur",
 "themen": ["..."],
 "inhalt": "ALLE Aufgabenstellungen wörtlich, inkl. Materialien (Texte/Daten kurz zusammengefasst), Punktzahlen pro Aufgabe",
 "aufgabenformat": "Aufbau, Anzahl Aufgaben, Zeit, Materialarten",
 "operatoren": ["verwendete Operatoren"],
 "bewertungshinweise": "Was die Lehrkraft angestrichen, gelobt, abgezogen hat; Erwartungshorizont; wofür es Punkte gab",
 "lehrerSchwerpunkte": ["worauf die Lehrkraft erkennbar Wert legt"],
 "typischeFehler": ["Fehler, die markiert wurden"]
}
Unleserliches als [unleserlich] kennzeichnen. Nichts erfinden.`;
  }
  return `Das ist UNTERRICHTSMATERIAL (Arbeitsblatt, Lernzettel, Hefteintrag, Buchseite …). Lies es vollständig und sehr genau, inklusive Handschrift, Markierungen, Tabellen, Grafiken.
Gib NUR JSON zurück:
{
 "titel": "kurzer Titel",
 "art": "Arbeitsblatt | Lernzettel | Hefteintrag | Buchseite | Sonstiges",
 "themen": ["..."],
 "inhalt": "Vollständige, sachlich exakte Wiedergabe ALLER prüfungsrelevanten Inhalte: Definitionen, Fakten, Regeln, Formeln, Vokabeln, Beispiele, Grafikinhalte (in Worten). Lieber zu viel als zu wenig.",
 "aufgabenAufAB": ["Aufgabenstellungen auf dem Blatt, wörtlich, mit Operator"],
 "lehrerSchwerpunkte": ["was hervorgehoben, unterstrichen, eingerahmt oder wiederholt wird"],
 "unklar": ["unleserliche oder mehrdeutige Stellen"]
}
Nichts erfinden.`;
}

export function teacherProfilePrompt(subject) {
  return `Leite aus den alten Klausuren unten ein präzises LEHRERPROFIL für das Fach ${subject.name} ab. Es dient später dazu, Übungsaufgaben exakt im Stil dieser Lehrkraft zu erstellen und streng wie sie zu korrigieren.
Gliederung (Markdown, knapp, konkret, mit Beispielen aus den Klausuren):
**Aufbau & Umfang** – **Typische Aufgabenarten & Operatoren** – **Materialien** – **Punkteverteilung / AFB I–III** – **Bewertungsmaßstab** (worauf geachtet wird, wofür abgezogen wird) – **Typische Fehler** – **Tipps für die nächste Klausur**.
Wenn die Datenlage dünn ist, sag das.

${(subject.archive || []).map(fileDigestText).filter(Boolean).join('\n\n')}`;
}

// ---------- 2. Lernplan (nach Themen) ----------
export function planPrompt(exam, days) {
  const subject = subjectOf(exam);
  return `Erstelle einen Lernplan für die ${subject.name}-Klausur.
Klausurtermin: ${exam.date ? exam.date : 'kein Termin (freies Lernen)'}.
Zielnote: ${gradeLabel(exam.targetGrade)}.
${days.length ? `Verfügbare Lerntage (jeweils ca. ${state.profile?.minutesPerDay || 30} Min.):\n${days.map((d) => `- ${d.iso} (${d.label})`).join('\n')}` : 'Keine festen Tage.'}

Jedes Thema wird später nach demselben Prinzip gelernt: 1. Lernzettel, 2. kurzes Fakten-Quiz, 3. Anwendungsaufgaben. Am Ende folgt ein Abschluss (Gesamt-Lernzettel + Probeklassenarbeit) – den musst du NICHT planen.

VORGEHEN
- Bestimme die klausurrelevanten Themen aus Material, Themenangabe und Lehrerprofil. 2–6 Themen, so zugeschnitten, dass jedes in eine Lernsitzung passt. Gewichte nach Prüfungsrelevanz.
- Reihenfolge so, dass Grundlagen zuerst kommen.
- Ordne jedem Thema einen Lerntag zu (bei wenig Tagen mehrere Themen pro Tag). Der letzte Lerntag bleibt möglichst für den Abschluss frei.

Gib NUR JSON zurück:
{
 "titel": "z. B. Geography Klausur",
 "themenUebersicht": "2–4 Sätze: was drankommt und worauf es laut Material/Lehrkraft ankommt",
 "luecken": ["Was im Material fehlt oder unklar ist und der Schüler klären sollte"],
 "themen": [ { "titel": "kurzer Thementitel", "beschreibung": "was genau dazugehört (1–2 Sätze)", "schwerpunkte": ["…"], "tag": "YYYY-MM-DD oder null" } ]
}

KONTEXT:
${examContext(exam)}`;
}

const TEACHER_STYLE = `SPRACHE & STIL DER LEHRKRAFT: Formuliere so, wie die Lehrkraft in alten Klausuren und auf den Arbeitsblättern formuliert – gleiche Anrede (du/Sie/unpersönlich), gleicher Satzbau, gleiche Nummerierung (z. B. "1 a)"), gleiche Fachbegriffe und Operator-Schreibweise, gleiche Länge. Übernimm typische Wendungen. Liegt kein Material dazu vor, nutze den üblichen Stil von Klassenarbeiten dieser Stufe.`;

// ---------- 3a. Lernzettel ----------
const LZ_FORMAT = `FORMAT (genau diese Syntax verwenden – sie wird als gestaltetes Dokument dargestellt):
- Hauptabschnitte nummeriert und in GROSSBUCHSTABEN: "## 1. GRUNDLAGEN: WETTER VS. KLIMA" (bei Seitenangaben im Material: "## 2. NATÜRLICHER KLIMAWANDEL (S. 180–181)")
- Unterüberschriften: "### Titel"
- Listen mit "- " und eingerückte Unterpunkte mit "  - ". Begriff am Anfang fett: "- **Begriff:** Erklärung"
- Gegenüberstellung in zwei Spalten:
:::cols
### Begriff A (Übersetzung)
Text …
---col---
### Begriff B (Übersetzung)
Text …
:::
  (":::cards" statt ":::cols" für zwei umrahmte Karten, z. B. natürlich vs. menschengemacht)
- Kästen (jede Zeile beginnt mit "> "):
> [!KEY] Key Concept
> **Definition:** …
  Vor und nach jedem Kasten eine Leerzeile.
  Typen: [!KEY] wichtige Definition/Kernidee · [!INFO] Material/Film/Quelle aus dem Unterricht · [!TIP] Klausurtipp · [!WARN] häufiger Fehler · [!EXAMPLE] Beispiel/Mustersatz
- Tabellen: "| Spalte | Spalte |" mit Trennzeile "|---|---|" – ideal für Vergleiche, Daten, Ursachen/Folgen
- Formeln/Chemie mit Unicode (CO₂, CH₄, m², ≈, →).`;

export function lernzettelPrompt(exam, topic, isOverall) {
  const subject = subjectOf(exam);
  const scope = isOverall
    ? `einen GESAMT-LERNZETTEL für die komplette Klausur (alle Themen: ${(exam.plan?.themen || []).map((t) => t.titel).join(', ')}). Umfang wie 3 volle DIN-A4-Seiten (ca. 1600–2200 Wörter). Ein Abschnitt pro Thema mit allen Kerninhalten, dazu ein Abschnitt zur METHODIK (Operatoren, Umgang mit Diagrammen/Statistiken/Quellen in 3 Schritten) und – falls in der Klausur geschrieben wird – ein SCHREIB-GUIDE mit Struktur und Beispielsätzen in [!EXAMPLE]-Kästen (z. B. PEEL, Erörterung, Analyse-Aufbau – je nachdem, was die Lehrkraft verlangt).`
    : `einen ausführlichen LERNZETTEL zum Thema "${topic.titel}" (${topic.beschreibung || ''}${topic.schwerpunkte?.length ? `; Schwerpunkte: ${topic.schwerpunkte.join(', ')}` : ''}). Umfang wie 1,5–2 volle DIN-A4-Seiten (ca. 900–1400 Wörter).`;
  const lang = subject?.language === 'en'
    ? 'Sprache: ENGLISCH (bilingualer Unterricht). Wichtige Fachbegriffe beim ersten Auftreten mit deutscher Übersetzung in Klammern, z. B. "Weather (Wetter)".'
    : 'Sprache: Deutsch.';
  return `Schreibe ${scope}

ZIEL: Ein Lernzettel, mit dem man die Klausur bestehen kann, ohne nochmal ins Heft zu schauen – so ausführlich und präzise wie ein sehr guter selbst erstellter Lernzettel einer Oberstufenschülerin. Er ist die Grundlage für das Quiz und die Anwendungsaufgaben.

INHALT:
- Alles Prüfungsrelevante aus dem Material: Definitionen, Fakten, Zahlen/Daten/Jahreszahlen MIT Einheit, Ursachen, Folgen, Mechanismen (mit →), Beispiele/Fallbeispiele aus dem Unterricht, Seitenangaben aus dem Buch, Inhalte aus Filmen/Tracks/Quellen, die im Material vorkommen.
- Erkläre Zusammenhänge, nicht nur Stichworte. Nutze Vergleiche (Spalten/Karten), Tabellen und Kästen dort, wo sie das Lernen erleichtern – mindestens 1 Tabelle, 1 Spalten-Vergleich und 2 Kästen.
- Methodenwissen: Wie geht man an typische Aufgaben heran (z. B. Diagramm beschreiben → erklären → bewerten)?
- Typische Klausurfallen in [!WARN], Klausurtipps der Lehrkraft in [!TIP].
- Nur was im Material steht oder sicheres Standardwissen dieser Klassenstufe ist. Nichts erfinden; Unklares weglassen.
- ${lang}
- Kein Vorwort, kein Schlusswort, keine Überschrift für das ganze Dokument (die setzt die App).

${LZ_FORMAT}

KONTEXT:
${examContext(exam)}`;
}

// ---------- 3b. Fakten-Quiz ----------
export function quizPrompt(exam, topic, lernzettel, previous) {
  return `Erstelle ein kurzes Quiz (8 Fragen) zum Thema "${topic.titel}". Es prüft schnell abrufbares Wissen: Fachbegriffe, Fakten, Zahlen, Werte, Formeln, Einheiten, Zuordnungen – keine langen Erklärungen. Nur klausurrelevantes Wissen, keine Nebensächlichkeiten.
Mische die Fragetypen: ca. 4× "mc" (4 Optionen, plausible Falschantworten), 2× "wahrfalsch", 2× "eingabe" (Antwort ist ein Wort, Begriff oder eine Zahl).
${previous?.length ? `Diese Fragen gab es schon – stelle andere:\n${previous.slice(-20).map((q) => `- ${q}`).join('\n')}` : ''}

Gib NUR JSON zurück:
{ "fragen": [
  { "typ": "mc", "frage": "…", "optionen": ["…","…","…","…"], "richtig": 0, "erklaerung": "1 Satz" },
  { "typ": "wahrfalsch", "frage": "Aussage …", "richtig": true, "erklaerung": "…" },
  { "typ": "eingabe", "frage": "…", "antworten": ["akzeptierte Antwort", "Variante"], "einheit": "optional, z. B. °C", "erklaerung": "…" }
] }

LERNZETTEL ZUM THEMA:
${lernzettel || '(noch keiner – nutze das Material)'}

KONTEXT:
${examContext(exam)}`;
}

// ---------- 3c. Anwendungsaufgaben / Probeklassenarbeit ----------
export function sessionPrompt(exam, unit, previousTitles, extra = {}) {
  const isExam = unit.typ === 'probeklausur';
  const typeRules = isExam
    ? `Erstelle eine KOMPLETTE Probeklassenarbeit über ALLE Themen (${(exam.plan?.themen || []).map((t) => t.titel).join(', ')}) im exakten Stil der alten Klausuren / des Lehrerprofils: gleicher Aufbau, gleiche Operatoren, gleiche Punkteverteilung, realistischer Umfang für die übliche Bearbeitungszeit, mit eigenem Material, falls die Lehrkraft Material verwendet.`
    : `Erstelle 3 ANWENDUNGSAUFGABEN zum Thema "${extra.topic?.titel || unit.titel}" (AFB II–III, eine darf AFB I sein). Der Schüler hat vorher den Lernzettel gelesen und das Quiz gemacht – wiederhole keine reinen Wissensfragen.
SEI KREATIV: Nutze mindestens 2 verschiedene Formate, z. B.
- Fallbeispiel / Szenario aus dem Alltag oder der aktuellen Welt, das mit dem Wissen gelöst werden muss
- Material auswerten: kurzer Text, Quelle, Zitat, Tabelle mit Daten (als Markdown-Tabelle), Diagrammwerte
- Fehler finden: eine fehlerhafte "Schülerlösung" prüfen und korrigieren
- Stellung nehmen / beurteilen / erörtern mit Pro und Contra
- Perspektivwechsel: Brief, Rede, Zeitungsartikel, Dialog schreiben
- Vergleichen, Strukturieren, Transfer auf ein neues Beispiel, Rechnen im Kontext
Die Formate müssen zu dem passen, was die Lehrkraft in Klausuren tatsächlich verlangt.`;
  return `${typeRules}

WICHTIG:
- KEINE Lösung, kein Erklärtext und keine Hinweise auf die Lösung in Aufgabenstellung oder Material. Das Wissen steht im Lernzettel.
- ${TEACHER_STYLE}
- Jede Aufgabe beginnt mit einem Operator, hat einen Erwartungshorizont (wird erst nach der Abgabe gezeigt), eine realistische Punktzahl und Bearbeitungszeit.
${previousTitles.length ? `- Bereits gestellte Aufgaben (NICHT wiederholen, aber Schwächen erneut prüfen):\n${previousTitles.slice(-25).map((t) => `  - ${t}`).join('\n')}` : ''}

Gib NUR JSON zurück:
{
 ${isExam ? '"zeitMinuten": 45,\n ' : ''}"aufgaben": [
  { "id": "a1", "operator": "Erläutere", "afb": "II", "format": "Fallbeispiel", "aufgabe": "vollständige Aufgabenstellung im Stil der Lehrkraft", "material": "optional: Text/Daten/Quelle als Markdown, sonst leer", "punkte": 6, "minuten": 8, "erwartung": ["…", "…"] }
 ]
}
${extra.lernzettel ? `\nLERNZETTEL ZUM THEMA (darauf bauen die Aufgaben auf):\n${extra.lernzettel}\n` : ''}
KONTEXT:
${examContext(exam)}`;
}

// ---------- 4. Korrektur ----------
export function gradePrompt(exam, session) {
  const tasks = session.aufgaben.map((a) => `### Aufgabe ${a.id} (${a.punkte} P., AFB ${a.afb})
${a.aufgabe}
${a.material ? `Material: ${a.material}\n` : ''}Erwartungshorizont: ${(a.erwartung || []).join(' | ')}
ANTWORT DES SCHÜLERS: ${session.answers?.[a.id]?.trim() || '(keine Textantwort)'}${session.answerImages?.[a.id]?.length ? ' [+ Foto der handschriftlichen Lösung, siehe Bild(er) zu dieser Aufgabe]' : ''}`).join('\n\n');
  return `Korrigiere die Antworten wie die Lehrkraft (Lehrerprofil!) – streng, fair, nachvollziehbar.
Regeln:
- Punkte nur für das, was wirklich dasteht. Keine Punkte für "meinte er bestimmt". Teilpunkte nur für korrekte Teile.
- Operator beachten: Wer "beurteilen" soll und nur beschreibt, verliert die meisten Punkte – sag das.
- Jeden Fehler zitieren, erklären, korrigieren. Fehlende Erwartungspunkte konkret auflisten.
- Musterlösung auf dem Niveau der Zielnote ${gradeLabel(exam.targetGrade)}.
- Stelle pro Aufgabe EINE gezielte Nachfrage, die prüft, ob der Schüler den Fehler wirklich verstanden hat (bei voller Punktzahl: eine vertiefende Frage).
- Leere Antworten = 0 Punkte.

Gib NUR JSON zurück:
{
 "ergebnisse": [
  { "id": "a1", "punkte": 3, "maxPunkte": 6, "urteil": "richtig|teilweise|falsch", "feedback": "Markdown, direkt", "fehler": [ { "zitat": "…", "problem": "…", "korrektur": "…" } ], "fehlt": ["…"], "musterloesung": "Markdown", "nachfrage": "…" }
 ],
 "gesamt": { "kommentar": "2–4 Sätze ehrliche Gesamteinschätzung inkl. ob die Zielnote realistisch ist", "schwaechen": ["konkrete Schwäche, z. B. 'Operator beurteilen: kein eigenes Urteil'"], "staerken": ["…"] }
}

${tasks}

KONTEXT:
${examContext(exam)}`;
}

// ---------- 5. Nachfragen-Chat zu einer Aufgabe ----------
export function followupSystem(exam, task, session, result) {
  return `${baseSystem(subjectOf(exam))}

Du führst jetzt ein Nachgespräch zu EINER Aufgabe. Ziel: Der Schüler soll den Fehler selbst verstehen.
- Stelle Rückfragen (sokratisch), gib nicht sofort die Lösung – außer der Schüler fragt ausdrücklich danach oder ist nach 2 Versuchen noch falsch.
- Ist eine Antwort falsch oder ungenau, sag das klar. Ist sie richtig, bestätige kurz und vertiefe.
- Kurz bleiben (max. 120 Wörter pro Antwort).

AUFGABE: ${task.aufgabe}
${task.material ? `MATERIAL: ${task.material}` : ''}
ERWARTUNG: ${(task.erwartung || []).join(' | ')}
ANTWORT DES SCHÜLERS: ${session.answers?.[task.id] || '(keine)'}
KORREKTUR: ${result ? `${result.punkte}/${result.maxPunkte} P. ${result.feedback}` : '-'}
DEINE NACHFRAGE WAR: ${result?.nachfrage || '-'}`;
}

// ---------- 6. Freier Tutor-Chat ----------
export function tutorSystem(exam) {
  return `${baseSystem(subjectOf(exam))}

Du bist im freien Tutor-Chat zur anstehenden Klausur. Beantworte Fragen auf Basis des Materials, frag nach, wenn eine Frage unklar ist, und prüfe Verständnis mit Gegenfragen. Wenn der Schüler etwas Falsches behauptet, widersprich direkt.
Auf Wunsch: stelle eine prüfungsnahe Aufgabe und korrigiere die Antwort streng.

KONTEXT:
${examContext(exam)}`;
}

// ---------- 7. Vokabeln ----------
export function vocabSystem() {
  const p = state.profile || {};
  return `Du bist "Jelly", ein strenger, ehrlicher Vokabeltrainer für ${p.name || 'eine Schülerin/einen Schüler'} (Klasse ${p.grade || '?'}, ${p.schoolType || 'Schule'}, ${p.state || ''}).
Arbeite exakt: Rechtschreibung, Akzente, Artikel/Genus und unregelmäßige Formen müssen stimmen. Nichts erfinden.`;
}

export function vocabExtractPrompt() {
  return `Das ist eine VOKABELSEITE (Vokabelliste aus dem Schulbuch, Vokabelheft, Arbeitsblatt oder Foto). Lies ALLE Einträge vollständig und buchstabengenau ab – auch Handschrift.
Gib NUR JSON zurück:
{
 "titel": "kurzer Titel, z. B. 'Unit 3 – Travel' oder 'Lección 4'",
 "sprache": "Fremdsprache auf Deutsch, z. B. Englisch, Spanisch, Französisch, Latein",
 "vokabeln": [
  { "wort": "Fremdsprache exakt (mit Artikel/Genus, Akzenten, ggf. unregelmäßigen Formen wie 'go – went – gone')",
    "uebersetzung": "deutsche Bedeutung(en), mehrere mit ; getrennt",
    "beispiel": "Beispielsatz/Kollokation von der Seite, sonst leer",
    "info": "Wortart/Grammatikhinweis von der Seite, sonst leer" }
 ]
}
Reihenfolge wie auf der Seite. Nichts weglassen, nichts hinzuerfinden. Unleserliches mit [?] markieren. Steht die deutsche Seite links, trotzdem "wort" = Fremdsprache.`;
}

export function vocabTestProfilePrompt(sprache) {
  return `Das sind ALTE VOKABELTESTS (${sprache}), evtl. mit Korrektur der Lehrkraft. Analysiere sie genau und beschreibe das TESTPROFIL der Lehrkraft, damit Übungstests exakt so aussehen und so streng bewertet werden.
Markdown, knapp und konkret, mit Beispielen aus den Tests:
**Aufbau & Umfang** (Anzahl Wörter, Zeit, Punkte) – **Aufgabentypen** (z. B. Deutsch→${sprache}, ${sprache}→Deutsch, Lückensätze, Sätze bilden, Synonyme/Gegenteile, Definitionen, Verbformen, Zuordnen) mit Anteil – **Bewertung** (zählen Rechtschreibung, Akzente, Artikel, Großschreibung? halbe Punkte?) – **Typische Fehler, die angestrichen wurden** – **Tipps**.`;
}

export function vocabTestPrompt(set, words, profile) {
  return `Erstelle einen PROBE-VOKABELTEST (${set.sprache}) mit ${Math.min(20, Math.max(8, words.length))} Aufgaben aus den Vokabeln unten.
${profile ? `Halte dich EXAKT an das Testprofil der Lehrkraft (Aufgabentypen, Richtungen, Anteile, Strenge):\n${profile}` : `Kein Testprofil vorhanden: mische Deutsch→${set.sprache} (ca. 50 %), ${set.sprache}→Deutsch (ca. 25 %) und Lückensätze (ca. 25 %).`}

Technische Form (die App wertet automatisch aus): Jede Aufgabe ist eine der Arten
- "eingabe": Antwort eintippen. "antworten" = ALLE korrekten Schreibweisen (mit/ohne Artikel, Varianten). Für Lückensätze den Satz mit ___ in "frage".
- "mc": 4 Optionen, "richtig" = Index der richtigen.
- "wahrfalsch": Aussage, "richtig": true/false.
Wörter nur aus der Liste. Formuliere die Fragen wie im Test der Lehrkraft (z. B. "Übersetze: …").

Gib NUR JSON zurück:
{ "fragen": [ { "typ": "eingabe", "frage": "…", "antworten": ["…"], "erklaerung": "kurz, z. B. Merkhilfe oder Grammatik" } ] }

VOKABELN:
${words.map((w) => `- ${w.w} = ${w.t}${w.ex ? ` (Beispiel: ${w.ex})` : ''}`).join('\n')}`;
}
