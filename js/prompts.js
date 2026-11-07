// Alle Anweisungen an die KI an einer Stelle. Hier wird festgelegt, wie streng, prüfungsnah
// und lehrerspezifisch die KI arbeitet.

import { state } from './store.js';
import { gradeLabel, scaleLabel } from './grades.js';

const MAX_CONTEXT_CHARS = 160000;

export function subjectOf(exam) {
  return state.subjects.find((s) => s.id === exam.subjectId);
}

// ---------- Sprache des Fachs ----------
export const LANG_NAMES = { de: 'Deutsch', en: 'Englisch', es: 'Spanisch', fr: 'Französisch', la: 'Latein' };

// fach: Sprachfach (Englisch/Spanisch/Französisch/Latein als Fach) · teach: Unterrichtssprache
export function langInfo(subject) {
  const n = (subject?.name || '').toLowerCase();
  const fach = subject?.fremdsprache !== undefined ? subject.fremdsprache
    : /spanisch|español|espanol/.test(n) ? 'es' : /franz|français/.test(n) ? 'fr' : /latein|latin/.test(n) ? 'la' : /^(englisch|english)\b/.test(n) ? 'en' : null;
  let teach = subject?.language || 'de';
  if (fach && !subject?.langSet) teach = fach === 'la' ? 'de' : fach; // Latein wird auf Deutsch unterrichtet
  return { fach, teach };
}

function langSystem(subject) {
  const { fach, teach } = langInfo(subject);
  const T = LANG_NAMES[teach];
  if (fach === 'la') return `\nSPRACHFACH LATEIN. Unterrichtssprache: ${T}.
- Aufgaben und Erklärungen auf ${T}; lateinische Texte, Formen und Beispielsätze auf Latein.
- Typisch: Übersetzen Latein → Deutsch, Formen bestimmen, Satzglieder/Konstruktionen (AcI, Partizipien, Ablativus absolutus …) erkennen, Textverständnis und Interpretation.
- Lateinische Formen exakt; jeden Fehler in Form oder Übersetzung zitieren und korrigieren.`;
  if (fach) return `\nSPRACHFACH ${LANG_NAMES[fach].toUpperCase()}. Unterrichtssprache: ${T}.
- Aufgabenstellungen, Materialien und Musterlösungen auf ${T}, so wie die Lehrkraft sie auf Arbeitsblättern und in Klausuren formuliert.${teach !== 'de' ? '\n- Grammatik-Erklärungen und Feedback dürfen auf Deutsch sein, Beispiele und Korrekturen stehen in der Zielsprache.' : ''}
- Bewerte Sprache streng: Jeden Fehler (Grammatik, Wortwahl, Rechtschreibung, Akzente) zitieren und korrigieren.`;
  if (teach !== 'de') return `\nUNTERRICHTSSPRACHE IN DIESEM FACH: ${T.toUpperCase()} (bilingualer Unterricht).
- Aufgaben, Materialien, Musterlösungen und Feedback auf ${T}.
- Bewerte zusätzlich Fachsprache und Grammatik: Jeden Sprachfehler zitieren und korrigieren.
- Schwierige Fachbegriffe darfst du kurz in Klammern auf Deutsch erklären.`;
  return '';
}

// Sprachregel für Lernzettel: Sprachfächer gemischt, bilinguale Fächer in der Unterrichtssprache.
function lernzettelLang(subject) {
  const { fach, teach } = langInfo(subject);
  if (fach) return `Sprache: GEMISCHT. Erklärungen, Regeln und Überschriften auf Deutsch; Beispiele, Mustersätze, Wendungen, Redemittel und Vokabeln auf ${LANG_NAMES[fach]} (mit deutscher Übersetzung). Grammatik-Begriffe so, wie die Lehrkraft sie auf den Arbeitsblättern verwendet.`;
  if (teach !== 'de') return `Sprache: ${LANG_NAMES[teach].toUpperCase()} (bilingualer Unterricht). Wichtige Fachbegriffe beim ersten Auftreten mit deutscher Übersetzung in Klammern.`;
  return 'Sprache: Deutsch.';
}

function taskLang(subject) {
  const { fach, teach } = langInfo(subject);
  if (fach === 'la') return 'Sprache: Aufgabenstellungen auf Deutsch, lateinische Texte und Formen auf Latein.';
  if (teach !== 'de') return `Sprache: Fragen bzw. Aufgabenstellungen auf ${LANG_NAMES[teach]}, so wie die Lehrkraft sie formuliert. Erklärungen dürfen auf Deutsch sein.`;
  return 'Sprache: Deutsch.';
}

// Arbeitsblätter der Lehrkraft zeigen, was ihr wichtig ist. Das Buch liefert zusätzliche Fakten.
const AB_FOCUS = `ORIENTIERUNG AN DER LEHRKRAFT: Die Arbeitsblätter und Hefteinträge zeigen, was die Lehrkraft für wichtig hält. Gewichte die Inhalte danach (Schwerpunkte der Lehrkraft, Aufgaben auf den Blättern) und übernimm ihre Begriffe und Formulierungen. Fakten aus dem Buch gehören trotzdem dazu, wo sie diese Schwerpunkte stützen, ergänzen oder genauer machen. Beziehe dich immer wieder ausdrücklich auf ein bestimmtes Arbeitsblatt (z. B. „wie auf dem AB ‚Zellatmung‘“), aber nicht bei jedem Punkt.`;

export function baseSystem(subject) {
  const p = state.profile || {};
  const harsh = (p.feedbackStyle || 'hart') === 'hart';
  const lang = langSystem(subject);
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
5. Schreib alles so, wie man es mit Stift aufs Papier schreiben würde: KEIN LaTeX (kein $, \\frac, ^{}, \\cdot), KEINE HTML-Tags (<br>, <sub>), KEINE Emojis oder Code-Schreibweisen. Formeln einfach: x², 3/4, 2 · 5, Wurzel aus 9, CO₂. Antworte in Markdown (fett, Listen), knapp und konkret.
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
  const isBook = (id) => /buch/i.test(state.files[id]?.digest?.art || '');
  const ids = exam.materialIds || [];
  const abs = ids.filter((id) => !isBook(id)).map(fileDigestText).filter(Boolean);
  const book = ids.filter(isBook).map(fileDigestText).filter(Boolean);
  if (abs.length) parts.push(`## ARBEITSBLÄTTER & HEFTEINTRÄGE DER LEHRKRAFT (Hauptquelle: Schwerpunkte, Begriffe, Formulierungen)\n${abs.join('\n\n')}`);
  if (book.length) parts.push(`## BUCHSEITEN (Ergänzung: Fakten übernehmen, Gewichtung nach den Arbeitsblättern)\n${book.join('\n\n')}`);
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
 "themen": [ { "titel": "kurzer Thementitel", "beschreibung": "was genau dazugehört (1–2 Sätze)", "schwerpunkte": ["was die Lehrkraft laut Arbeitsblättern und alten Klausuren bei diesem Thema betont"], "tag": "YYYY-MM-DD oder null" } ]
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
  const lang = lernzettelLang(subject);
  return `Schreibe ${scope}

ZIEL: Ein Lernzettel, mit dem man die Klausur bestehen kann, ohne nochmal ins Heft zu schauen – so ausführlich und präzise wie ein sehr guter selbst erstellter Lernzettel einer Oberstufenschülerin. Er ist die Grundlage für das Quiz und die Anwendungsaufgaben.

INHALT:
- Alles Prüfungsrelevante aus dem Material: Definitionen, Fakten, Zahlen/Daten/Jahreszahlen MIT Einheit, Ursachen, Folgen, Mechanismen (mit →), Beispiele/Fallbeispiele aus dem Unterricht, Seitenangaben aus dem Buch, Inhalte aus Filmen/Tracks/Quellen, die im Material vorkommen.
- Erkläre Zusammenhänge, nicht nur Stichworte. Nutze Vergleiche (Spalten/Karten), Tabellen und Kästen dort, wo sie das Lernen erleichtern – mindestens 1 Tabelle, 1 Spalten-Vergleich und 2 Kästen.
- Methodenwissen: Wie geht man an typische Aufgaben heran (z. B. Diagramm beschreiben → erklären → bewerten)?
- Typische Klausurfallen in [!WARN], Klausurtipps der Lehrkraft in [!TIP].
- Nur was im Material steht oder sicheres Standardwissen dieser Klassenstufe ist. Nichts erfinden; Unklares weglassen.
- ${AB_FOCUS} Gliedere, wo es passt, nach dem Aufbau der Arbeitsblätter.
- ${lang}
- Kein Vorwort, kein Schlusswort, keine Überschrift für das ganze Dokument (die setzt die App).

${LZ_FORMAT}

KONTEXT:
${examContext(exam)}`;
}

// ---------- 3b. Fakten-Quiz ----------
export function quizPrompt(exam, topic, lernzettel, previous) {
  return `Erstelle ein kurzes Quiz (8 Fragen) zum Thema "${topic.titel}"${topic.schwerpunkte?.length ? ` (Schwerpunkte: ${topic.schwerpunkte.join(', ')})` : ''}.
Es prüft, ob die SCHWERPUNKTE DER LEHRKRAFT sitzen: zentrale Begriffe und was sie bedeuten, Zusammenhänge (Ursache → Folge), Abläufe, Unterschiede, Zuordnungen und typische Denkfehler. Die Fragen sind eher allgemein und verständnisorientiert, kein Abfragen von Einzelfakten.
- Höchstens 2 Fragen zu einer einzelnen Zahl, einem Datum oder Detail, und nur wenn die Lehrkraft genau das erkennbar betont.
- Richte die Auswahl nach den Schwerpunkten und Aufgaben auf den Arbeitsblättern. Nutze die Begriffe so, wie sie auf den Blättern stehen. Etwa 2 Fragen beziehen sich ausdrücklich auf ein Arbeitsblatt. Fakten aus dem Buch sind erlaubt, wenn sie zu diesen Schwerpunkten gehören.
- ${taskLang(subjectOf(exam))}
Mische die Fragetypen: ca. 4× "mc" (4 Optionen, plausible Falschantworten), 2× "wahrfalsch", 2× "eingabe" (Antwort ist ein Begriff oder kurzer Ausdruck).
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
- ${AB_FOCUS} Mindestens eine Aufgabe knüpft direkt an ein Arbeitsblatt an (greift dessen Material, Beispiel oder Aufgabentyp auf, ohne es zu kopieren).
- ${taskLang(subjectOf(exam))}
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

// ---------- 8. Arbeitsblatt lösen ----------
export function solvePrompt(subject, note) {
  const { fach, teach } = langInfo(subject);
  const lang = fach
    ? `Sprache: Antworten in der Sprache, die die Aufgabe verlangt (${LANG_NAMES[fach]} bzw. bei Übersetzungen Deutsch). Erklärungen zu Grammatik und Fehlern auf Deutsch.`
    : teach !== 'de'
      ? `Sprache der Lösungen: ${LANG_NAMES[teach].toUpperCase()} (bilingualer Unterricht); wichtige Fachbegriffe beim ersten Mal mit deutscher Übersetzung in Klammern. Überschriften "Aufgabe" dürfen deutsch bleiben.`
      : 'Sprache: Deutsch (bei Fremdsprachen-Aufgaben in der Zielsprache antworten).';
  return `Das ist ein ARBEITSBLATT (eingescannt, evtl. mehrere Seiten). Lies es vollständig und genau – auch Texte, Tabellen, Diagramme, Karten und Materialien – und LÖSE ALLE AUFGABEN.
Ziel: Der Schüler lernt an deinen Lösungen. Sie müssen fachlich korrekt, vollständig und auf dem Niveau einer sehr guten Klassenarbeit sein – so, wie die Lehrkraft sie im Erwartungshorizont hätte.
${note ? `Hinweis des Schülers: ${note}\n` : ''}
REGELN
- Halte dich an den Operator (nenne/beschreibe/erkläre/analysiere/beurteile …): Umfang und Tiefe passend dazu.
- Nutze die Materialien vom Blatt und zitiere sie (z. B. "M2, Z. 5"). Rechnungen vollständig mit Einheiten.
- Hat der Schüler schon etwas eingetragen, prüfe es: richtig bestätigen, falsch klar benennen und korrigieren.
- Schreib wie mit Stift auf Papier: kein LaTeX, keine HTML-Tags, keine Code-Schreibweisen.
- Wenn etwas unleserlich ist oder Material fehlt (z. B. ein Text nur auf einer anderen Seite), sag es ausdrücklich, statt zu raten.
- ${lang}

FORMAT (genau so, die App klappt jede Aufgabe einzeln auf):
## Aufgabe 1 a) – kurze Wiedergabe der Aufgabenstellung
### Lösung
(die Musterlösung, wie man sie abgeben würde)
### So kommst du drauf
(Schritte/Begründung, kurz)
> [!WARN] Häufiger Fehler
> …
(optional; außerdem erlaubt: > [!TIP], > [!KEY], Tabellen mit | … |, Listen)

Nummeriere wie auf dem Blatt. Keine Einleitung, kein Schlusswort.`;
}

export function solveChatSystem(subject, solved) {
  return `${baseSystem(subject)}

Du hilfst beim Verstehen eines gelösten Arbeitsblatts. Beantworte Rückfragen präzise und kurz, erkläre Schritte, gib Beispiele. Wenn der Schüler etwas Falsches sagt, korrigiere direkt.

DEINE LÖSUNGEN ZUM BLATT:
${solved.loesung}`;
}

export function annotatePrompt(loesung) {
  return `Du siehst EINE Seite eines Arbeitsblatts/Arbeitshefts (Foto, evtl. schräg oder gebogen). Trage die Lösungen DIREKT AUF DEM BLATT ein – so, wie ein Schüler mit Stift: in die Lücke, auf die Schreiblinie unter der Aufgabe, Kreuz ins Kästchen, Markierung auf die Textstelle.

Gib für JEDE Stelle auf DIESER Seite, an der etwas eingetragen, angekreuzt, markiert oder eingekreist werden muss, einen Eintrag mit genauer Position zurück.
Position "box": [ymin, xmin, ymax, xmax] als ganze Zahlen von 0 bis 1000, relativ zur Bildhöhe/-breite (0,0 = oben links).

Arten ("art"):
- "text": Antwort hinschreiben. box = genau die freie Lücke oder die erste freie Schreiblinie, auf der die Antwort stehen soll (nicht die Aufgabenstellung!). "text" = die Antwort so kurz, wie man sie dort hinschreiben würde. Mehrere Linien: eine box über die freien Linien.
- "kreuz": Kästchen ankreuzen. box = das Kästchen.
- "markieren": Wort/Textstelle markieren oder unterstreichen. box = die Textstelle.
- "kreis": etwas einkreisen. box = das Einzukreisende.
- "pruefen": Der Schüler hat hier SCHON etwas hingeschrieben. box = seine Antwort, "ok" = true/false, "text" = bei falsch die richtige Lösung (kurz), bei richtig leer.

Regeln: nur Aufgaben auf DIESER Seite; fachlich korrekt (nutze die Lösungen unten); nur normale Schrift-Zeichen, kein LaTeX, keine HTML-Tags.

Gib NUR JSON zurück:
{ "eintraege": [ { "aufgabe": "1a", "art": "text", "text": "…", "box": [400, 120, 430, 900] } ] }

LÖSUNGEN ZUM BLATT:
${loesung}`;
}
