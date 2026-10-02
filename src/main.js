// TINY TOADS — main orchestrator (fictional arcade slot demo, virtual credits only)
import { BET_STEPS, START_CREDITS, WIN_TIERS, TOADS, CELL_W, CELL_H } from './config.js';
import { preload, warmHD } from './assets.js';
import { Background } from './background.js';
import { Particles } from './particles.js';
import { ReelEngine } from './reels.js';
import { generateOutcome, evaluate } from './outcome.js';
import { Toad } from './characters.js';
import { UI, fmt } from './ui.js';
import { events, AUDIO_HOOKS } from './events.js';

const stage = document.getElementById('stage');
const state = {
  credits: Number(localStorage.getItem('tt_credits')) || START_CREDITS,
  betIndex: 1,
  busy: false,
  auto: 0,
  quality: localStorage.getItem('tt_quality') || 'high',
  lastWin: 0,
};
const bet = () => BET_STEPS[state.betIndex];

/* ---------- Responsive stage scale ---------- */
function fit() {
  const vw = window.innerWidth, vh = window.innerHeight - 18; // leave room for disclaimer
  const s = Math.min(vw / 1280, vh / 720);
  stage.style.setProperty('--scale', s.toFixed(4));
}
window.addEventListener('resize', fit); fit();

/* ---------- Boot ---------- */
const loaderFill = document.getElementById('loaderFill');
const loaderEl = document.getElementById('loader');
const showBootError = (msg) => { const h = loaderEl.querySelector('.loader__hint'); h.textContent = 'Error al iniciar: ' + msg; h.style.color = '#f43f8e'; console.error(msg); };
window.addEventListener('error', (e) => { if (!loaderEl.classList.contains('is-hidden')) showBootError(e.message); });
try {
  // never block the game on slow/missing images: hard timeout of 8 s
  await Promise.race([
    preload(p => { loaderFill.style.width = `${Math.round(p * 100)}%`; }),
    new Promise(r => setTimeout(r, 8000)),
  ]);
} catch (e) { showBootError(e.message); }
loaderFill.style.width = '100%';
loaderEl.classList.add('is-hidden');
warmHD();

const ui = new UI();
const bg = new Background(document.getElementById('bgBack'), document.getElementById('bgMid'), document.getElementById('bgFront'), state.quality);
const fx = new Particles(document.getElementById('fx'));
fx.setQuality(state.quality);
const reels = new ReelEngine(document.getElementById('reels'), fx);

// stage-space position of the reel window (for particles)
const reelOrigin = () => {
  const r = document.getElementById('reelWindow').getBoundingClientRect();
  const s = stage.getBoundingClientRect();
  const scale = s.width / 1280;
  return { x: (r.left - s.left) / scale, y: (r.top - s.top) / scale };
};
reels.spawnAt = (type, x, y, n, spread) => { const o = reelOrigin(); fx.burst(type, o.x + x, o.y + y, n, spread); };

// Characters: two random, distinct toads on each side
let pair = TOADS.slice().sort(() => Math.random() - 0.5).slice(0, 2);
const toadL = new Toad(document.getElementById('toadLeft'), pair[0]);
const toadR = new Toad(document.getElementById('toadRight'), pair[1]);
const toads = [toadL, toadR];

ui.setCredits(state.credits); ui.setBet(bet()); ui.setWin(0);

/* ---------- Visual "audio hooks" (dev log; wire AudioContext here later) ---------- */
const DEBUG_AUDIO = location.hash.includes('debug');
for (const h of AUDIO_HOOKS) events.on(h, (p) => { if (DEBUG_AUDIO) console.log('[audio-hook]', h, p || ''); });

/* ---------- Controls ---------- */
document.getElementById('betMinus').addEventListener('click', () => { if (state.busy) return; state.betIndex = Math.max(0, state.betIndex - 1); ui.setBet(bet()); events.emit('click'); });
document.getElementById('betPlus').addEventListener('click', () => { if (state.busy) return; state.betIndex = Math.min(BET_STEPS.length - 1, state.betIndex + 1); ui.setBet(bet()); events.emit('click'); });
ui.spin.addEventListener('click', () => { events.emit('click'); if (state.auto) { stopAuto(); return; } spin(); });
ui.auto.addEventListener('click', () => { events.emit('click'); if (state.auto) stopAuto(); else { state.auto = 10; ui.auto.setAttribute('aria-pressed', 'true'); ui.autoCount.textContent = state.auto; if (!state.busy) spin(); } });
ui.turbo.addEventListener('click', () => { reels.turbo = !reels.turbo; ui.turbo.setAttribute('aria-pressed', reels.turbo); events.emit('click'); });
window.addEventListener('keydown', (e) => { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); if (!state.busy) spin(); } });

// settings
const selQ = document.getElementById('setQuality'); selQ.value = state.quality;
selQ.addEventListener('change', () => { state.quality = selQ.value; localStorage.setItem('tt_quality', state.quality); bg.setQuality(state.quality); fx.setQuality(state.quality); });
const rm = document.getElementById('setReduceMotion');
rm.addEventListener('change', () => document.body.classList.toggle('reduce-motion', rm.checked));
document.getElementById('btnResetCredits').addEventListener('click', () => { state.credits = START_CREDITS; save(); ui.setCredits(state.credits); ui.message('Créditos virtuales reiniciados'); });

function stopAuto() { state.auto = 0; ui.auto.setAttribute('aria-pressed', 'false'); ui.autoCount.textContent = ''; }
function save() { localStorage.setItem('tt_credits', String(state.credits)); }

/* ---------- Spin flow ---------- */
function spin() {
  if (state.busy) return;
  const b = bet();
  if (state.credits < b) { ui.message('Sin créditos virtuales — usa RESET en ajustes'); stopAuto(); return; }
  state.busy = true;
  ui.hideBanner(); reels.setHighlight(null); ui.machine.classList.remove('is-win');
  state.credits -= b; save(); ui.setCredits(state.credits); ui.setWin(0);
  ui.setSpinState('spinning'); ui.message(state.auto ? `AUTO · ${state.auto} giros restantes` : '¡Buena suerte, Tiny Toads!');
  toads.forEach(t => t.react('spin'));

  const outcome = generateOutcome();
  reels.spin(outcome, (grid) => onStopped(grid));
}

function onStopped(grid) {
  const b = bet();
  const res = evaluate(grid, b);
  if (res.scatters === 2 || res.bonuses === 2) { toads.forEach(t => t.react('nearmiss')); }
  if (res.total <= 0) {
    ui.setSpinState('idle'); ui.message('Casi... ¡gira otra vez!');
    toads.forEach(t => { if (t.state !== 'shocked') t.react('lose'); });
    return finish();
  }
  // --- WIN ---
  const mult = res.total / b;
  const tier = WIN_TIERS.find(t => mult >= t.min && mult < t.max) || WIN_TIERS[0];
  state.credits += res.total; save(); state.lastWin = res.total;
  reels.setHighlight(res.cells, 'win');
  ui.machine.classList.add('is-win'); ui.setSpinState('win');
  events.emit('win', { tier: tier.id, amount: res.total });
  if (res.bonuses >= 3) events.emit('bonus', { count: res.bonuses });
  if (res.scatters >= 3) events.emit('scatter', { count: res.scatters });
  toads.forEach(t => t.react(tier.id));

  const o = reelOrigin();
  const cellCenter = ([r, c]) => [o.x + (r + 0.5) * CELL_W, o.y + (c + 0.5) * CELL_H];
  const msg = `${tier.title} · ${res.lines.length} línea${res.lines.length !== 1 ? 's' : ''}${res.scatters >= 3 ? ' · SCATTER' : ''}${res.bonuses >= 3 ? ' · BONUS' : ''}`;
  ui.message(msg);

  // particles per tier (budgeted)
  const uniq = [...new Set(res.cells.map(c => c.join(',')))].map(s => s.split(',').map(Number));
  for (const cell of uniq) { const [x, y] = cellCenter(cell); fx.burst('sparkle', x, y, tier.id === 'small' ? 4 : 8, 50); }
  let dur = 900;
  if (tier.id === 'small') { dur = 1100; coinRain(6, 500); }
  if (tier.id === 'medium') { dur = 1600; coinRain(14, 900); for (const cell of uniq) { const [x, y] = cellCenter(cell); fx.spawn('glow', x, y); } }
  if (tier.id === 'big') { dur = 3200; ui.showBanner('big', 'BIG WIN', 0); coinRain(30, 2200); starBurst(640, 320, 24); ui.hitJackpot('mini'); }
  if (tier.id === 'mega') { dur = 4600; ui.showBanner('mega', res.bonuses >= 3 ? 'TOAD PARTY!' : 'MEGA WIN', 0); coinRain(60, 3400); starBurst(640, 300, 40); rays = 1; ui.hitJackpot(res.bonuses >= 3 ? 'grand' : 'major'); events.emit('bigWin', { amount: res.total }); }
  if (res.scatters >= 3) ui.hitJackpot('minor');

  ui.countWin(0, res.total, Math.min(dur * 0.8, 2500), () => { ui.setCredits(state.credits); });
  setTimeout(() => { ui.hideBanner(); ui.setSpinState('idle'); rays = 0; toads.forEach(t => t.react('stop')); finish(); }, dur);
}

function finish() {
  state.busy = false;
  if (state.auto > 0) {
    state.auto--; ui.autoCount.textContent = state.auto || '';
    if (state.auto === 0) stopAuto(); else setTimeout(spin, reels.turbo ? 250 : 600);
  }
}

/* ---------- Celebration helpers ---------- */
function coinRain(n, ms) {
  const per = ms / n;
  for (let i = 0; i < n; i++) setTimeout(() => fx.spawn('coin', 240 + Math.random() * 800, -20, { vx: (Math.random() - 0.5) * 120, vy: 80 + Math.random() * 120 }), i * per);
}
function starBurst(x, y, n) { fx.burst('star', x, y, n, 240); fx.burst('sparkle', x, y, n, 180); }

/* ---------- Light rays overlay (mega win) drawn on fx canvas ---------- */
let rays = 0;
const fxCtx = document.getElementById('fx').getContext('2d');
function drawRays(t) {
  if (!rays) return;
  fxCtx.save(); fxCtx.globalCompositeOperation = 'lighter'; fxCtx.translate(640, 330);
  for (let i = 0; i < 12; i++) {
    fxCtx.save(); fxCtx.rotate(t * 0.4 + (i / 12) * Math.PI * 2);
    const grd = fxCtx.createLinearGradient(0, 0, 900, 0);
    grd.addColorStop(0, 'rgba(255,236,120,.28)'); grd.addColorStop(1, 'rgba(255,201,48,0)');
    fxCtx.fillStyle = grd; fxCtx.beginPath(); fxCtx.moveTo(0, 0); fxCtx.lineTo(900, -60); fxCtx.lineTo(900, 60); fxCtx.closePath(); fxCtx.fill();
    fxCtx.restore();
  }
  fxCtx.restore();
}

/* ---------- Idle ambient sparkles on SPIN + jackpots (very light) ---------- */
let ambient = 0;

/* ---------- Main loop (adaptive: skips background redraw when tab hidden) ---------- */
let last = performance.now();
let bgAcc = 0;
function loop(now) {
  const dtMs = Math.min(50, now - last); last = now;
  const dt = dtMs / 1000;
  bg.update(dt);
  bgAcc += dtMs;
  // background at 30fps on low quality, 60fps otherwise
  if (state.quality !== 'low' || bgAcc >= 33) { bg.draw(); bgAcc = 0; }
  reels.update(dtMs); reels.draw();
  fx.update(dt); fx.draw(); drawRays(now / 1000);
  ui.tickJackpots(dt);
  ambient += dt;
  if (ambient > 1.4) { ambient = 0; if (!state.busy) fx.spawn('sparkle', 1100 + Math.random() * 80, 600 + Math.random() * 60, { life: 0.7 }); }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
document.addEventListener('visibilitychange', () => { last = performance.now(); });

console.info('%cTINY TOADS%c demo ficticia · créditos virtuales · sin dinero real', 'font-weight:bold;color:#bef264', 'color:#a5f3fc');
