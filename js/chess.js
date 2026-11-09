// Warte-Schach: gegen Bots (400–2000 Elo) spielen, während Jelly arbeitet.
// Bedienung: Figur ziehen oder antippen und Zielfeld antippen. Die laufende Partie bleibt auf dem Gerät gespeichert,
// die eigene Elo-Wertung (state.chess) gehört zum Konto und wird mitsynchronisiert.

import { h, icon, confirmDialog } from './ui.js';
import { state, save } from './store.js';
import { START, parseFEN, toFEN, legalMoves, makeMove, moveKey, posKey, gameResult, inCheck, colorOf, bestMove } from './chess-engine.js';

// ---------------------------------------------------------------- Bots
const BOTS = [
  { elo: 400, name: 'Pip', look: { skin: '#f6c9a8', hair: '#e8742c', style: 'spiky', shirt: '#f59e0b', bg: '#3a2c22', freckles: true },
    greet: 'Hi, ich bin Pip! Ich hab Schach erst letzte Woche gelernt.', idle: ['Wie zieht nochmal der Springer?', 'Ich mag die Pferdchen!', 'Ups, war das gut?'] },
  { elo: 600, name: 'Lotte', look: { skin: '#f3d2b8', hair: '#2b2230', style: 'long', shirt: '#60a5fa', bg: '#1f2a3a' },
    greet: 'Hallo, ich bin Lotte! Lass uns locker spielen.', idle: ['Ich spiele am liebsten mit der Dame.', 'Hmm, wohin damit …', 'Das sieht spannend aus!'] },
  { elo: 800, name: 'Bruno', look: { skin: '#eab48c', hair: '#5a3825', style: 'short', beard: true, shirt: '#c2410c', bg: '#3a241c' },
    greet: 'Servus, ich bin Bruno. Mal sehen, was du drauf hast!', idle: ['Ganz ruhig, Bruno …', 'Ich greif gleich an!', 'Gemütliche Partie, oder?'] },
  { elo: 1000, name: 'Ida', look: { skin: '#f7d6c1', hair: '#b4472b', style: 'bun', glasses: true, shirt: '#a16207', bg: '#33291c' },
    greet: 'Hi, ich bin Ida. Ich lese gerade mein erstes Schachbuch!', idle: ['Laut Buch sollte ich jetzt entwickeln.', 'Mitte kontrollieren!', 'Interessanter Zug.'] },
  { elo: 1200, name: 'Kemal', look: { skin: '#c98e62', hair: '#17141a', style: 'curly', shirt: '#0d9488', bg: '#16302d' },
    greet: 'Hey, ich bin Kemal. Ich spiele jeden Tag im Park.', idle: ['Im Park hätte ich das anders gemacht.', 'Nicht schlecht!', 'Ich hab da so eine Idee …'] },
  { elo: 1400, name: 'Greta', look: { skin: '#f2cdb0', hair: '#7c3aed', style: 'bob', shirt: '#4c1d95', bg: '#261a3a' },
    greet: 'Ich bin Greta. Im Verein nennen sie mich die Turm-Königin.', idle: ['Türme gehören auf offene Linien.', 'Das hab ich kommen sehen.', 'Jetzt wird es taktisch!'] },
  { elo: 1600, name: 'Sven', look: { skin: '#f0c7a4', hair: '#e4c160', style: 'cap', cap: '#2563eb', shirt: '#475569', bg: '#1c2433' },
    greet: 'Moin, Sven hier. Ich spiele Blitz, also nicht trödeln!', idle: ['Tick, tack …', 'Solide.', 'Da steckt mehr drin, als du denkst.'] },
  { elo: 1800, name: 'Amara', look: { skin: '#8d5a3b', hair: '#1d1517', style: 'afro', glasses: true, shirt: '#db2777', bg: '#3a1a2a' },
    greet: 'Hallo, ich bin Amara. Ich trainiere für die Landesmeisterschaft.', idle: ['Das erinnert mich an eine Partie von gestern.', 'Prophylaxe ist alles.', 'Hmm, kluger Zug.'] },
  { elo: 2000, name: 'Konrad', look: { skin: '#ebc1a0', hair: '#c9c9cf', style: 'bald', beard: true, glasses: true, shirt: '#1e3a5f', bg: '#1a2230' },
    greet: 'Guten Tag, Konrad mein Name. Vierzig Jahre Vereinsschach – zeig mir, was du kannst.', idle: ['Das habe ich 1987 schon mal gesehen.', 'Ein Zug mit Hintergedanken.', 'Geduld gewinnt Partien.'] },
];

const LINES = {
  start: ['Viel Glück!', 'Los geht’s!', 'Auf ein gutes Spiel!'],
  botCapture: ['Danke für die Figur!', 'Die nehme ich gern.', 'Hoppla, die stand ungedeckt.', 'Lecker!'],
  playerCapture: ['Autsch!', 'Oh nein, die hab ich übersehen.', 'Gut gesehen!', 'Hmm, das tat weh.'],
  check: ['Schach!', 'Pass auf deinen König auf!', 'Schach – und jetzt?'],
  inCheck: ['Uff, Schach …', 'Mein König muss weg!', 'Gemein!'],
  botWin: ['Schachmatt! Gutes Spiel!', 'Diesmal hab ich gewonnen. Revanche?'],
  playerWin: ['Wow, du hast gewonnen! Glückwunsch!', 'Schachmatt … gut gespielt!'],
  draw: ['Remis – gerechtes Ergebnis!', 'Unentschieden. Spannend war’s!'],
  hint: ['Psst … schau mal da.', 'Ein kleiner Tipp von mir.'],
  undo: ['Na gut, noch mal.', 'Okay, Zug zurück.'],
  resign: ['Schon aufgeben? Nächstes Mal klappt’s!'],
};
const pickLine = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Gezeichnete Comic-Gesichter (keine Fotos, keine fremden Figuren)
export function avatarSVG(look) {
  const { skin, hair, style, shirt, bg } = look;
  const back = {
    long: `<path d="M26 50C23 30 34 19 50 19S77 30 74 50L78 84H22Z" fill="${hair}"/>`,
    bob: `<path d="M27 52C24 30 35 19 50 19S76 30 73 52L74 66H26Z" fill="${hair}"/>`,
    afro: `<circle cx="50" cy="38" r="30" fill="${hair}"/>`,
    bun: `<circle cx="50" cy="17" r="10" fill="${hair}"/>`,
  }[style] || '';
  const front = {
    spiky: `<path d="M28 46L29 27L36 31L38 18L45 26L50 13L55 25L62 17L64 29L71 26L72 46C66 35 57 31 50 32C42 32 33 36 28 46Z" fill="${hair}"/>`,
    short: `<path d="M29 45C27 27 39 20 51 21C64 21 74 29 71 45C66 36 58 31 50 32C42 32 34 37 29 45Z" fill="${hair}"/>`,
    long: `<path d="M29 46C29 29 41 22 52 23C63 24 71 31 71 46C63 37 53 30 44 34C38 37 33 41 29 46Z" fill="${hair}"/>`,
    bob: `<path d="M29 46C29 29 41 22 52 23C63 24 71 31 71 46C66 40 60 34 50 34C40 34 33 40 29 46Z" fill="${hair}"/>`,
    bun: `<path d="M29 45C28 29 40 23 51 23C63 23 72 30 71 45C66 36 58 32 50 33C42 33 34 37 29 45Z" fill="${hair}"/>`,
    curly: [[31, 40], [35, 30], [43, 24], [52, 22], [61, 25], [67, 32], [70, 41]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="8" fill="${hair}"/>`).join(''),
    afro: '',
    bald: `<path d="M28 50C27 42 29 37 33 34L34 50Z M72 50C73 42 71 37 67 34L66 50Z" fill="${hair}"/>`,
    cap: `<path d="M28 42C28 25 39 18 50 18C62 18 72 25 72 42Z" fill="${look.cap}"/><path d="M50 37L86 40C84 45 70 45 50 43Z" fill="${look.cap}"/><path d="M29 44L33 50L33 42Z M71 44L67 50L67 42Z" fill="${hair}"/>`,
  }[style] || '';
  const beard = look.beard ? `<path d="M30 52C31 66 39 75 50 75C61 75 69 66 70 52C66 60 60 63 50 63C40 63 34 60 30 52Z" fill="${hair}"/>` : '';
  const glasses = look.glasses ? `<g fill="none" stroke="#1f1b24" stroke-width="2"><circle cx="42" cy="49" r="6"/><circle cx="58" cy="49" r="6"/><path d="M48 49H52"/></g>` : '';
  const freckles = look.freckles ? '<g fill="#c46a3c" opacity=".6"><circle cx="38" cy="56" r="1"/><circle cx="41" cy="58" r="1"/><circle cx="62" cy="56" r="1"/><circle cx="59" cy="58" r="1"/></g>' : '';
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" rx="18" fill="${bg}"/>
${back}<path d="M14 100C16 81 30 73 50 73S84 81 86 100Z" fill="${shirt}"/><rect x="43" y="62" width="14" height="14" rx="5" fill="${skin}"/><path d="M43 70Q50 75 57 70" stroke="rgba(0,0,0,.15)" stroke-width="3" fill="none"/>
<circle cx="29" cy="51" r="5" fill="${skin}"/><circle cx="71" cy="51" r="5" fill="${skin}"/><ellipse cx="50" cy="48" rx="21" ry="24" fill="${skin}"/>
${front}<path d="M37 42Q42 39 46 42M54 42Q58 39 63 42" stroke="#2a2125" stroke-width="2" fill="none" stroke-linecap="round"/>
<circle cx="42" cy="49" r="2.6" fill="#1f1b24"/><circle cx="58" cy="49" r="2.6" fill="#1f1b24"/><circle cx="42.8" cy="48.2" r=".8" fill="#fff"/><circle cx="58.8" cy="48.2" r=".8" fill="#fff"/>
<path d="M50 52Q47.5 57.5 51 58" stroke="rgba(0,0,0,.25)" stroke-width="1.6" fill="none" stroke-linecap="round"/>
<circle cx="36" cy="58" r="3.5" fill="#ff7a7a" opacity=".22"/><circle cx="64" cy="58" r="3.5" fill="#ff7a7a" opacity=".22"/>${freckles}${beard}
<path d="M42 62Q50 70 58 62Z" fill="#8a2f3a"/><path d="M43.5 62.4H56.5L55.5 63.8H44.5Z" fill="#fff"/>${glasses}</svg>`;
}

// Figuren (eigene, flache Zeichnung)
const SHAPES = {
  p: '<circle cx="50" cy="30" r="12"/><path d="M39 47Q50 38 61 47L57 51Q59 66 67 75H33Q41 66 43 51Z"/><rect x="25" y="74" width="50" height="12" rx="5"/>',
  r: '<rect x="23" y="75" width="54" height="12" rx="4"/><path d="M33 75L36 45H64L67 75Z"/><path d="M28 45V22H38V30H45V22H55V30H62V22H72V45Z"/>',
  n: '<rect x="24" y="76" width="54" height="11" rx="4"/><path d="M36 76C36 64 44 58 49 51C41 54 33 58 27 56C22 54 22 47 27 43C35 36 41 28 44 20L46 11L53 20C66 22 76 34 75 52C75 64 71 71 71 76Z"/><circle class="x" cx="43" cy="32" r="3"/>',
  b: '<rect x="24" y="77" width="52" height="11" rx="4"/><path d="M34 77Q38 63 41 57H59Q62 63 66 77Z"/><rect x="35" y="50" width="30" height="8" rx="3"/><path d="M50 15C34 27 32 40 38 50H62C68 40 66 27 50 15Z"/><circle cx="50" cy="12" r="5"/><path class="xs" d="M55 25L46 37"/>',
  q: '<rect x="22" y="77" width="56" height="11" rx="4"/><path d="M30 77L21 37L36 55L37 29L50 51L63 29L64 55L79 37L70 77Z"/><circle cx="21" cy="33" r="5"/><circle cx="37" cy="25" r="5"/><circle cx="50" cy="45" r="0"/><circle cx="63" cy="25" r="5"/><circle cx="79" cy="33" r="5"/><circle cx="50" cy="22" r="5"/><path d="M44 50L50 26L56 50Z"/>',
  k: '<rect x="22" y="77" width="56" height="11" rx="4"/><path d="M30 77C23 63 19 51 28 45C36 39 46 45 50 53C54 45 64 39 72 45C81 51 77 63 70 77Z"/><path d="M41 52C40 42 60 42 59 52Z"/><rect x="46" y="12" width="8" height="30" rx="2"/><rect x="38" y="19" width="24" height="8" rx="2"/>',
};
export function pieceSVG(p) {
  const w = colorOf(p) === 'w';
  const fill = w ? '#fbfaf7' : '#3b3734', line = w ? '#4a4540' : '#1b1917', inner = w ? '#4a4540' : '#d9d4ce';
  return `<svg viewBox="8 6 84 84" xmlns="http://www.w3.org/2000/svg"><g fill="${fill}" stroke="${line}" stroke-width="3.2" stroke-linejoin="round">${SHAPES[p.toLowerCase()]
    .replace('class="x"', `fill="${inner}" stroke="none"`).replace('class="xs"', `fill="none" stroke="${inner}" stroke-width="3" stroke-linecap="round"`)}</g></svg>`;
}

// ---------------------------------------------------------------- Zustand (nur lokal)
const KEY = 'lernki-chess';
const PV = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const CAP_ORDER = 'pnbrq';
const DEF = { view: 'pick', bot: 2, color: 'w', side: 'w', moves: [], over: null, say: '' };
let S = (() => { try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && Array.isArray(s.moves)) return { ...DEF, ...s }; } catch {} return { ...DEF }; })();
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };

function game() {
  let pos = parseFEN(START);
  const hist = [posKey(pos)];
  let last = null;
  const caps = { w: [], b: [] }; // geschlagen VON Weiß / Schwarz
  for (const u of S.moves) {
    const m = legalMoves(pos).find((x) => moveKey(x) === u);
    if (!m) break;
    if (m.cap) caps[colorOf(m.p)].push(m.cap.toLowerCase());
    pos = makeMove(pos, m); hist.push(posKey(pos)); last = m;
  }
  let mat = 0; // Materialvorsprung von Weiß (Bauer 1, Läufer/Springer 3, Turm 5, Dame 9)
  for (const p of pos.b) if (p) mat += (PV[p.toLowerCase()] || 0) * (colorOf(p) === 'w' ? 1 : -1);
  return { pos, hist, last, caps, mat };
}

// ---------------------------------------------------------------- Engine (im Worker, sonst direkt)
let worker = null, workerBroken = false;
const waiting = new Map();
let reqSeq = 0;
function ask(fen, elo, history) {
  if (!worker && !workerBroken) {
    try {
      worker = new Worker(new URL('./chess-engine.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => { const r = waiting.get(e.data.id); if (r) { waiting.delete(e.data.id); r(e.data); } };
      worker.onerror = () => { workerBroken = true; worker = null; for (const [id, r] of waiting) { waiting.delete(id); r(null); } };
    } catch { workerBroken = true; }
  }
  const direct = () => new Promise((res) => setTimeout(() => res(bestMove(fen, { elo, history })), 30));
  if (!worker) return direct();
  const id = ++reqSeq;
  return new Promise((res) => { waiting.set(id, res); worker.postMessage({ id, fen, elo, history }); })
    .then((r) => (r && r.move !== undefined && !r.error ? r : direct()));
}

// ---------------------------------------------------------------- Oberfläche
let root = null;
let boardEl = null, bubbleEl = null, statusEl = null;
let sel = null, hint = null, promo = null, drag = null;
let thinking = false, botTurnId = 0, menuOpen = false;
let acts = {};
let capsBotEl = null, capsMeEl = null, meEloEl = null, meDeltaEl = null, eloAnim = false;
// Spielende: 'big' (große Schilder) → 'small' (kleine Abzeichen) → 'done' (Ergebnisfenster)
let endPhase = 'done', endClosed = false, endTimers = [];

const bot = () => BOTS[S.bot] || BOTS[0];

// Liefert immer dasselbe Element, damit die Partie beim Neuzeichnen der Seite weiterläuft.
export function chessPanel() {
  if (!root) root = h('div', { class: 'ch' });
  draw();
  return root;
}

function draw() {
  root.replaceChildren(S.view === 'game' ? gameView() : pickView());
  if (S.view === 'game' && !S.over && !thinking && game().pos.turn !== S.side) botMove();
}

function say(text) {
  S.say = text; persist();
  if (bubbleEl) { bubbleEl.textContent = text; bubbleEl.classList.remove('pop'); void bubbleEl.offsetWidth; bubbleEl.classList.add('pop'); }
}

function face(b, size) {
  return h('div', { class: 'ch-face', style: { width: `${size}px`, height: `${size}px` }, html: avatarSVG(b.look) });
}

function botHead(b, text) {
  bubbleEl = h('div', { class: 'ch-bubble' }, text);
  return h('div', { class: 'ch-head' }, face(b, 72), bubbleEl);
}

// ----- Bot auswählen
function pickView() {
  const b = bot();
  const preview = h('div', { class: 'ch-board ch-static' });
  boardEl = preview;
  drawBoard({ pos: parseFEN(START), last: null }, null, S.color === 'b');
  boardEl = null;
  const colorBtn = (c, content, label) => h('button', { class: `ch-color${S.color === c ? ' on' : ''}`, 'aria-label': label, onclick: () => { S.color = c; persist(); draw(); } }, content);
  return h('div', { class: 'ch-layout ch-pick' },
    h('div', { class: 'ch-boardcol' }, preview),
    h('div', { class: 'ch-side' },
      botHead(b, b.greet),
      h('div', { class: 'ch-name' }, b.name, h('span', { class: 'ch-elo' }, ` ${b.elo}`)),
      h('div', { class: 'ch-bots' }, BOTS.map((x, i) => h('button', { class: `ch-bot${i === S.bot ? ' on' : ''}`, 'aria-label': `${x.name}, ${x.elo} Elo`, onclick: () => { S.bot = i; persist(); draw(); } },
        face(x, 52), h('span', {}, String(x.elo))))),
      h('div', { class: 'ch-row' },
        colorBtn('w', h('span', { class: 'ch-mini', html: pieceSVG('K') }), 'Mit Weiß spielen'),
        colorBtn('r', h('span', { class: 'ch-q' }, '?'), 'Zufällige Farbe'),
        colorBtn('b', h('span', { class: 'ch-mini', html: pieceSVG('k') }), 'Mit Schwarz spielen')),
      h('div', { class: 'ch-myrating' }, 'Deine Elo: ', h('strong', {}, String(rating().elo)), rating().games ? h('span', { class: 'muted' }, ` · ${rating().wins} S / ${rating().draws} R / ${rating().losses} N`) : null),
      h('button', { class: 'btn primary block ch-play', onclick: startGame }, 'Spielen')));
}

function startGame() {
  S.side = S.color === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : S.color;
  S.moves = []; S.over = null; S.rated = false; S.view = 'game';
  resetEnd();
  sel = hint = promo = null; thinking = false; botTurnId++;
  S.say = `${pickLine(LINES.start)} Du spielst ${S.side === 'w' ? 'Weiß' : 'Schwarz'}.`;
  persist(); draw();
}

// ----- Partie
function gameView() {
  const b = bot();
  boardEl = h('div', { class: 'ch-board' });
  attachInput(boardEl);
  drawBoard(game());
  statusEl = h('div', { class: 'ch-status' });
  const menu = menuOpen ? h('div', { class: 'ch-menu' },
    h('button', { onclick: () => { menuOpen = false; startGame(); } }, icon('refresh', 18), 'Neues Spiel'),
    h('button', { onclick: () => { menuOpen = false; botTurnId++; thinking = false; S.view = 'pick'; persist(); draw(); } }, icon('user', 18), 'Anderen Bot wählen')) : null;
  const btn = (key, ic, label, fn) => (acts[key] = h('button', { class: 'ch-act', onclick: fn }, icon(ic, 22), h('span', {}, label)));
  queueMicrotask(setStatus);
  return h('div', { class: 'ch-layout ch-game' },
    h('div', { class: 'ch-boardcol' }, boardEl),
    h('div', { class: 'ch-side' },
      botHead(b, S.say || b.greet),
      h('div', { class: 'ch-name' }, b.name, h('span', { class: 'ch-elo' }, ` ${b.elo}`)),
      (capsBotEl = h('div', { class: 'ch-caps bot' })),
      statusEl,
      h('div', { class: 'ch-spacer' }),
      menu,
      meCard(),
      h('div', { class: 'ch-actions' },
        btn('menu', 'list', 'Optionen', () => { menuOpen = !menuOpen; draw(); }),
        btn('resign', 'flag', 'Aufgeben', resign),
        btn('hint', 'bulb', 'Hinweis', showHint),
        btn('undo', 'undo', 'Rückgängig', undoMove))));
}

function setStatus() {
  if (capsBotEl) {
    const g = game();
    const botSide = S.side === 'w' ? 'b' : 'w';
    fillCaps(capsBotEl, g, botSide);
    fillCaps(capsMeEl, g, S.side);
  }
  if (acts.resign) {
    acts.resign.disabled = !!S.over;
    acts.hint.disabled = !!S.over || thinking || game().pos.turn !== S.side;
    acts.undo.disabled = !S.moves.some((_, i) => (i % 2 === 0 ? 'w' : 'b') === S.side);
  }
  if (!statusEl) return;
  if (S.over) {
    const txt = S.over.winner === S.side ? 'Du hast gewonnen' : S.over.winner ? `${bot().name} hat gewonnen` : 'Remis';
    const why = { matt: 'Schachmatt', patt: 'Patt', 50: '50-Züge-Regel', material: 'zu wenig Material', wiederholung: 'Stellungswiederholung', aufgabe: 'Aufgabe' }[S.over.why] || '';
    statusEl.replaceChildren(h('strong', {}, txt), why ? ` · ${why}` : '');
  } else statusEl.replaceChildren(thinking ? h('span', { class: 'ch-dots' }, `${bot().name} denkt nach`) : game().pos.turn === S.side ? 'Du bist am Zug' : '');
}

function drawBoard(g, anim = null, flipOverride) {
  const flip = flipOverride ?? S.side === 'b';
  const disp = (sq) => (flip ? 63 - sq : sq);
  const legal = sel != null ? legalMoves(g.pos).filter((m) => m.from === sel) : [];
  const kingSq = g.pos && inCheck(g.pos) ? g.pos.b.indexOf(g.pos.turn === 'w' ? 'K' : 'k') : -1;
  const kids = [];
  for (let d = 0; d < 64; d++) {
    const sq = disp(d), r = d >> 3, c = d & 7;
    const light = ((sq >> 3) + (sq & 7)) % 2 === 0;
    const cls = ['ch-sq', light ? 'l' : 'd'];
    if (g.last && (sq === g.last.from || sq === g.last.to)) cls.push('last');
    if (sq === sel) cls.push('sel');
    if (hint && (sq === hint.from || sq === hint.to)) cls.push('hint');
    if (sq === kingSq) cls.push('check');
    if (S.over?.winner && !boardEl?.classList.contains('ch-static') && g.pos.b[sq]?.toLowerCase() === 'k') cls.push(colorOf(g.pos.b[sq]) === S.over.winner ? 'won' : 'lost');
    const el = h('div', { class: cls.join(' '), 'data-sq': sq, style: { left: `${c * 12.5}%`, top: `${r * 12.5}%` } });
    const lm = legal.find((m) => m.to === sq);
    if (lm) el.append(h('i', { class: lm.cap ? 'ring' : 'dot' }));
    if (c === 0) el.append(h('span', { class: 'ch-rank' }, String(8 - (sq >> 3))));
    if (r === 7) el.append(h('span', { class: 'ch-file' }, 'abcdefgh'[sq & 7]));
    kids.push(el);
  }
  for (let sq = 0; sq < 64; sq++) {
    const p = g.pos.b[sq];
    if (!p) continue;
    const d = disp(sq);
    kids.push(h('div', { class: 'ch-pc', 'data-pc': sq, html: pieceSVG(p), style: { left: `${(d & 7) * 12.5}%`, top: `${(d >> 3) * 12.5}%` } }));
  }
  if (promo) {
    const d = disp(promo.to), c = d & 7, top = d >> 3 === 0;
    const pieces = ['q', 'n', 'r', 'b'].map((t) => (S.side === 'w' ? t.toUpperCase() : t));
    kids.push(h('div', { class: 'ch-promo', style: { left: `${c * 12.5}%`, [top ? 'top' : 'bottom']: '0' } },
      ...(top ? pieces : pieces.reverse()).map((p) => h('button', { html: pieceSVG(p), onpointerdown: (e) => { e.stopPropagation(); }, onclick: () => finishPromo(p.toLowerCase()) })),
      h('button', { class: 'ch-promo-x', onpointerdown: (e) => e.stopPropagation(), onclick: () => { promo = null; drawBoard(game()); } }, '×')));
  }
  if (S.over && boardEl && !boardEl.classList.contains('ch-static')) {
    kids.push(...endBadges(g, disp));
    if (endPhase === 'done' && !endClosed) kids.push(endDialog());
  }
  boardEl.replaceChildren(...kids);
  if (anim) {
    const slide = (from, to) => {
      const pe = boardEl.querySelector(`.ch-pc[data-pc="${to}"]`);
      if (!pe) return;
      const a = disp(from), b = disp(to);
      pe.style.transition = 'none';
      pe.style.transform = `translate(${((a & 7) - (b & 7)) * 100}%, ${((a >> 3) - (b >> 3)) * 100}%)`;
      void pe.offsetWidth;
      pe.style.transition = 'transform .2s ease';
      pe.style.transform = '';
    };
    slide(anim.from, anim.to);
    if (anim.flag === 'castle') { const rk = { 62: [63, 61], 58: [56, 59], 6: [7, 5], 2: [0, 3] }[anim.to]; slide(rk[0], rk[1]); }
  }
  setStatus();
}

function canMove() {
  return S.view === 'game' && !S.over && !thinking && !promo && game().pos.turn === S.side;
}

function attachInput(el) {
  const sqAt = (e) => {
    const r = el.getBoundingClientRect();
    const c = Math.floor(((e.clientX - r.left) / r.width) * 8), rr = Math.floor(((e.clientY - r.top) / r.height) * 8);
    if (c < 0 || c > 7 || rr < 0 || rr > 7) return -1;
    const d = rr * 8 + c;
    return S.side === 'b' ? 63 - d : d;
  };
  el.addEventListener('pointerdown', (e) => {
    if (!canMove() || (e.button && e.button !== 0)) return;
    const sq = sqAt(e);
    if (sq < 0) return;
    const g = game();
    if (sel != null && sel !== sq && legalMoves(g.pos).some((m) => m.from === sel && m.to === sq)) { e.preventDefault(); tryMove(sel, sq, true); return; }
    const p = g.pos.b[sq];
    if (p && colorOf(p) === S.side) {
      e.preventDefault();
      const wasSel = sel === sq;
      sel = sq; hint = null;
      drawBoard(g);
      const pe = el.querySelector(`.ch-pc[data-pc="${sq}"]`);
      drag = { sq, pe, wasSel, moved: false, x0: e.clientX, y0: e.clientY };
      try { el.setPointerCapture(e.pointerId); } catch {}
      return;
    }
    if (sel != null) { sel = null; drawBoard(g); }
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
    drag.moved = true;
    const r = el.getBoundingClientRect(), size = r.width / 8;
    drag.pe.classList.add('drag');
    drag.pe.style.left = `${e.clientX - r.left - size / 2}px`;
    drag.pe.style.top = `${e.clientY - r.top - size / 2}px`;
    const over = sqAt(e);
    el.querySelectorAll('.ch-sq.hover').forEach((x) => x.classList.remove('hover'));
    if (over >= 0) el.querySelector(`.ch-sq[data-sq="${over}"]`)?.classList.add('hover');
  });
  const up = (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    const sq = e.type === 'pointercancel' ? -1 : sqAt(e);
    if (d.moved && sq >= 0 && sq !== d.sq && legalMoves(game().pos).some((m) => m.from === d.sq && m.to === sq)) { tryMove(d.sq, sq, false); return; }
    if (!d.moved && d.wasSel) sel = null;
    drawBoard(game());
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

function tryMove(from, to, animate) {
  const ms = legalMoves(game().pos).filter((m) => m.from === from && m.to === to);
  if (!ms.length) return;
  if (ms[0].promo) { promo = { from, to }; sel = null; drawBoard(game()); return; }
  play(ms[0], animate);
}

function finishPromo(t) {
  if (!promo) return;
  const m = legalMoves(game().pos).find((x) => x.from === promo.from && x.to === promo.to && x.promo === t);
  promo = null;
  if (m) play(m, false);
}

function play(m, animate) {
  S.moves.push(moveKey(m));
  sel = null; hint = null;
  persist();
  after(m, animate, 'player');
}

function after(m, animate, who) {
  const g = game();
  drawBoard(g, animate ? m : null);
  const res = gameResult(g.pos, g.hist);
  if (res.over) {
    S.over = res; rate(); persist();
    say(pickLine(res.winner === S.side ? LINES.playerWin : res.winner ? LINES.botWin : LINES.draw));
    endTimers.push(setTimeout(playEnd, animate ? 260 : 0)); // erst den letzten Zug zu Ende gleiten lassen
    return;
  }
  if (who === 'player') {
    if (inCheck(g.pos)) say(pickLine(LINES.inCheck));
    else if (m.cap && Math.random() < 0.6) say(pickLine(LINES.playerCapture));
    botMove();
  } else {
    if (inCheck(g.pos)) say(pickLine(LINES.check));
    else if (m.cap && Math.random() < 0.5) say(pickLine(LINES.botCapture));
    else if (Math.random() < 0.18) say(pickLine([...bot().idle, ...bot().idle]));
  }
}

function botMove() {
  const g = game();
  const id = ++botTurnId;
  thinking = true; setStatus();
  const t0 = Date.now();
  ask(toFEN(g.pos), bot().elo, g.hist).then((r) => {
    const delay = Math.max(0, 450 + Math.random() * 500 - (Date.now() - t0));
    setTimeout(() => {
      if (id !== botTurnId) return;
      thinking = false;
      const pos = game().pos;
      const m = r?.move && legalMoves(pos).find((x) => moveKey(x) === r.move);
      if (!m) { setStatus(); return; }
      S.moves.push(r.move); persist();
      after(m, true, 'bot');
    }, delay);
  });
}

async function resign() {
  if (S.over) return;
  if (!(await confirmDialog('Partie aufgeben?', 'Aufgeben', 'Weiterspielen'))) return;
  botTurnId++; thinking = false;
  S.over = { over: true, winner: S.side === 'w' ? 'b' : 'w', why: 'aufgabe' }; rate(); persist();
  say(pickLine(LINES.resign));
  playEnd();
}

function showHint() {
  if (!canMove()) return;
  const g = game();
  statusEl?.replaceChildren(h('span', { class: 'ch-dots' }, 'Suche einen guten Zug'));
  ask(toFEN(g.pos), 'hint', g.hist).then((r) => {
    if (!r?.move || S.moves.length !== g.hist.length - 1) { setStatus(); return; }
    const m = legalMoves(game().pos).find((x) => moveKey(x) === r.move);
    if (!m) return;
    hint = { from: m.from, to: m.to }; sel = null;
    say(pickLine(LINES.hint));
    drawBoard(game());
  });
}

function undoMove() {
  if (!S.moves.length) return;
  botTurnId++; thinking = false; promo = null; sel = null; hint = null;
  const turnAfter = () => (S.moves.length % 2 === 0 ? 'w' : 'b');
  do { S.moves.pop(); } while (S.moves.length && turnAfter() !== S.side);
  S.over = null; resetEnd(); persist();
  say(pickLine(LINES.undo));
  draw();
}

// ---------------------------------------------------------------- Spielende-Animation
function resetEnd() {
  endTimers.forEach(clearTimeout); endTimers = [];
  endPhase = 'done'; endClosed = false;
}

function playEnd() {
  resetEnd();
  endPhase = 'big';
  drawBoard(game());
  endTimers.push(setTimeout(() => {
    endPhase = 'small';
    boardEl?.querySelectorAll('.ch-badge').forEach((b) => b.classList.add('small'));
    showEloChange(true);
  }, 1400));
  endTimers.push(setTimeout(() => { endPhase = 'done'; if (boardEl?.isConnected) drawBoard(game()); }, 2300));
}

const BADGE_ICON = {
  crown: '<svg viewBox="0 0 24 24"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" fill="#fff"/></svg>',
  mate: '<svg viewBox="0 0 24 24"><path d="M9 3L7 21M17 3l-2 18M3.5 9h17M3 15h17" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none"/></svg>',
  flag: '<svg viewBox="0 0 24 24"><path d="M6 21V4M6 4h11l-2.5 4L17 12H6" stroke="#fff" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round" fill="none"/></svg>',
  half: '<svg viewBox="0 0 24 24"><text x="12" y="17" text-anchor="middle" font-size="15" font-weight="800" fill="#fff" font-family="system-ui">½</text></svg>',
};

// Schilder an beiden Königen: groß („Sieger“/„Schachmatt“), dann klein als Abzeichen
function endBadges(g, disp) {
  const out = [];
  for (const c of ['w', 'b']) {
    const sq = g.pos.b.indexOf(c === 'w' ? 'K' : 'k');
    if (sq < 0) continue;
    const d = disp(sq);
    const win = S.over.winner === c, draw = !S.over.winner;
    const kind = draw ? 'draw' : win ? 'win' : 'lose';
    const label = draw ? 'Remis' : win ? 'Sieger' : S.over.why === 'matt' ? 'Schachmatt' : S.over.why === 'aufgabe' ? 'Aufgegeben' : 'Verloren';
    const ic = draw ? 'half' : win ? 'crown' : S.over.why === 'aufgabe' ? 'flag' : 'mate';
    const top = (d >> 3) === 0;
    out.push(h('div', { class: `ch-badge ${kind}${endPhase === 'big' ? '' : ' small'}${top ? ' at-top' : ''}`, style: { left: `${(d & 7) * 12.5}%`, top: `${(d >> 3) * 12.5}%` } },
      h('span', { class: 'ch-tag' }, h('span', { class: 'ch-tag-in' }, label)),
      h('span', { class: 'ch-dot', html: BADGE_ICON[ic] })));
  }
  return out;
}

function endDialog() {
  const won = S.over.winner === S.side;
  const why = { matt: 'durch Schachmatt', patt: 'durch Patt', 50: 'durch 50-Züge-Regel', material: 'zu wenig Material', wiederholung: 'durch Stellungswiederholung', aufgabe: 'durch Aufgabe' }[S.over.why] || '';
  return h('div', { class: 'ch-end' }, h('div', { class: 'ch-end-card' },
    h('button', { class: 'ch-end-x', 'aria-label': 'Schließen', onclick: () => { endClosed = true; drawBoard(game()); } }, '×'),
    h('div', { class: 'ch-end-title' }, won ? 'Du gewinnst!' : S.over.winner ? `${bot().name} gewinnt` : 'Remis'),
    h('div', { class: 'ch-end-why' }, why),
    S.over.elo ? eloLine() : null,
    h('div', { class: 'ch-end-bot' }, face(bot(), 56), h('div', { class: 'ch-bubble' }, S.say || '')),
    h('div', { class: 'ch-end-btns' },
      h('button', { class: 'btn primary', onclick: startGame }, 'Revanche'),
      h('button', { class: 'btn ghost', onclick: () => { resetEnd(); S.view = 'pick'; persist(); draw(); } }, 'Anderer Bot'))));
}

// ---------------------------------------------------------------- Geschlagene Figuren & Elo
function fillCaps(el, g, by) {
  if (!el) return;
  const list = g.caps[by].slice().sort((a, b) => CAP_ORDER.indexOf(a) - CAP_ORDER.indexOf(b));
  const lead = g.mat * (by === 'w' ? 1 : -1);
  let prev = null;
  const kids = list.map((t) => {
    const el2 = h('span', { class: `ch-cap${prev === t ? ' same' : prev ? ' gap' : ''}`, html: pieceSVG(by === 'w' ? t : t.toUpperCase()) });
    prev = t;
    return el2;
  });
  if (lead > 0) kids.push(h('span', { class: 'ch-adv' }, `+${lead}`));
  el.replaceChildren(...kids);
}

export function rating() {
  return (state.chess ||= { elo: 400, games: 0, wins: 0, losses: 0, draws: 0 });
}

// Elo nach der üblichen Formel: Erwartung aus der Differenz, K = 40 für die ersten 20 Partien, danach 20
function rate() {
  if (S.rated || !S.over) return;
  S.rated = true;
  const r = rating();
  const score = S.over.winner === S.side ? 1 : S.over.winner ? 0 : 0.5;
  const expected = 1 / (1 + 10 ** ((bot().elo - r.elo) / 400));
  const k = r.games < 20 ? 40 : 20;
  const before = r.elo;
  r.elo = Math.max(100, Math.round(r.elo + k * (score - expected)));
  r.games++;
  if (score === 1) r.wins++; else if (score === 0) r.losses++; else r.draws++;
  S.over.elo = { before, after: r.elo, delta: r.elo - before };
  eloAnim = true;
  save();
}

function meCard() {
  const r = rating();
  const name = state.profile?.name || 'Du';
  const showBefore = eloAnim && S.over?.elo;
  meEloEl = h('span', { class: 'ch-me-elo' }, String(showBefore ? S.over.elo.before : r.elo));
  meDeltaEl = h('span', { class: 'ch-delta' });
  capsMeEl = h('div', { class: 'ch-caps me' });
  if (S.over?.elo && !eloAnim) setDelta(meDeltaEl, S.over.elo.delta);
  return h('div', { class: 'ch-me' },
    h('div', { class: 'ch-me-top' }, h('span', { class: 'ch-me-av' }, name.slice(0, 1).toUpperCase()), h('span', { class: 'ch-me-name' }, name), meEloEl, meDeltaEl),
    capsMeEl);
}

function setDelta(el, d) {
  el.textContent = d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '±0';
  el.className = `ch-delta show ${d > 0 ? 'up' : d < 0 ? 'down' : 'same'}`;
}

function countUp(el, from, to, ms = 1100) {
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    const e = 1 - (1 - k) ** 3;
    el.textContent = String(Math.round(from + (to - from) * e));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Grün/rot einblenden und die Elo live hoch- bzw. runterzählen
function showEloChange() {
  const e = S.over?.elo;
  if (!e || !eloAnim || !meEloEl) return;
  eloAnim = false;
  setDelta(meDeltaEl, e.delta);
  countUp(meEloEl, e.before, e.after);
}

function eloLine() {
  const e = S.over.elo;
  const num = h('strong', {}, String(e.after));
  const d = h('span', { class: 'ch-delta' });
  setDelta(d, e.delta);
  if (!e.shown) { e.shown = true; persist(); num.textContent = String(e.before); requestAnimationFrame(() => countUp(num, e.before, e.after, 1300)); }
  return h('div', { class: 'ch-end-elo' }, 'Deine Elo ', num, d);
}
