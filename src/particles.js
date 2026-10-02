// Pooled particle system (max 180 live) — sparkle, bubble, leaf, star, droplet, dust, coin, glow
const TAU = Math.PI * 2;
const MAX = 180;
const rand = (a, b) => a + Math.random() * (b - a);

export class Particles {
  constructor(canvas) {
    this.ctx = canvas.getContext('2d');
    this.W = canvas.width; this.H = canvas.height;
    this.pool = Array.from({ length: MAX }, () => ({ alive: false }));
    this.budget = 1;
  }
  setQuality(q) { this.budget = q === 'low' ? 0.35 : q === 'medium' ? 0.65 : 1; }

  spawn(type, x, y, opts = {}) {
    if (Math.random() > this.budget && type !== 'coin') return;
    const p = this.pool.find(p => !p.alive);
    if (!p) return;
    const base = { alive: true, type, x, y, vx: 0, vy: 0, life: 1, age: 0, size: 6, rot: rand(0, TAU), vr: rand(-3, 3), color: '#fff', g: 0 };
    Object.assign(p, base, PRESETS[type](), opts);
    return p;
  }

  burst(type, x, y, n, spread = 60, opts = {}) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(0.2, 1) * spread;
      this.spawn(type, x + Math.cos(a) * s * 0.3, y + Math.sin(a) * s * 0.3, { vx: Math.cos(a) * s * 2, vy: Math.sin(a) * s * 2 - spread, ...opts });
    }
  }

  update(dt) {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) { p.alive = false; continue; }
      p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      if (p.type === 'leaf' || p.type === 'bubble') p.x += Math.sin(p.age * 4 + p.rot) * 20 * dt;
    }
  }

  draw() {
    const g = this.ctx;
    g.clearRect(0, 0, this.W, this.H);
    for (const p of this.pool) {
      if (!p.alive) continue;
      const k = p.age / p.life;
      const alpha = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
      g.save(); g.globalAlpha = Math.max(0, alpha); g.translate(p.x, p.y); g.rotate(p.rot);
      DRAW[p.type](g, p, k);
      g.restore();
    }
  }
}

const PRESETS = {
  sparkle: () => ({ size: rand(4, 9), life: rand(0.5, 1), color: '#ffffff', vr: rand(-4, 4) }),
  star:    () => ({ size: rand(6, 12), life: rand(0.8, 1.4), color: '#ffc930', g: 120 }),
  bubble:  () => ({ size: rand(3, 8), life: rand(1.2, 2.2), vy: rand(-60, -30), color: '#a5f3fc' }),
  leaf:    () => ({ size: rand(6, 11), life: rand(2, 3.5), vy: rand(30, 60), vr: rand(-2, 2), color: '#22c55e' }),
  droplet: () => ({ size: rand(3, 5), life: rand(0.5, 0.9), g: 500, color: '#22d3ee' }),
  dust:    () => ({ size: rand(2, 4), life: rand(1, 2), vy: rand(-20, -5), color: '#ffe7a3' }),
  coin:    () => ({ size: rand(10, 16), life: rand(1.2, 1.8), g: 700, vr: rand(-6, 6) }),
  glow:    () => ({ size: rand(14, 30), life: rand(0.6, 1.2), color: '#ffc930' }),
};

const DRAW = {
  sparkle(g, p) { starPath(g, p.size, 4, 0.35); g.fillStyle = p.color; g.fill(); },
  star(g, p) { starPath(g, p.size, 5, 0.5); g.fillStyle = p.color; g.strokeStyle = '#1b2a1f'; g.lineWidth = 1.5; g.fill(); g.stroke(); },
  bubble(g, p) { g.strokeStyle = p.color; g.lineWidth = 1.3; g.beginPath(); g.arc(0, 0, p.size, 0, TAU); g.stroke(); g.fillStyle = 'rgba(255,255,255,.8)'; g.beginPath(); g.arc(-p.size * .35, -p.size * .35, p.size * .25, 0, TAU); g.fill(); },
  leaf(g, p) { g.fillStyle = p.color; g.strokeStyle = '#1b2a1f'; g.lineWidth = 1.2; g.beginPath(); g.ellipse(0, 0, p.size, p.size * .45, 0, 0, TAU); g.fill(); g.stroke(); },
  droplet(g, p) { g.fillStyle = p.color; g.beginPath(); g.arc(0, 0, p.size, 0, TAU); g.fill(); g.fillStyle = 'rgba(255,255,255,.8)'; g.beginPath(); g.arc(-p.size * .3, -p.size * .3, p.size * .3, 0, TAU); g.fill(); },
  dust(g, p) { g.fillStyle = p.color; g.beginPath(); g.arc(0, 0, p.size, 0, TAU); g.fill(); },
  glow(g, p, k) { const r = p.size * (1 + k); const grd = g.createRadialGradient(0, 0, 0, 0, 0, r); grd.addColorStop(0, 'rgba(255,236,120,.7)'); grd.addColorStop(1, 'rgba(255,201,48,0)'); g.fillStyle = grd; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill(); },
  coin(g, p) {
    const w = Math.abs(Math.cos(p.rot * 2)) * p.size + 2;
    g.rotate(-p.rot); // keep upright, fake 3D flip via width
    const grd = g.createLinearGradient(0, -p.size, 0, p.size);
    grd.addColorStop(0, '#fff3c4'); grd.addColorStop(0.5, '#ffc930'); grd.addColorStop(1, '#c77a00');
    g.fillStyle = grd; g.strokeStyle = '#1b2a1f'; g.lineWidth = 2;
    g.beginPath(); g.ellipse(0, 0, w, p.size, 0, 0, TAU); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(199,122,0,.8)'; g.lineWidth = 1.5; g.beginPath(); g.ellipse(0, 0, w * .6, p.size * .6, 0, 0, TAU); g.stroke();
  },
};

function starPath(g, r, n, inner) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * TAU - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * inner;
    i === 0 ? g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr) : g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  g.closePath();
}
