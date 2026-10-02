// Reel engine — 5x3, canvas-rendered, physics-like stop (fast → decel → bounce → settle)
import { REELS, ROWS, CELL_W, CELL_H, WEIGHTS, STRIP_LENGTH, TIMING } from './config.js';
import { symbolPath, getImage } from './assets.js';
import { events } from './events.js';

const TAU = Math.PI * 2;
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
const easeInOutSine = t => -(Math.cos(Math.PI * t) - 1) / 2;

function weightedStrip() {
  const ids = Object.keys(WEIGHTS);
  const total = ids.reduce((s, k) => s + WEIGHTS[k], 0);
  const strip = [];
  for (let i = 0; i < STRIP_LENGTH; i++) {
    let r = Math.random() * total;
    for (const id of ids) { r -= WEIGHTS[id]; if (r <= 0) { strip.push(id); break; } }
  }
  return strip;
}

export class ReelEngine {
  constructor(canvas, particles) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = particles;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = CELL_W * REELS * this.dpr; canvas.height = CELL_H * ROWS * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.reels = Array.from({ length: REELS }, (_, i) => ({
      i, strip: weightedStrip(), pos: Math.floor(Math.random() * STRIP_LENGTH), speed: 0,
      state: 'idle', t: 0, from: 0, to: 0, dur: 0, blur: 0, wobble: 0,
    }));
    this.time = 0;
    this.spinning = false;
    this.highlight = null;     // { cells: Set("r,c"), mode: 'win' | 'highlight' }
    this.hlPhase = 0;
    this.turbo = false;
    this.anticipation = false;
    this.onAllStopped = null;
  }

  grid() { // visible symbols [reel][row]
    return this.reels.map(r => Array.from({ length: ROWS }, (_, row) => r.strip[(Math.floor(r.pos) + row + STRIP_LENGTH * 4) % STRIP_LENGTH]));
  }

  /** Start a spin that will land on `result` ([reel][row] symbol ids). */
  spin(result, onAllStopped) {
    if (this.spinning) return;
    this.spinning = true; this.highlight = null; this.onAllStopped = onAllStopped;
    const T = this.turbo ? TIMING.turbo : TIMING.normal;
    this.result = result;
    this.anticipation = false;
    const scattersBefore = (n) => result.slice(0, n).flat().filter(s => s === 'scatter' || s === 'bonus').length;
    this.reels.forEach((r, i) => {
      r.state = 'pull'; r.t = 0; r.dur = 120 + i * 40; r.startDelay = i * 45;
      r.pos = Math.floor(r.pos);
      r.from = r.pos;
      // stop schedule: extra anticipation if 2 special symbols already landed before this reel
      const anticip = i >= 2 && scattersBefore(i) >= 2 ? 900 : 0;
      r.stopAt = T.accel + T.spinMin + i * T.stagger + anticip;
      r.anticip = anticip > 0;
      r.landed = false;
    });
    events.emit('spin');
  }

  update(dtMs) {
    this.time += dtMs;
    this.hlPhase += dtMs / 1000;
    if (!this.spinning) return;
    const T = this.turbo ? TIMING.turbo : TIMING.normal;
    const MAX_SPEED = this.turbo ? 0.034 : 0.026; // symbols per ms
    let allStopped = true;
    for (const r of this.reels) {
      r.t += dtMs;
      switch (r.state) {
        case 'pull': { // small upward pull-back before launch
          const k = Math.min(1, Math.max(0, (r.t - r.startDelay) / 140));
          r.pos = r.from - 0.18 * Math.sin(k * Math.PI);
          if (k >= 1) { r.state = 'accel'; r.t = 0; r.pos = r.from; }
          allStopped = false; break;
        }
        case 'accel': {
          const k = Math.min(1, r.t / T.accel);
          r.speed = MAX_SPEED * k * k;
          r.pos += r.speed * dtMs; r.blur = k;
          if (k >= 1) { r.state = 'spin'; r.t = 0; r.elapsed = T.accel; }
          allStopped = false; break;
        }
        case 'spin': {
          r.elapsed += dtMs;
          r.pos += MAX_SPEED * dtMs; r.blur = 1;
          if (r.elapsed >= r.stopAt) {
            // plant the result just ahead and glide onto it
            const D = 4; // symbols to travel while decelerating
            const target = Math.ceil(r.pos) + D;
            for (let row = 0; row < ROWS; row++) r.strip[(target + row) % STRIP_LENGTH] = this.result[r.i][row];
            // scrub the symbol just above/below the window so no accidental 4-in-a-row visuals
            r.state = 'decel'; r.t = 0; r.from = r.pos; r.to = target; r.dur = T.decel + D * 60;
            if (r.anticip) this.anticipation = true;
          }
          allStopped = false; break;
        }
        case 'decel': {
          const k = Math.min(1, r.t / r.dur);
          const e = easeOutCubic(k);
          r.pos = r.from + (r.to - r.from) * e;
          r.blur = 1 - e;
          if (k >= 1) { r.state = 'bounce'; r.t = 0; r.pos = r.to; this.land(r); }
          allStopped = false; break;
        }
        case 'bounce': { // overshoot forward then settle back
          const dur = 260; const k = Math.min(1, r.t / dur);
          const amp = 0.22;
          r.pos = r.to + amp * Math.sin(k * Math.PI) * (1 - k * 0.5);
          r.blur = 0;
          if (k >= 1) { r.state = 'settle'; r.t = 0; }
          allStopped = false; break;
        }
        case 'settle': {
          const dur = 160; const k = Math.min(1, r.t / dur);
          r.pos = r.to + 0.05 * Math.sin(k * TAU) * (1 - k);
          if (k >= 1) { r.state = 'idle'; r.pos = r.to; }
          allStopped = false; break;
        }
      }
      r.pos = ((r.pos % STRIP_LENGTH) + STRIP_LENGTH) % STRIP_LENGTH;
      if (r.state === 'idle' && r.to !== undefined) r.pos = ((r.to % STRIP_LENGTH) + STRIP_LENGTH) % STRIP_LENGTH;
    }
    if (allStopped) {
      this.spinning = false; this.anticipation = false;
      const cb = this.onAllStopped; this.onAllStopped = null;
      cb && cb(this.grid());
    }
  }

  land(r) {
    r.landed = true;
    events.emit('reelStop', { reel: r.i });
    const rect = this.canvas.getBoundingClientRect();
    // particles: little water droplets at the base of the reel (stage coords computed by caller via offset)
    if (this.spawnAt) {
      const x = (r.i + 0.5) * CELL_W, y = ROWS * CELL_H - 10;
      this.spawnAt('droplet', x, y, 6, 40);
      for (let row = 0; row < ROWS; row++) {
        const s = this.result[r.i][row];
        if (s === 'scatter' || s === 'bonus' || s === 'wild' || s === 'prize') {
          events.emit('symbolLand', { reel: r.i, row, symbol: s });
          this.spawnAt('sparkle', (r.i + 0.5) * CELL_W, (row + 0.5) * CELL_H, 10, 50);
        }
      }
    }
    void rect;
  }

  /** Highlight winning cells. cells: array of [reel,row]. */
  setHighlight(cells, mode = 'win') {
    this.highlight = cells ? { cells: new Set(cells.map(c => c.join(','))), mode } : null;
    this.hlPhase = 0;
  }

  draw() {
    const g = this.ctx;
    const W = CELL_W * REELS, H = CELL_H * ROWS;
    g.clearRect(0, 0, W, H);
    const hd = this.dpr > 1.2;
    const pulse = 0.5 + 0.5 * Math.sin(this.hlPhase * 6);

    for (const r of this.reels) {
      const x0 = r.i * CELL_W;
      const frac = r.pos - Math.floor(r.pos);
      const base = Math.floor(r.pos);
      g.save();
      g.beginPath(); g.rect(x0, 0, CELL_W, H); g.clip();
      // anticipation glow on reels still spinning
      if (this.anticipation && r.state !== 'idle' && r.state !== 'bounce' && r.state !== 'settle') {
        const grd = g.createLinearGradient(x0, 0, x0 + CELL_W, 0);
        grd.addColorStop(0, 'rgba(139,92,246,0)'); grd.addColorStop(0.5, `rgba(139,92,246,${0.25 + 0.2 * pulse})`); grd.addColorStop(1, 'rgba(139,92,246,0)');
        g.fillStyle = grd; g.fillRect(x0, 0, CELL_W, H);
      }
      for (let row = -1; row <= ROWS; row++) {
        const idx = ((base + row) % STRIP_LENGTH + STRIP_LENGTH) % STRIP_LENGTH;
        const id = r.strip[idx];
        const y = (row - frac) * CELL_H;
        const img = (hd && getImage(symbolPath(id, true))) || getImage(symbolPath(id));
        if (!img) continue;
        const cx = x0 + CELL_W / 2, cy = y + CELL_H / 2;
        const key = `${r.i},${row}`;
        const hl = this.highlight;
        const isWin = hl && hl.cells.has(key) && r.state === 'idle';
        const isDisabled = hl && !hl.cells.has(key) && r.state === 'idle';
        let size = 116;
        let alpha = 1;
        if (isWin) size = 116 + 10 * pulse;
        if (isDisabled) alpha = 0.38;

        if (r.blur > 0.35) {
          // simulated motion blur: stretched ghosts
          const stretch = 1 + 0.35 * r.blur;
          g.globalAlpha = 0.28;
          g.drawImage(img, cx - size / 2, cy - (size * stretch) / 2 - 18 * r.blur, size, size * stretch);
          g.drawImage(img, cx - size / 2, cy - (size * stretch) / 2 + 18 * r.blur, size, size * stretch);
          g.globalAlpha = 0.75;
          g.drawImage(img, cx - size / 2, cy - (size * stretch) / 2, size, size * stretch);
          g.globalAlpha = 1;
        } else {
          if (isWin) {
            // glow ring behind winning symbol
            const grd = g.createRadialGradient(cx, cy, 10, cx, cy, 70);
            grd.addColorStop(0, `rgba(255,201,48,${0.45 + 0.3 * pulse})`); grd.addColorStop(1, 'rgba(255,201,48,0)');
            g.fillStyle = grd; g.fillRect(cx - 70, cy - 70, 140, 140);
            g.strokeStyle = `rgba(255,243,196,${0.6 + 0.4 * pulse})`; g.lineWidth = 3;
            roundRect(g, x0 + 5, y + 4, CELL_W - 10, CELL_H - 8, 14); g.stroke();
          }
          g.globalAlpha = alpha;
          if (isDisabled) g.filter = 'grayscale(70%)';
          g.drawImage(img, cx - size / 2, cy - size / 2, size, size);
          g.filter = 'none';
          g.globalAlpha = 1;
          // soft shadow under symbol (depth)
          if (!isDisabled) {
            g.fillStyle = 'rgba(6,32,46,.25)';
            g.beginPath(); g.ellipse(cx, cy + size * 0.46, size * 0.3, 5, 0, 0, TAU); g.fill();
          }
        }
      }
      g.restore();
    }
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
