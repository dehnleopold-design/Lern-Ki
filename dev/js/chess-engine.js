// Kleine Schach-Engine für das Warte-Schach: Zuggenerator (alle Regeln), Bewertung und Suche.
// Läuft als Web Worker (damit die App beim Nachdenken nicht hängt) und lässt sich auch direkt importieren.
//
// Brett: Array mit 64 Feldern, Index 0 = a8 … 7 = h8, 56 = a1 … 63 = h1.
// Figuren: 'PNBRQK' weiß, 'pnbrqk' schwarz, '' leer.

export const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KG = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];

export const colorOf = (p) => (!p ? null : p === p.toUpperCase() ? 'w' : 'b');
const other = (c) => (c === 'w' ? 'b' : 'w');
const own = (c, x) => (c === 'w' ? x.toUpperCase() : x.toLowerCase());
export const sqName = (i) => 'abcdefgh'[i & 7] + (8 - (i >> 3));
export const sqIndex = (n) => (8 - Number(n[1])) * 8 + 'abcdefgh'.indexOf(n[0]);

export function parseFEN(fen = START) {
  const [rows, turn, castle, ep, half, full] = fen.split(' ');
  const b = [];
  for (const ch of rows.replace(/\//g, '')) {
    if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) b.push('');
    else b.push(ch);
  }
  return { b, turn, castle: castle === '-' ? '' : castle, ep: ep === '-' ? -1 : sqIndex(ep), half: Number(half) || 0, full: Number(full) || 1 };
}

export function toFEN(pos) {
  let s = '';
  for (let r = 0; r < 8; r++) {
    let e = 0;
    for (let c = 0; c < 8; c++) {
      const p = pos.b[r * 8 + c];
      if (!p) { e++; continue; }
      if (e) { s += e; e = 0; }
      s += p;
    }
    if (e) s += e;
    if (r < 7) s += '/';
  }
  return `${s} ${pos.turn} ${pos.castle || '-'} ${pos.ep < 0 ? '-' : sqName(pos.ep)} ${pos.half} ${pos.full}`;
}

// Wird das Feld sq von Farbe `by` angegriffen?
export function attacked(b, sq, by) {
  const r = sq >> 3, c = sq & 7;
  const pr = by === 'w' ? r + 1 : r - 1;
  const P = own(by, 'p');
  if (pr >= 0 && pr < 8) {
    if (c > 0 && b[pr * 8 + c - 1] === P) return true;
    if (c < 7 && b[pr * 8 + c + 1] === P) return true;
  }
  const N = own(by, 'n'), K = own(by, 'k'), B = own(by, 'b'), R = own(by, 'r'), Q = own(by, 'q');
  for (const [dr, dc] of KN) { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && b[rr * 8 + cc] === N) return true; }
  for (const [dr, dc] of KG) { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && b[rr * 8 + cc] === K) return true; }
  for (const [dr, dc] of DIAG) {
    let rr = r + dr, cc = c + dc;
    while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) { const p = b[rr * 8 + cc]; if (p) { if (p === B || p === Q) return true; break; } rr += dr; cc += dc; }
  }
  for (const [dr, dc] of ORTH) {
    let rr = r + dr, cc = c + dc;
    while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) { const p = b[rr * 8 + cc]; if (p) { if (p === R || p === Q) return true; break; } rr += dr; cc += dc; }
  }
  return false;
}

export function inCheck(pos, color = pos.turn) {
  const k = pos.b.indexOf(own(color, 'k'));
  return k >= 0 && attacked(pos.b, k, other(color));
}

function pseudo(pos, capturesOnly = false) {
  const { b, turn } = pos;
  const out = [];
  const enemy = other(turn);
  const push = (from, to, flag) => {
    const p = b[from], cap = b[to] || (flag === 'ep' ? own(enemy, 'p') : '');
    if (capturesOnly && !cap && !(p.toLowerCase() === 'p' && ((to >> 3) === 0 || (to >> 3) === 7))) return;
    if (p.toLowerCase() === 'p' && ((to >> 3) === 0 || (to >> 3) === 7)) {
      for (const pr of ['q', 'r', 'b', 'n']) out.push({ from, to, p, cap, promo: pr, flag });
    } else out.push({ from, to, p, cap, flag });
  };
  for (let sq = 0; sq < 64; sq++) {
    const p = b[sq];
    if (!p || colorOf(p) !== turn) continue;
    const r = sq >> 3, c = sq & 7, t = p.toLowerCase();
    if (t === 'p') {
      const dir = turn === 'w' ? -1 : 1;
      const r1 = r + dir;
      if (r1 < 0 || r1 > 7) continue;
      if (!b[r1 * 8 + c]) {
        push(sq, r1 * 8 + c);
        const startRow = turn === 'w' ? 6 : 1;
        if (r === startRow && !b[(r + 2 * dir) * 8 + c] && !capturesOnly) out.push({ from: sq, to: (r + 2 * dir) * 8 + c, p, cap: '', flag: 'double' });
      }
      for (const dc of [-1, 1]) {
        const cc = c + dc;
        if (cc < 0 || cc > 7) continue;
        const to = r1 * 8 + cc;
        if (b[to] && colorOf(b[to]) === enemy) push(sq, to);
        else if (to === pos.ep) push(sq, to, 'ep');
      }
    } else if (t === 'n' || t === 'k') {
      for (const [dr, dc] of t === 'n' ? KN : KG) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr > 7 || cc < 0 || cc > 7) continue;
        const to = rr * 8 + cc;
        if (!b[to] || colorOf(b[to]) === enemy) push(sq, to);
      }
      if (t === 'k' && !capturesOnly) {
        const cs = pos.castle;
        if (turn === 'w' && sq === 60) {
          if (cs.includes('K') && !b[61] && !b[62] && b[63] === 'R' && !attacked(b, 60, 'b') && !attacked(b, 61, 'b') && !attacked(b, 62, 'b')) out.push({ from: 60, to: 62, p, cap: '', flag: 'castle' });
          if (cs.includes('Q') && !b[59] && !b[58] && !b[57] && b[56] === 'R' && !attacked(b, 60, 'b') && !attacked(b, 59, 'b') && !attacked(b, 58, 'b')) out.push({ from: 60, to: 58, p, cap: '', flag: 'castle' });
        }
        if (turn === 'b' && sq === 4) {
          if (cs.includes('k') && !b[5] && !b[6] && b[7] === 'r' && !attacked(b, 4, 'w') && !attacked(b, 5, 'w') && !attacked(b, 6, 'w')) out.push({ from: 4, to: 6, p, cap: '', flag: 'castle' });
          if (cs.includes('q') && !b[3] && !b[2] && !b[1] && b[0] === 'r' && !attacked(b, 4, 'w') && !attacked(b, 3, 'w') && !attacked(b, 2, 'w')) out.push({ from: 4, to: 2, p, cap: '', flag: 'castle' });
        }
      }
    } else {
      const dirs = t === 'b' ? DIAG : t === 'r' ? ORTH : [...DIAG, ...ORTH];
      for (const [dr, dc] of dirs) {
        let rr = r + dr, cc = c + dc;
        while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
          const to = rr * 8 + cc;
          if (b[to]) { if (colorOf(b[to]) === enemy) push(sq, to); break; }
          push(sq, to);
          rr += dr; cc += dc;
        }
      }
    }
  }
  return out;
}

export function makeMove(pos, m) {
  const b = pos.b.slice();
  const p = b[m.from];
  b[m.to] = m.promo ? own(pos.turn, m.promo) : p;
  b[m.from] = '';
  if (m.flag === 'ep') b[m.to + (pos.turn === 'w' ? 8 : -8)] = '';
  if (m.flag === 'castle') {
    const rook = { 62: [63, 61], 58: [56, 59], 6: [7, 5], 2: [0, 3] }[m.to];
    b[rook[1]] = b[rook[0]]; b[rook[0]] = '';
  }
  let castle = pos.castle;
  if (castle) {
    if (p === 'K') castle = castle.replace(/[KQ]/g, '');
    if (p === 'k') castle = castle.replace(/[kq]/g, '');
    for (const [sq, ch] of [[63, 'K'], [56, 'Q'], [7, 'k'], [0, 'q']]) if (m.from === sq || m.to === sq) castle = castle.replace(ch, '');
  }
  return {
    b, castle,
    turn: other(pos.turn),
    ep: m.flag === 'double' ? (m.from + m.to) / 2 : -1,
    half: p.toLowerCase() === 'p' || m.cap ? 0 : pos.half + 1,
    full: pos.full + (pos.turn === 'b' ? 1 : 0),
  };
}

export function legalMoves(pos, capturesOnly = false) {
  return pseudo(pos, capturesOnly).filter((m) => !inCheck(makeMove(pos, m), pos.turn));
}

export const moveKey = (m) => sqName(m.from) + sqName(m.to) + (m.promo || '');
export const posKey = (pos) => `${pos.b.map((x) => x || '.').join('')}${pos.turn}${pos.castle}${pos.ep}`;

// Ist mit dem Material kein Matt mehr möglich?
export function insufficient(pos) {
  const rest = pos.b.filter((p) => p && p.toLowerCase() !== 'k');
  if (!rest.length) return true;
  if (rest.length === 1 && 'nb'.includes(rest[0].toLowerCase())) return true;
  if (rest.every((p) => p.toLowerCase() === 'b')) {
    const shades = new Set(pos.b.map((p, i) => (p && p.toLowerCase() === 'b' ? ((i >> 3) + (i & 7)) % 2 : -1)).filter((x) => x >= 0));
    return shades.size === 1;
  }
  return false;
}

// Ergebnis der Stellung (history = Liste von posKey für Stellungswiederholung)
export function gameResult(pos, history = []) {
  const moves = legalMoves(pos);
  if (!moves.length) return inCheck(pos) ? { over: true, winner: other(pos.turn), why: 'matt' } : { over: true, winner: null, why: 'patt' };
  if (pos.half >= 100) return { over: true, winner: null, why: '50' };
  if (insufficient(pos)) return { over: true, winner: null, why: 'material' };
  const k = posKey(pos);
  if (history.filter((x) => x === k).length >= 3) return { over: true, winner: null, why: 'wiederholung' };
  return { over: false };
}

// ---------------------------------------------------------------- Bewertung
const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
// Figurentabellen aus Sicht von Weiß (Zeile 0 = 8. Reihe)
const PST = {
  p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
  ke: [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50],
};

// Bewertung in Centipawns aus Sicht der Seite am Zug
export function evaluate(pos) {
  const b = pos.b;
  let heavy = 0;
  for (const p of b) if (p && 'qrbnQRBN'.includes(p)) heavy += VAL[p.toLowerCase()];
  const endgame = heavy <= 1600;
  let s = 0;
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p) continue;
    const t = p.toLowerCase();
    const w = p !== t;
    const idx = w ? i : (7 - (i >> 3)) * 8 + (i & 7);
    const v = VAL[t] + PST[t === 'k' && endgame ? 'ke' : t][idx];
    s += w ? v : -v;
  }
  return pos.turn === 'w' ? s : -s;
}

// ---------------------------------------------------------------- Suche
const MATE = 100000;
const STOP = Symbol('stop');

function order(moves, first) {
  const score = (m) => (first && moveKey(m) === first ? 1e6 : 0) + (m.cap ? 10 * VAL[m.cap.toLowerCase()] - VAL[m.p.toLowerCase()] / 10 + 1000 : 0) + (m.promo === 'q' ? 900 : 0);
  return moves.map((m) => [score(m), m]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
}

function quiesce(pos, alpha, beta, ctx, qd) {
  if ((++ctx.nodes & 1023) === 0 && Date.now() > ctx.deadline) throw STOP;
  const stand = evaluate(pos);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  if (qd <= 0) return alpha;
  for (const m of order(legalMoves(pos, true))) {
    const s = -quiesce(makeMove(pos, m), -beta, -alpha, ctx, qd - 1);
    if (s >= beta) return beta;
    if (s > alpha) alpha = s;
  }
  return alpha;
}

function negamax(pos, depth, alpha, beta, ply, ctx) {
  if ((++ctx.nodes & 1023) === 0 && Date.now() > ctx.deadline) throw STOP;
  if (depth <= 0) return ctx.q ? quiesce(pos, alpha, beta, ctx, 6) : evaluate(pos);
  const moves = legalMoves(pos);
  if (!moves.length) return inCheck(pos) ? -MATE + ply : 0;
  if (pos.half >= 100) return 0;
  for (const m of order(moves)) {
    const s = -negamax(makeMove(pos, m), depth - 1, -beta, -alpha, ply + 1, ctx);
    if (s >= beta) return beta;
    if (s > alpha) alpha = s;
  }
  return alpha;
}

// Spielstärken (ungefähre Elo, nicht geeicht)
export const LEVELS = {
  400: { depth: 1, q: false, noise: 220, rand: 0.3 },
  600: { depth: 1, q: true, noise: 130, rand: 0.18 },
  800: { depth: 2, q: false, noise: 90, rand: 0.1 },
  1000: { depth: 2, q: true, noise: 60, rand: 0.06 },
  1200: { depth: 2, q: true, noise: 35, rand: 0.03 },
  1400: { depth: 3, q: true, noise: 25, rand: 0.015 },
  1600: { depth: 3, q: true, noise: 12, rand: 0 },
  1800: { depth: 4, q: true, noise: 5, rand: 0, time: 1500 },
  2000: { depth: 5, q: true, noise: 0, rand: 0, time: 2200 },
  hint: { depth: 4, q: true, noise: 0, rand: 0, time: 1200 },
};

// Bester Zug für die Seite am Zug. opts: { elo, history } → { move: 'e2e4', score }
export function bestMove(fen, opts = {}) {
  const pos = parseFEN(fen);
  const lv = LEVELS[opts.elo] || LEVELS[1200];
  const moves = legalMoves(pos);
  if (!moves.length) return { move: null };
  if (moves.length === 1) return { move: moveKey(moves[0]) };
  if (lv.rand && Math.random() < lv.rand) {
    // „Schnapper“: zufälliger Zug, Schlagzüge etwas wahrscheinlicher
    const caps = moves.filter((m) => m.cap);
    const pool = caps.length && Math.random() < 0.4 ? caps : moves;
    return { move: moveKey(pool[Math.floor(Math.random() * pool.length)]), random: true };
  }
  const ctx = { nodes: 0, q: lv.q, deadline: Date.now() + (lv.time || 1200) };
  const hist = new Set(opts.history || []);
  let best = null, scores = null;
  for (let d = 1; d <= lv.depth; d++) {
    try {
      const sc = [];
      let alpha = -Infinity;
      for (const m of order(moves, best)) {
        const next = makeMove(pos, m);
        // Stellungswiederholung meiden, wenn man besser steht
        let s;
        if (hist.has(posKey(next))) s = 0;
        else if (lv.noise) s = -negamax(next, d - 1, -MATE - 1, MATE + 1, 1, ctx);
        else s = -negamax(next, d - 1, -MATE - 1, -alpha, 1, ctx);
        sc.push([m, s]);
        if (s > alpha) alpha = s;
      }
      scores = sc;
      best = moveKey(sc.reduce((a, b) => (b[1] > a[1] ? b : a))[0]);
    } catch (e) {
      if (e !== STOP) throw e;
      break;
    }
  }
  if (!scores) return { move: moveKey(moves[0]) };
  // Zufallsrauschen macht schwächere Bots menschlicher; Matt sieht jeder
  const top = Math.max(...scores.map((x) => x[1]));
  if (top > MATE - 100) return { move: moveKey(scores.find((x) => x[1] === top)[0]), score: top };
  let pick = null, pv = -Infinity;
  for (const [m, s] of scores) {
    const v = s + (lv.noise ? (Math.random() - 0.5) * 2 * lv.noise : 0);
    if (v > pv) { pv = v; pick = m; }
  }
  return { move: moveKey(pick), score: top };
}

// Als Worker: { id, fen, elo, history } → { id, move }
if (typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = (e) => {
    const { id, fen, elo, history } = e.data || {};
    try { self.postMessage({ id, ...bestMove(fen, { elo, history }) }); } catch (err) { self.postMessage({ id, error: String(err?.message || err) }); }
  };
}
