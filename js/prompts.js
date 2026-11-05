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
  return `Du bist "Kiri", ein Lerncoach, der eine Person gezielt auf eine Klassenarbeit/Klausur vorbereitet.

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

// ---------- 2. Lernplan ----------
export function planPrompt(exam, days) {
  const subject = subjectOf(exam);
  return `Erstelle einen Lernplan für die ${subject.name}-Klausur.
Klausurtermin: ${exam.date ? exam.date : 'kein Termin (freies Lernen)'}.
Zielnote: ${gradeLabel(exam.targetGrade)}.
${days.length ? `Verfügbare Lerntage (jeweils ca. ${state.profile?.minutesPerDay || 30} Min.):\n${days.map((d) => `- ${d.iso} (${d.label})`).join('\n')}` : 'Keine festen Tage: plane 4–8 Einheiten.'}

VORGEHEN
- Bestimme zuerst die klausurrelevanten Themen aus dem Material und dem Lehrerprofil. Gewichte nach Prüfungsrelevanz, nicht nach Seitenzahl.
- Gliedere in Abschnitte (je ein Thema/Kompetenz). Jeder Abschnitt hat 2–4 Einheiten.
- Einheitentypen: "verstehen" (kurzer Input + Verständnisfragen mit Nachfragen), "ueben" (prüfungsnahe Aufgaben AFB I–II), "anwenden" (komplexe Transfer-/Beurteilungsaufgaben AFB II–III), "probeklausur" (komplette Probeklausur im Stil der Lehrkraft).
- Die letzte Einheit vor dem Termin ist IMMER eine "probeklausur". Bei wenig Zeit: weniger verstehen, mehr üben.
- Pro Lerntag so viele Einheiten, wie in die Zeit passen (eine Einheit ≈ 15–25 Min.). Verteile auf die Tage, spätere Tage wiederholen frühere Themen kurz (verteiltes Lernen).
- Zielnote ${gradeLabel(exam.targetGrade)}: je besser die Zielnote, desto mehr AFB III.

Gib NUR JSON zurück:
{
 "titel": "z. B. Spanisch Klausur",
 "themenUebersicht": "2–4 Sätze: was drankommt und worauf es laut Material/Lehrkraft ankommt",
 "luecken": ["Was im Material fehlt oder unklar ist und der Schüler klären sollte"],
 "abschnitte": [
  { "titel": "Thema", "einheiten": [ { "titel": "kurzer Titel", "typ": "verstehen|ueben|anwenden|probeklausur", "ziel": "was danach sicher sitzen muss", "tag": "YYYY-MM-DD oder null" } ] }
 ]
}

KONTEXT:
${examContext(exam)}`;
}

// ---------- 3. Aufgaben für eine Einheit ----------
export function sessionPrompt(exam, unit, previousTitles) {
  const isExam = unit.typ === 'probeklausur';
  const typeRules = {
    verstehen: 'Schreibe zuerst einen KURZEN Input (max. 200 Wörter, nur das Nötigste, auf das Material gestützt). Danach 3 Aufgaben, die echtes Verständnis prüfen (erklären, begründen, Zusammenhänge) – keine reinen Wiedergabefragen.',
    ueben: 'Kein Input. 3–4 prüfungsnahe Aufgaben, AFB I und II, wie sie in der Klausur dieser Lehrkraft vorkommen würden.',
    anwenden: 'Kein Input. 2–3 anspruchsvolle Aufgaben AFB II–III mit eigenem Material (kurzer Text, Daten, Fallbeispiel, Quelle), Transfer und Beurteilung.',
    probeklausur: 'Erstelle eine KOMPLETTE Probeklausur im exakten Stil der alten Klausuren / des Lehrerprofils: gleicher Aufbau, gleiche Operatoren, gleiche Punkteverteilung und realistischer Umfang für die übliche Bearbeitungszeit. Mit eigenem Material, falls die Lehrkraft Material verwendet.',
  }[unit.typ] || '';
  return `Erstelle die Lerneinheit "${unit.titel}" (Typ: ${unit.typ}). Ziel: ${unit.ziel || '-'}.
${typeRules}
${previousTitles.length ? `Bereits gestellte Aufgaben (NICHT wiederholen, aber Schwächen erneut prüfen):\n${previousTitles.slice(-25).map((t) => `- ${t}`).join('\n')}` : ''}

Jede Aufgabe:
- beginnt mit einem Operator und ist so formuliert, wie es in der echten Klausur stünde,
- hat einen Erwartungshorizont (stichpunktartig, was für volle Punkte nötig ist – wird erst nach der Abgabe gezeigt),
- hat eine realistische Punktzahl und Bearbeitungszeit.

Gib NUR JSON zurück:
{
 "input": "Markdown-Text oder leer",
 ${isExam ? '"zeitMinuten": 45,\n ' : ''}"aufgaben": [
  { "id": "a1", "operator": "Erläutere", "afb": "II", "aufgabe": "vollständige Aufgabenstellung", "material": "optional: Text/Daten/Quelle als Markdown, sonst leer", "punkte": 6, "minuten": 8, "erwartung": ["…", "…"] }
 ]
}

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
