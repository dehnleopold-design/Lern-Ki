// Kleine Spiele für „Beim Warten“: Snake, Straßen-Flitzer, Jelly Jump, Memory, Ziegel-Brecher.
// Alles eigene Umsetzungen. Rekorde stehen in state.games.best (gehören zum Konto).
// Bedienung: Wischen/Tippen auf dem iPad, Pfeiltasten auf der Tastatur.

import { h } from './ui.js';
import { state, save } from './store.js';

export const GAMES = [
  { id: 'snake', name: 'Snake', emoji: '🐍', desc: 'Friss Plankton und werde länger' },
  { id: 'racer', name: 'Straßen-Flitzer', emoji: '🏎️', desc: 'Weich den Autos aus' },
  { id: 'jump', name: 'Jelly Jump', emoji: '🪼', desc: 'Tippen – Jelly schwimmt hoch' },
  { id: 'memory', name: 'Memory', emoji: '🃏', desc: 'Finde alle Paare' },
  { id: 'bricks', name: 'Ziegel-Brecher', emoji: '🧱', desc: 'Schieb das Brett, triff die Steine' },
];
export const isGame = (id) => GAMES.some((g) => g.id === id);

const best = (id) => state.games?.best?.[id] ?? null;
function setBest(id, score, lowerIsBetter = false) {
  state.games ||= {};
  state.games.best ||= {};
  const old = state.games.best[id];
  if (old == null || (lowerIsBetter ? score < old : score > old)) { state.games.best[id] = score; save(); return true; }
  return false;
}
const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------------------------------------------------------------- Rahmen für Canvas-Spiele
// Ein Canvas mit Start-/Ende-Hinweis; game: { init(ctx,W,H), step(dt), draw(ctx), input(type, data), score(), over }
function canvasGame(id, makeGame, { ratio = 1.25, controls = null, help = '' } = {}) {
  const wrap = h('div', { class: 'gm' });
  const canvas = h('canvas', { class: 'gm-canvas' });
  const hud = h('div', { class: 'gm-hud' });
  const overlay = h('div', { class: 'gm-overlay' });
  wrap.append(hud, h('div', { class: 'gm-stage' }, canvas, overlay));
  if (controls) wrap.append(controls((type, data) => game && running && game.input(type, data)));
  let game = null, running = false, last = 0, W = 0, H = 0, ctx = null, raf = 0;

  const size = () => {
    const w = Math.min(520, wrap.clientWidth || 360);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = w; H = Math.round(w * ratio);
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const showHud = () => { hud.replaceChildren(h('span', {}, `Punkte: ${game ? game.score() : 0}`), h('span', {}, `Rekord: ${best(id) ?? '–'}`)); };
  const menu = (title, sub, btn) => {
    overlay.replaceChildren(h('div', { class: 'gm-ov-t' }, title), sub ? h('div', { class: 'gm-ov-s' }, sub) : null, h('button', { class: 'btn primary', onclick: start }, btn));
    overlay.hidden = false;
  };
  function start() {
    size();
    game = makeGame();
    game.init(ctx, W, H);
    running = true; overlay.hidden = true; last = 0;
    showHud();
    cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
  }
  function loop(t) {
    if (!wrap.isConnected) { running = false; if (game && !game.over) menu('Pause', 'Das Spiel wurde unterbrochen.', 'Neu starten'); return; }
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 0; last = t;
    game.step(dt);
    game.draw(ctx);
    showHud();
    if (game.over) {
      running = false;
      const rec = setBest(id, game.score());
      showHud();
      menu(rec && game.score() > 0 ? 'Neuer Rekord! 🎉' : 'Vorbei!', `Punkte: ${game.score()} · Rekord: ${best(id) ?? 0}`, 'Nochmal');
      return;
    }
    raf = requestAnimationFrame(loop);
  }
  // Eingaben: Tippen, Wischen, Ziehen, Tasten
  let sx = 0, sy = 0, swiped = false;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener('pointerdown', (e) => { if (!running) return; e.preventDefault(); const p = pos(e); sx = p.x; sy = p.y; swiped = false; game.input('down', p); });
  canvas.addEventListener('pointermove', (e) => {
    if (!running) return;
    const p = pos(e); game.input('move', p);
    if (e.buttons || e.pointerType === 'touch') {
      const dx = p.x - sx, dy = p.y - sy;
      if (!swiped && Math.hypot(dx, dy) > 24) { swiped = true; game.input('swipe', Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')); }
    }
  });
  canvas.addEventListener('pointerup', (e) => { if (running && !swiped) game.input('tap', pos(e)); });
  const keys = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down' };
  document.addEventListener('keydown', (e) => {
    if (!running || !wrap.isConnected) return;
    if (keys[e.key]) { e.preventDefault(); game.input('key', keys[e.key]); }
    if (e.key === ' ') { e.preventDefault(); game.input('tap', null); }
  });
  menu(GAMES.find((g) => g.id === id).name, help, 'Start');
  requestAnimationFrame(() => { size(); ctx.fillStyle = css('--surface-2', '#1c1924'); ctx.fillRect(0, 0, W, H); showHud(); });
  return wrap;
}

const arrowPad = (send) => h('div', { class: 'gm-pad' },
  h('span'), h('button', { class: 'gm-key', onclick: () => send('key', 'up') }, '▲'), h('span'),
  h('button', { class: 'gm-key', onclick: () => send('key', 'left') }, '◀'), h('button', { class: 'gm-key', onclick: () => send('key', 'down') }, '▼'), h('button', { class: 'gm-key', onclick: () => send('key', 'right') }, '▶'));

// ---------------------------------------------------------------- Snake
function snake() {
  const N = 18;
  let cell, s, dir, next, food, timer, score, acc, W, H, accent, bg, line;
  const place = () => { do { food = { x: Math.floor(Math.random() * N), y: Math.floor(Math.random() * N) }; } while (s.some((p) => p.x === food.x && p.y === food.y)); };
  return {
    over: false,
    init(_, w, hh) { W = w; H = hh; cell = Math.floor(W / N); s = [{ x: 8, y: 9 }, { x: 7, y: 9 }, { x: 6, y: 9 }]; dir = next = 'right'; score = 0; acc = 0; timer = 0.16; place();
      accent = css('--accent', '#8b5cf6'); bg = css('--surface-2', '#1c1924'); line = css('--line', 'rgba(255,255,255,.07)'); },
    input(type, d) {
      const opp = { left: 'right', right: 'left', up: 'down', down: 'up' };
      if ((type === 'swipe' || type === 'key') && d !== opp[dir]) next = d;
    },
    step(dt) {
      acc += dt;
      while (acc >= timer && !this.over) {
        acc -= timer; dir = next;
        const head = { ...s[0] };
        head.x += dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
        head.y += dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
        if (head.x < 0 || head.y < 0 || head.x >= N || head.y >= N || s.some((p) => p.x === head.x && p.y === head.y)) { this.over = true; return; }
        s.unshift(head);
        if (head.x === food.x && head.y === food.y) { score++; timer = Math.max(0.07, timer * 0.96); place(); } else s.pop();
      }
    },
    draw(c) {
      c.fillStyle = bg; c.fillRect(0, 0, W, H);
      const ox = (W - cell * N) / 2, oy = (H - cell * N) / 2;
      c.strokeStyle = line; c.lineWidth = 1;
      c.strokeRect(ox, oy, cell * N, cell * N);
      c.fillStyle = '#34d399'; c.beginPath(); c.arc(ox + food.x * cell + cell / 2, oy + food.y * cell + cell / 2, cell * 0.32, 0, Math.PI * 2); c.fill();
      s.forEach((p, i) => { c.globalAlpha = 1 - (i / s.length) * 0.5; c.fillStyle = accent; const r = cell * 0.18; roundRect(c, ox + p.x * cell + 1, oy + p.y * cell + 1, cell - 2, cell - 2, r); c.fill(); });
      c.globalAlpha = 1;
      const hd = s[0]; c.fillStyle = '#fff';
      c.beginPath(); c.arc(ox + hd.x * cell + cell * 0.35, oy + hd.y * cell + cell * 0.4, cell * 0.1, 0, 7); c.arc(ox + hd.x * cell + cell * 0.65, oy + hd.y * cell + cell * 0.4, cell * 0.1, 0, 7); c.fill();
    },
    score: () => score,
  };
}

// ---------------------------------------------------------------- Straßen-Flitzer
function racer() {
  let W, H, lane, laneX, target, px, cars, coins, speed, dist, spawn, coin, bonus, stripe, accent;
  const LANES = 3;
  const carColors = ['#ef4444', '#3b82f6', '#f59e0b', '#10b981', '#e5e7eb', '#a855f7'];
  const drawCar = (c, x, y, w, hh, col, player) => {
    c.fillStyle = 'rgba(0,0,0,.35)'; roundRect(c, x - w / 2 + 3, y - hh / 2 + 5, w, hh, 10); c.fill();
    c.fillStyle = col; roundRect(c, x - w / 2, y - hh / 2, w, hh, 10); c.fill();
    c.fillStyle = 'rgba(20,25,40,.8)'; roundRect(c, x - w / 2 + 6, y - hh / 2 + (player ? 14 : hh - 30), w - 12, 16, 5); c.fill();
    c.fillStyle = player ? '#fff7cc' : '#ffb4b4'; c.fillRect(x - w / 2 + 5, y - hh / 2 + (player ? 2 : hh - 6), 8, 4); c.fillRect(x + w / 2 - 13, y - hh / 2 + (player ? 2 : hh - 6), 8, 4);
  };
  return {
    over: false,
    init(_, w, hh) { W = w; H = hh; laneX = (i) => W * (0.2 + i * 0.3); lane = target = 1; px = laneX(1); cars = []; coins = []; speed = 260; dist = 0; spawn = 0.6; coin = 1.2; bonus = 0; stripe = 0; accent = css('--accent', '#8b5cf6'); },
    input(type, d) {
      if (type === 'tap' && d) target = Math.max(0, Math.min(LANES - 1, target + (d.x < W / 2 ? -1 : 1)));
      if ((type === 'swipe' || type === 'key') && (d === 'left' || d === 'right')) target = Math.max(0, Math.min(LANES - 1, target + (d === 'left' ? -1 : 1)));
    },
    step(dt) {
      speed += dt * 9; dist += speed * dt; stripe = (stripe + speed * dt) % 60;
      px += (laneX(target) - px) * Math.min(1, dt * 14);
      spawn -= dt; coin -= dt;
      if (spawn <= 0) { const l = Math.floor(Math.random() * LANES); cars.push({ x: laneX(l), y: -60, v: rnd(0.25, 0.55), col: carColors[Math.floor(Math.random() * carColors.length)] }); spawn = Math.max(0.35, 1.0 - speed / 1400) + rnd(0, .3); }
      if (coin <= 0) { coins.push({ x: laneX(Math.floor(Math.random() * LANES)), y: -30 }); coin = rnd(1, 2.2); }
      const py = H - 90, cw = W * 0.16, ch = cw * 1.7;
      for (const car of cars) { car.y += speed * (1 - car.v) * dt; if (Math.abs(car.x - px) < cw * 0.85 && Math.abs(car.y - py) < ch * 0.85) this.over = true; }
      for (const k of coins) { k.y += speed * dt; if (!k.got && Math.abs(k.x - px) < cw * 0.7 && Math.abs(k.y - py) < ch * 0.6) { k.got = true; bonus += 25; } }
      cars = cars.filter((c) => c.y < H + 80); coins = coins.filter((k) => k.y < H + 40 && !k.got);
    },
    draw(c) {
      c.fillStyle = '#2f9e44'; c.fillRect(0, 0, W, H);
      c.fillStyle = '#3a3f4a'; c.fillRect(W * 0.05, 0, W * 0.9, H);
      c.fillStyle = '#e5e7eb'; c.fillRect(W * 0.05, 0, 4, H); c.fillRect(W * 0.95 - 4, 0, 4, H);
      c.fillStyle = 'rgba(255,255,255,.75)';
      for (const lx of [W * 0.35, W * 0.65]) for (let y = -60 + stripe; y < H; y += 60) c.fillRect(lx - 3, y, 6, 30);
      const cw = W * 0.16, ch = cw * 1.7;
      for (const k of coins) { c.fillStyle = '#fbbf24'; c.beginPath(); c.arc(k.x, k.y, cw * 0.22, 0, 7); c.fill(); c.fillStyle = '#fde68a'; c.beginPath(); c.arc(k.x - 2, k.y - 2, cw * 0.1, 0, 7); c.fill(); }
      for (const car of cars) drawCar(c, car.x, car.y, cw, ch, car.col, false);
      drawCar(c, px, H - 90, cw, ch, accent, true);
    },
    score: () => Math.floor(dist / 40) + bonus,
  };
}

// ---------------------------------------------------------------- Jelly Jump
function jump() {
  let W, H, y, v, pipes, t, score, gap, accent;
  const G = 1500, FLAP = -430, X = 0.28;
  return {
    over: false,
    init(_, w, hh) { W = w; H = hh; y = H * 0.45; v = 0; pipes = []; t = 0.9; score = 0; gap = H * 0.3; accent = css('--accent-2', '#b794ff'); },
    input(type) { if (type === 'down' || type === 'key') v = FLAP; },
    step(dt) {
      v += G * dt; y += v * dt;
      t -= dt;
      if (t <= 0) { pipes.push({ x: W + 30, top: rnd(H * 0.12, H * 0.88 - gap), passed: false }); t = 1.55; gap = Math.max(H * 0.22, gap - 2); }
      const pw = W * 0.17, r = W * 0.045;
      for (const p of pipes) {
        p.x -= W * 0.42 * dt;
        if (!p.passed && p.x + pw < W * X) { p.passed = true; score++; }
        if (W * X + r > p.x && W * X - r < p.x + pw && (y - r < p.top || y + r > p.top + gap)) this.over = true;
      }
      pipes = pipes.filter((p) => p.x > -pw - 10);
      if (y < r) { y = r; v = Math.max(v, 0); } // oben nur anstoßen
      if (y > H - r) this.over = true;
    },
    draw(c) {
      const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0b3b6b'); g.addColorStop(1, '#021428'); c.fillStyle = g; c.fillRect(0, 0, W, H);
      const pw = W * 0.17;
      for (const p of pipes) {
        c.fillStyle = '#f472b6'; roundRect(c, p.x, -10, pw, p.top + 10, 14); c.fill(); roundRect(c, p.x, p.top + gap, pw, H - p.top - gap + 10, 14); c.fill();
        c.fillStyle = 'rgba(255,255,255,.18)'; for (let k = 0; k < 4; k++) { c.beginPath(); c.arc(p.x + pw * (0.25 + k * 0.17), p.top - 14 - k * 20, 5, 0, 7); c.arc(p.x + pw * (0.3 + k * 0.15), p.top + gap + 18 + k * 22, 5, 0, 7); c.fill(); }
      }
      // Jelly
      const r = W * 0.045, x = W * X, tilt = Math.max(-0.5, Math.min(0.6, v / 900));
      c.save(); c.translate(x, y); c.rotate(tilt);
      c.strokeStyle = accent; c.lineWidth = 2.5; c.lineCap = 'round';
      for (let k = -1.5; k <= 1.5; k++) { c.beginPath(); c.moveTo(k * r * 0.45, r * 0.3); c.quadraticCurveTo(k * r * 0.45 + Math.sin(performance.now() / 150 + k) * 4, r * 1.1, k * r * 0.45, r * 1.7); c.stroke(); }
      c.fillStyle = accent; c.beginPath(); c.arc(0, 0, r, Math.PI, 0); c.lineTo(r, r * 0.35); c.lineTo(-r, r * 0.35); c.closePath(); c.fill();
      c.fillStyle = '#1a1030'; c.beginPath(); c.arc(-r * 0.35, -r * 0.1, r * 0.13, 0, 7); c.arc(r * 0.35, -r * 0.1, r * 0.13, 0, 7); c.fill();
      c.restore();
    },
    score: () => score,
  };
}

// ---------------------------------------------------------------- Ziegel-Brecher
function bricks() {
  let W, H, px, pw, ball, bricksArr, lives, score, level, stuck, cols;
  const rows = 6, ncol = 8;
  const build = () => {
    bricksArr = [];
    const bw = (W - 20) / ncol, bh = 18;
    for (let r = 0; r < rows; r++) for (let k = 0; k < ncol; k++) bricksArr.push({ x: 10 + k * bw, y: 50 + r * (bh + 6), w: bw - 6, h: bh, c: cols[r % cols.length], alive: true });
  };
  const reset = () => { ball = { x: px, y: H - 52, vx: 0, vy: 0 }; stuck = true; };
  return {
    over: false,
    init(_, w, hh) { W = w; H = hh; pw = W * 0.22; px = W / 2; lives = 3; score = 0; level = 1; cols = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#60a5fa', css('--accent', '#8b5cf6')]; build(); reset(); },
    input(type, d) {
      if ((type === 'move' || type === 'down') && d) px = Math.max(pw / 2, Math.min(W - pw / 2, d.x));
      if (type === 'key' && (d === 'left' || d === 'right')) px = Math.max(pw / 2, Math.min(W - pw / 2, px + (d === 'left' ? -40 : 40)));
      if ((type === 'tap' || type === 'down' || (type === 'key' && d === 'up')) && stuck) { stuck = false; const sp = W * (0.9 + level * 0.08); ball.vx = sp * rnd(-0.5, 0.5); ball.vy = -sp; }
    },
    step(dt) {
      if (stuck) { ball.x = px; ball.y = H - 52; return; }
      const r = 7;
      ball.x += ball.vx * dt; ball.y += ball.vy * dt;
      if (ball.x < r) { ball.x = r; ball.vx *= -1; } if (ball.x > W - r) { ball.x = W - r; ball.vx *= -1; } if (ball.y < r) { ball.y = r; ball.vy *= -1; }
      if (ball.vy > 0 && ball.y + r >= H - 40 && ball.y + r <= H - 26 && Math.abs(ball.x - px) < pw / 2 + r) {
        const hit = (ball.x - px) / (pw / 2); const sp = Math.hypot(ball.vx, ball.vy);
        ball.vx = sp * hit * 0.75; ball.vy = -Math.sqrt(Math.max(1, sp * sp - ball.vx * ball.vx));
      }
      for (const b of bricksArr) {
        if (!b.alive) continue;
        if (ball.x + r > b.x && ball.x - r < b.x + b.w && ball.y + r > b.y && ball.y - r < b.y + b.h) {
          b.alive = false; score += 10;
          const ox = Math.min(ball.x + r - b.x, b.x + b.w - (ball.x - r)), oy = Math.min(ball.y + r - b.y, b.y + b.h - (ball.y - r));
          if (ox < oy) ball.vx *= -1; else ball.vy *= -1;
          break;
        }
      }
      if (!bricksArr.some((b) => b.alive)) { level++; build(); reset(); }
      if (ball.y > H + 20) { lives--; if (lives <= 0) this.over = true; else reset(); }
    },
    draw(c) {
      c.fillStyle = css('--surface-2', '#1c1924'); c.fillRect(0, 0, W, H);
      for (const b of bricksArr) if (b.alive) { c.fillStyle = b.c; roundRect(c, b.x, b.y, b.w, b.h, 5); c.fill(); }
      c.fillStyle = css('--text', '#fff'); roundRect(c, px - pw / 2, H - 38, pw, 12, 6); c.fill();
      c.beginPath(); c.arc(ball.x, ball.y, 7, 0, 7); c.fill();
      c.font = '600 13px Inter, sans-serif'; c.fillStyle = css('--muted', '#999');
      c.fillText(`Leben: ${'♥'.repeat(lives)}   Level ${level}`, 10, 26);
      if (stuck) { c.textAlign = 'center'; c.fillText('Tippen zum Abschießen', W / 2, H - 70); c.textAlign = 'left'; }
    },
    score: () => score,
  };
}

// ---------------------------------------------------------------- Memory (ohne Canvas)
function memoryGame() {
  const wrap = h('div', { class: 'gm' });
  const hud = h('div', { class: 'gm-hud' });
  const grid = h('div', { class: 'mem-grid' });
  wrap.append(hud, grid, h('button', { class: 'btn ghost block', onclick: () => start() }, 'Neu mischen'));
  const ICONS = ['🧪', '📐', '🌍', '📚', '🎨', '🎵', '🧬', '⚡'];
  let cards, open, moves, found, lock;
  const showHud = () => hud.replaceChildren(h('span', {}, `Züge: ${moves}`), h('span', {}, `Rekord: ${best('memory') ?? '–'} Züge`));
  function start() {
    cards = [...ICONS, ...ICONS].map((e, i) => ({ e, i, open: false, done: false })).sort(() => Math.random() - 0.5);
    open = []; moves = 0; found = 0; lock = false;
    draw();
  }
  function draw() {
    showHud();
    grid.replaceChildren(...cards.map((c) => h('button', { class: `mem-card ${c.open || c.done ? 'open' : ''} ${c.done ? 'done' : ''}`, onclick: () => flip(c) }, h('span', {}, c.open || c.done ? c.e : '🪼'))));
  }
  function flip(c) {
    if (lock || c.open || c.done) return;
    c.open = true; open.push(c); draw();
    if (open.length === 2) {
      moves++; lock = true;
      const [a, b] = open;
      setTimeout(() => {
        if (a.e === b.e) { a.done = b.done = true; found++; } else { a.open = b.open = false; }
        open = []; lock = false; draw();
        if (found === ICONS.length) {
          const rec = setBest('memory', moves, true);
          hud.replaceChildren(h('span', {}, rec ? `Neuer Rekord: ${moves} Züge! 🎉` : `Geschafft in ${moves} Zügen!`), h('span', {}, `Rekord: ${best('memory')} Züge`));
        }
      }, a.e === b.e ? 250 : 750);
    }
  }
  start();
  return wrap;
}

function roundRect(c, x, y, w, hh, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + hh, r); c.arcTo(x + w, y + hh, x, y + hh, r); c.arcTo(x, y + hh, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

// Ein Spiel bleibt erhalten (wie das Schach), solange die App offen ist
const panels = {};
export function gamePanel(id) {
  if (!panels[id]) {
    panels[id] = id === 'snake' ? canvasGame('snake', snake, { ratio: 1, controls: arrowPad, help: 'Wischen oder Pfeile – friss das grüne Plankton.' })
      : id === 'racer' ? canvasGame('racer', racer, { ratio: 1.35, help: 'Links oder rechts tippen bzw. wischen zum Spurwechsel. Münzen geben Extrapunkte.' })
      : id === 'jump' ? canvasGame('jump', jump, { ratio: 1.3, help: 'Tippen lässt Jelly nach oben schwimmen. Nicht die Korallen berühren!' })
      : id === 'bricks' ? canvasGame('bricks', bricks, { ratio: 1.3, help: 'Finger über das Feld ziehen bewegt das Brett. Tippen schießt den Ball ab.' })
      : memoryGame();
  }
  return panels[id];
}
