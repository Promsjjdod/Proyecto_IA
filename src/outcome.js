// Outcome generation + win evaluation (virtual credits only)
import { REELS, ROWS, WEIGHTS, SYMBOLS, PAYLINES } from './config.js';

const ids = Object.keys(WEIGHTS);
const total = ids.reduce((s, k) => s + WEIGHTS[k], 0);
function pick() { let r = Math.random() * total; for (const id of ids) { r -= WEIGHTS[id]; if (r <= 0) return id; } return ids[0]; }

export function generateOutcome() {
  // [reel][row] — with "stacked symbols" and left-to-right affinity so the board feels alive (arcade tuning)
  const grid = Array.from({ length: REELS }, () => Array.from({ length: ROWS }, pick));
  const stackable = s => !SYMBOLS[s].scatter && !SYMBOLS[s].bonus;
  for (let reel = 0; reel < REELS; reel++) {
    const col = grid[reel];
    // affinity: reuse a symbol seen on the first reel
    if (reel > 0 && Math.random() < 0.42) {
      const cand = grid[0].filter(stackable);
      if (cand.length) col[Math.floor(Math.random() * ROWS)] = cand[Math.floor(Math.random() * cand.length)];
    }
    // stacks: 2 or 3 identical rows
    if (Math.random() < 0.22) {
      const s = col.find(stackable) || pick();
      const n = Math.random() < 0.35 ? 3 : 2;
      const start = n === 3 ? 0 : Math.floor(Math.random() * 2);
      for (let r = start; r < start + n; r++) col[r] = s;
    }
  }
  // avoid more than one scatter/bonus per reel (classic rule, keeps visuals clean)
  for (const col of grid) {
    let seen = false;
    for (let r = 0; r < ROWS; r++) {
      const s = col[r];
      if (s === 'scatter' || s === 'bonus') { if (seen) col[r] = pick(); else seen = true; }
    }
  }
  return grid;
}

/** Returns { total, lines:[{line, symbol, count, pay, cells}], scatters, bonuses, cells } — pay in credits for `bet` (total bet). */
export function evaluate(grid, bet) {
  const lineBet = bet / PAYLINES.length;
  const lines = [];
  const cells = [];
  PAYLINES.forEach((pl, li) => {
    const seq = pl.map((row, reel) => grid[reel][row]);
    // determine base symbol (first non-wild)
    let base = seq.find(s => !SYMBOLS[s].wild && !SYMBOLS[s].scatter && !SYMBOLS[s].bonus);
    if (!base) base = 'wild';
    let count = 0;
    for (let i = 0; i < REELS; i++) {
      const s = seq[i];
      if (s === base || (SYMBOLS[s].wild && !SYMBOLS[base].scatter && !SYMBOLS[base].bonus)) count++; else break;
    }
    // pure wild line pays as wild
    const wildRun = seq.findIndex(s => !SYMBOLS[s].wild);
    const wildCount = wildRun === -1 ? REELS : wildRun;
    let symbol = base, c = count;
    if (wildCount >= 3 && SYMBOLS.wild.pays[wildCount - 1] > SYMBOLS[base].pays[count - 1]) { symbol = 'wild'; c = wildCount; }
    const mult = SYMBOLS[symbol].pays[c - 1] || 0;
    if (mult > 0) {
      const pay = Math.round(mult * lineBet);
      const lc = pl.slice(0, c).map((row, reel) => [reel, row]);
      lines.push({ line: li, symbol, count: c, pay, cells: lc });
      cells.push(...lc);
    }
  });
  let scatters = 0, bonuses = 0;
  const scCells = [], boCells = [];
  grid.forEach((col, reel) => col.forEach((s, row) => { if (s === 'scatter') { scatters++; scCells.push([reel, row]); } if (s === 'bonus') { bonuses++; boCells.push([reel, row]); } }));
  let scatterPay = 0;
  if (scatters >= 3) { scatterPay = Math.round(SYMBOLS.scatter.pays[scatters - 1] * bet); cells.push(...scCells); }
  let bonusPay = 0;
  if (bonuses >= 3) { bonusPay = Math.round(bet * (bonuses === 3 ? 20 : bonuses === 4 ? 50 : 150)); cells.push(...boCells); }
  const totalWin = lines.reduce((s, l) => s + l.pay, 0) + scatterPay + bonusPay;
  return { total: totalWin, lines, scatters, bonuses, scatterPay, bonusPay, cells, scatterCells: scCells, bonusCells: boCells };
}

/* ---------------- ADMIN / DEBUG: forced outcomes ---------------- */
const filler = () => { let s; do { s = pick(); } while (SYMBOLS[s].wild || SYMBOLS[s].scatter || SYMBOLS[s].bonus); return s; };
function blank() { return Array.from({ length: REELS }, () => Array.from({ length: ROWS }, filler)); }
function noWin(bet) { for (let i = 0; i < 500; i++) { const g = blank(); if (evaluate(g, bet).total === 0) return g; } return blank(); }

/** kind: lose | small | medium | big | mega | bonus | scatter | anticipation | win */
export function forcedOutcome(kind, bet) {
  const tierOf = g => { const m = evaluate(g, bet).total / bet; return m <= 0 ? 'lose' : m < 5 ? 'small' : m < 15 ? 'medium' : m < 40 ? 'big' : 'mega'; };
  // 1) try random search first (keeps results natural-looking)
  if (['lose', 'small', 'medium', 'big', 'mega'].includes(kind)) {
    for (let i = 0; i < 4000; i++) { const g = generateOutcome(); if (tierOf(g) === kind) return g; }
  }
  if (kind === 'win') { for (let i = 0; i < 500; i++) { const g = generateOutcome(); if (evaluate(g, bet).total > 0) return g; } }
  // 2) crafted fallbacks (middle row = payline 0)
  const g = noWin(bet);
  const row = (sym, n = REELS, r = 1) => { for (let i = 0; i < n; i++) g[i][r] = sym; };
  switch (kind) {
    case 'small':  row('ten', 3); break;
    case 'medium': row('rock', 4); break;
    case 'big':    row('lilypad', 5); break;
    case 'mega':   row('wild', 5, 0); row('wild', 5, 1); row('wild', 5, 2); break;
    case 'bonus':  g[0][0] = 'bonus'; g[2][1] = 'bonus'; g[4][2] = 'bonus'; break;
    case 'scatter': g[0][1] = 'scatter'; g[1][2] = 'scatter'; g[3][0] = 'scatter'; break;
    case 'anticipation': g[0][0] = 'scatter'; g[1][2] = 'scatter'; break; // 2 scatters → reels 3-5 slow down, no win
    case 'win': row('frog', 3); break;
    case 'lose': default: return g;
  }
  return g;
}
