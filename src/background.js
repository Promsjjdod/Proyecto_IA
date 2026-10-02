// Procedural tropical swamp background — 3 independently animated layers.
// BACK: sky, mist, far jungle (rendered once, cheap parallax drift)
// MID:  water with caustics, reflections, ripples, bubbles, fireflies
// FRONT: lily pads, flowers, reeds, big leaves swaying

const W = 1280, H = 720;
const TAU = Math.PI * 2;

function rand(a, b) { return a + Math.random() * (b - a); }

export class Background {
  constructor(back, mid, front, quality = 'high') {
    this.cb = back.getContext('2d');
    this.cm = mid.getContext('2d');
    this.cf = front.getContext('2d');
    this.quality = quality;
    this.t = 0;
    this.buildStatic();
    this.buildDynamic();
  }

  setQuality(q) { this.quality = q; this.buildDynamic(); }

  /* ---------- BACK LAYER (offscreen, static) ---------- */
  buildStatic() {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    // sky
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0b2a3d');
    sky.addColorStop(0.35, '#0e7490');
    sky.addColorStop(0.5, '#22b8d8');
    sky.addColorStop(1, '#06202e');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    // warm glow horizon
    const glow = g.createRadialGradient(640, 300, 20, 640, 300, 620);
    glow.addColorStop(0, 'rgba(255,231,163,.45)');
    glow.addColorStop(0.4, 'rgba(255,201,48,.12)');
    glow.addColorStop(1, 'rgba(255,201,48,0)');
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    // far jungle silhouettes (two rows)
    this.drawJungle(g, 330, '#0a3d4a', 1.0);
    this.drawJungle(g, 372, '#0c5363', 0.8);
    // mist band
    const mist = g.createLinearGradient(0, 300, 0, 420);
    mist.addColorStop(0, 'rgba(165,243,252,0)');
    mist.addColorStop(0.5, 'rgba(165,243,252,.22)');
    mist.addColorStop(1, 'rgba(165,243,252,0)');
    g.fillStyle = mist; g.fillRect(0, 300, W, 120);
    // light rays
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const x = 320 + i * 130;
      const r = g.createLinearGradient(x, 0, x + 120, 420);
      r.addColorStop(0, 'rgba(255,248,231,.10)');
      r.addColorStop(1, 'rgba(255,248,231,0)');
      g.fillStyle = r;
      g.beginPath(); g.moveTo(x, -20); g.lineTo(x + 70, -20); g.lineTo(x + 230, 460); g.lineTo(x + 80, 460); g.closePath(); g.fill();
    }
    g.restore();
    this.staticCanvas = c;
    this.cb.drawImage(c, 0, 0);
  }

  drawJungle(g, baseY, color, scale) {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, H);
    let x = 0;
    let seed = 7;
    const r = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    while (x < W) {
      const w = (40 + r() * 70) * scale;
      const h = (40 + r() * 110) * scale;
      // rounded tree canopy
      g.lineTo(x, baseY);
      g.quadraticCurveTo(x + w * 0.5, baseY - h, x + w, baseY);
      x += w * 0.8;
    }
    g.lineTo(W, H);
    g.closePath();
    g.fill();
    // trunks hint
    g.fillStyle = 'rgba(0,0,0,.15)';
    g.fillRect(0, baseY + 10, W, 60);
  }

  /* ---------- DYNAMIC ELEMENTS ---------- */
  buildDynamic() {
    const q = this.quality === 'low' ? 0.5 : this.quality === 'medium' ? 0.75 : 1;
    this.bubbles = Array.from({ length: Math.round(22 * q) }, () => this.newBubble(true));
    this.fireflies = Array.from({ length: Math.round(16 * q) }, () => ({ x: rand(0, W), y: rand(120, 520), ph: rand(0, TAU), sp: rand(0.3, 0.8), r: rand(2, 3.5) }));
    this.ripples = [];
    this.caustics = Array.from({ length: Math.round(28 * q) }, () => ({ x: rand(0, W), y: rand(400, H), rx: rand(40, 110), ry: rand(8, 20), ph: rand(0, TAU), sp: rand(0.4, 1) }));
    // lily pads in foreground, keep center bottom free for controls visibility (they sit behind the UI anyway)
    this.pads = [
      { x: 70, y: 600, r: 78, rot: 0.3, flower: 'pink' },
      { x: 190, y: 660, r: 56, rot: 1.7, flower: null },
      { x: 1200, y: 610, r: 82, rot: 2.4, flower: 'violet' },
      { x: 1080, y: 672, r: 52, rot: 0.9, flower: null },
      { x: 300, y: 450, r: 36, rot: 2.1, flower: null },
      { x: 990, y: 440, r: 34, rot: 0.2, flower: 'pink' },
    ];
    this.reeds = [];
    for (let i = 0; i < 9; i++) this.reeds.push({ x: 20 + i * 14 + rand(-6, 6), h: rand(170, 300), ph: rand(0, TAU), side: 'L' });
    for (let i = 0; i < 9; i++) this.reeds.push({ x: W - 20 - i * 14 + rand(-6, 6), h: rand(170, 300), ph: rand(0, TAU), side: 'R' });
    this.leaves = [
      { x: -30, y: 240, s: 1.4, rot: -0.5, ph: 0 },
      { x: W + 30, y: 220, s: 1.5, rot: Math.PI + 0.5, ph: 1.2 },
      { x: 30, y: 420, s: 1.0, rot: -0.9, ph: 2.1 },
      { x: W - 30, y: 410, s: 1.1, rot: Math.PI + 0.9, ph: 0.6 },
    ];
  }

  newBubble(randomY = false) {
    return { x: rand(0, W), y: randomY ? rand(400, H) : H + 10, r: rand(2, 6), sp: rand(12, 30), wob: rand(0, TAU) };
  }

  addRipple(x, y) { this.ripples.push({ x, y, r: 4, a: 0.6 }); }

  /* ---------- FRAME ---------- */
  update(dt) {
    this.t += dt;
    for (const b of this.bubbles) {
      b.y -= b.sp * dt; b.wob += dt * 2;
      if (b.y < 380) Object.assign(b, this.newBubble());
    }
    for (const f of this.fireflies) {
      f.ph += dt * f.sp;
      f.x += Math.cos(f.ph * 0.7) * 12 * dt;
      f.y += Math.sin(f.ph) * 8 * dt;
      if (f.x < -10) f.x = W + 10; if (f.x > W + 10) f.x = -10;
    }
    if (Math.random() < dt * 0.9) this.addRipple(rand(0, W), rand(430, H - 20));
    for (const r of this.ripples) { r.r += 26 * dt; r.a -= 0.35 * dt; }
    this.ripples = this.ripples.filter(r => r.a > 0);
  }

  draw() {
    this.drawMid();
    this.drawFront();
  }

  drawMid() {
    const g = this.cm; const t = this.t;
    g.clearRect(0, 0, W, H);
    // water body
    const water = g.createLinearGradient(0, 380, 0, H);
    water.addColorStop(0, 'rgba(34,211,238,.65)');
    water.addColorStop(0.25, 'rgba(14,116,144,.85)');
    water.addColorStop(1, 'rgba(6,32,46,.95)');
    g.fillStyle = water;
    g.beginPath();
    g.moveTo(0, 392);
    for (let x = 0; x <= W; x += 40) g.lineTo(x, 392 + Math.sin(x * 0.012 + t * 1.2) * 3);
    g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fill();
    // shoreline highlight
    g.strokeStyle = 'rgba(165,243,252,.55)'; g.lineWidth = 2;
    g.beginPath();
    for (let x = 0; x <= W; x += 20) { const y = 392 + Math.sin(x * 0.012 + t * 1.2) * 3; x === 0 ? g.moveTo(x, y) : g.lineTo(x, y); }
    g.stroke();
    // caustics / reflections
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const c of this.caustics) {
      const a = 0.06 + 0.06 * Math.sin(t * c.sp + c.ph);
      const dx = Math.sin(t * 0.5 + c.ph) * 12;
      g.fillStyle = `rgba(165,243,252,${a.toFixed(3)})`;
      g.beginPath(); g.ellipse(c.x + dx, c.y, c.rx, c.ry, 0, 0, TAU); g.fill();
    }
    // light streak reflections under center
    for (let i = 0; i < 5; i++) {
      const y = 430 + i * 50;
      const a = 0.05 + 0.04 * Math.sin(t * 1.5 + i);
      g.fillStyle = `rgba(255,231,163,${a.toFixed(3)})`;
      g.fillRect(560 + Math.sin(t + i) * 20, y, 160, 3);
    }
    g.restore();
    // ripples
    for (const r of this.ripples) {
      g.strokeStyle = `rgba(165,243,252,${r.a.toFixed(3)})`; g.lineWidth = 1.5;
      g.beginPath(); g.ellipse(r.x, r.y, r.r, r.r * 0.35, 0, 0, TAU); g.stroke();
    }
    // bubbles
    for (const b of this.bubbles) {
      const x = b.x + Math.sin(b.wob) * 4;
      g.strokeStyle = 'rgba(165,243,252,.7)'; g.lineWidth = 1.2;
      g.beginPath(); g.arc(x, b.y, b.r, 0, TAU); g.stroke();
      g.fillStyle = 'rgba(255,255,255,.7)'; g.beginPath(); g.arc(x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.25, 0, TAU); g.fill();
    }
    // fireflies (glow + core)
    g.save(); g.globalCompositeOperation = 'lighter';
    for (const f of this.fireflies) {
      const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(f.ph * 2.3));
      const grd = g.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * 5);
      grd.addColorStop(0, `rgba(255,236,120,${(a * 0.9).toFixed(3)})`);
      grd.addColorStop(0.3, `rgba(255,201,48,${(a * 0.35).toFixed(3)})`);
      grd.addColorStop(1, 'rgba(255,201,48,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(f.x, f.y, f.r * 5, 0, TAU); g.fill();
      g.fillStyle = `rgba(255,255,220,${a.toFixed(3)})`; g.beginPath(); g.arc(f.x, f.y, f.r * 0.6, 0, TAU); g.fill();
    }
    g.restore();
  }

  drawFront() {
    const g = this.cf; const t = this.t;
    g.clearRect(0, 0, W, H);
    // big tropical leaves at edges
    for (const l of this.leaves) {
      const sway = Math.sin(t * 0.8 + l.ph) * 0.05;
      this.drawLeaf(g, l.x, l.y, l.s, l.rot + sway);
    }
    // reeds
    for (const r of this.reeds) {
      const sway = Math.sin(t * 1.1 + r.ph) * 10;
      const baseY = 470 + (r.side === 'L' ? (r.x % 30) : (r.x % 25));
      g.lineWidth = 6; g.strokeStyle = '#1b2a1f';
      g.beginPath(); g.moveTo(r.x, baseY); g.quadraticCurveTo(r.x + sway * 0.4, baseY - r.h * 0.6, r.x + sway, baseY - r.h); g.stroke();
      g.lineWidth = 3; g.strokeStyle = '#3f9d4c';
      g.beginPath(); g.moveTo(r.x, baseY); g.quadraticCurveTo(r.x + sway * 0.4, baseY - r.h * 0.6, r.x + sway, baseY - r.h); g.stroke();
      // cattail head
      g.fillStyle = '#7c4a1e'; g.strokeStyle = '#1b2a1f'; g.lineWidth = 2;
      g.beginPath(); g.ellipse(r.x + sway, baseY - r.h - 10, 4, 14, sway * 0.02, 0, TAU); g.fill(); g.stroke();
    }
    // lily pads + flowers
    for (const p of this.pads) {
      const bob = Math.sin(t * 1.3 + p.x) * 2;
      const rot = p.rot + Math.sin(t * 0.6 + p.y) * 0.04;
      this.drawPad(g, p.x, p.y + bob, p.r, rot);
      if (p.flower) this.drawFlower(g, p.x - p.r * 0.25, p.y + bob - p.r * 0.25, p.r * 0.42, p.flower, t);
    }
    // small sparkles on water near pads (subtle)
    g.save(); g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const a = Math.max(0, Math.sin(t * 2 + i * 1.3));
      g.fillStyle = `rgba(255,255,255,${(a * 0.55).toFixed(3)})`;
      const x = 120 + i * 210 + Math.sin(i) * 30, y = 520 + (i % 3) * 40;
      g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x + 1.5, y); g.lineTo(x, y + 4); g.lineTo(x - 1.5, y); g.closePath(); g.fill();
    }
    g.restore();
  }

  drawPad(g, x, y, r, rot) {
    g.save(); g.translate(x, y); g.rotate(rot);
    const grd = g.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    grd.addColorStop(0, '#86efac'); grd.addColorStop(0.5, '#22c55e'); grd.addColorStop(1, '#14532d');
    g.fillStyle = grd; g.strokeStyle = '#1b2a1f'; g.lineWidth = 3.5;
    g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, r, 0.25, TAU - 0.25); g.closePath();
    g.save(); g.scale(1, 0.62); g.fill(); g.restore();
    g.beginPath(); g.save(); g.scale(1, 0.62); g.moveTo(0, 0); g.arc(0, 0, r, 0.25, TAU - 0.25); g.closePath(); g.restore(); g.stroke();
    // veins
    g.strokeStyle = 'rgba(20,83,45,.5)'; g.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) { const a = 0.6 + i * 0.85; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.55); g.stroke(); }
    // highlight
    g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.ellipse(-r * 0.35, -r * 0.2, r * 0.25, r * 0.08, -0.4, 0, TAU); g.fill();
    g.restore();
  }

  drawFlower(g, x, y, r, kind, t) {
    const col = kind === 'pink' ? ['#fda4cf', '#f43f8e'] : ['#c4b5fd', '#8b5cf6'];
    g.save(); g.translate(x, y);
    const open = 1 + Math.sin(t * 1.6 + x) * 0.04;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + Math.sin(t + i) * 0.03;
      g.save(); g.rotate(a);
      const grd = g.createLinearGradient(0, 0, r * open, 0);
      grd.addColorStop(0, col[1]); grd.addColorStop(1, col[0]);
      g.fillStyle = grd; g.strokeStyle = '#1b2a1f'; g.lineWidth = 2;
      g.beginPath(); g.ellipse(r * 0.55 * open, 0, r * 0.55 * open, r * 0.22, 0, 0, TAU); g.fill(); g.stroke();
      g.restore();
    }
    g.fillStyle = '#ffc930'; g.strokeStyle = '#1b2a1f'; g.lineWidth = 2;
    g.beginPath(); g.arc(0, 0, r * 0.25, 0, TAU); g.fill(); g.stroke();
    g.restore();
  }

  drawLeaf(g, x, y, s, rot) {
    g.save(); g.translate(x, y); g.rotate(rot); g.scale(s, s);
    const grd = g.createLinearGradient(0, -40, 160, 40);
    grd.addColorStop(0, '#14532d'); grd.addColorStop(0.6, '#22c55e'); grd.addColorStop(1, '#86efac');
    g.fillStyle = grd; g.strokeStyle = '#1b2a1f'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(40, -70, 140, -60, 170, -4); g.bezierCurveTo(140, 50, 40, 60, 0, 0); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(20,83,45,.6)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(165, -4); g.stroke();
    for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(i * 26, -i * 0.6); g.lineTo(i * 26 + 18, -28 + i * 2); g.moveTo(i * 26, -i * 0.6); g.lineTo(i * 26 + 18, 24 - i * 2); g.stroke(); }
    g.restore();
  }
}
