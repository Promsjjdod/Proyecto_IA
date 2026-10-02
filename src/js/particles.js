// ============================================================================
// TINY TOADS — Pooled Particle Engine (Ambient Swamp + Win Bursts)
// Optimized with Object Pooling for 60fps performance on modest hardware
// ============================================================================

const PARTICLE_TYPES = [
  'sparkle',
  'bubble',
  'leaf',
  'star',
  'droplet',
  'magic_dust',
  'virtual_coin',
  'glow',
];

export class SwampParticleSystem {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = 1280;
    this.height = 720;
    this.maxPoolSize = 110;
    this.pool = [];
    this.ripples = [];
    this.sprites = {};
    this.running = false;
    this.lastTime = 0;

    this._initPool();
    this._preloadSprites();
    this._seedAmbient();
  }

  _initPool() {
    for (let i = 0; i < this.maxPoolSize; i++) {
      this.pool.push({
        active: false,
        ambient: false,
        type: 'sparkle',
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        gravity: 0,
        size: 16,
        alpha: 1,
        rotation: 0,
        vRot: 0,
        life: 0,
        maxLife: 1,
        phase: Math.random() * Math.PI * 2,
      });
    }
    for (let i = 0; i < 6; i++) {
      this.ripples.push({
        x: 150 + Math.random() * 980,
        y: 540 + Math.random() * 150,
        rx: 10 + Math.random() * 60,
        maxRx: 90 + Math.random() * 50,
        alpha: 0.4,
      });
    }
  }

  _preloadSprites() {
    const map = {
      sparkle: 'assets/particles/sparkle_particle.png',
      bubble: 'assets/particles/bubble_particle.png',
      leaf: 'assets/particles/leaf_particle.png',
      star: 'assets/particles/star_particle.png',
      droplet: 'assets/particles/water_droplet_particle.png',
      magic_dust: 'assets/particles/magical_dust_particle.png',
      virtual_coin: 'assets/particles/virtual_coin_particle.png',
      glow: 'assets/particles/glow_particle.png',
    };
    for (const [key, src] of Object.entries(map)) {
      const img = new Image();
      img.src = src;
      this.sprites[key] = img;
    }
  }

  _seedAmbient() {
    // 26 gentle ambient swamp particles (fireflies, rising bubbles, floating leaves, magic dust)
    const ambientTypes = ['magic_dust', 'bubble', 'sparkle', 'leaf', 'glow'];
    for (let i = 0; i < 26; i++) {
      const p = this.pool[i];
      p.active = true;
      p.ambient = true;
      p.type = ambientTypes[i % ambientTypes.length];
      p.x = Math.random() * this.width;
      p.y = Math.random() * this.height;
      p.vx = (Math.random() - 0.5) * 18;
      p.vy = p.type === 'leaf' ? 12 + Math.random() * 15 : -14 - Math.random() * 20;
      p.gravity = 0;
      p.size = p.type === 'glow' ? 34 : 14 + Math.random() * 14;
      p.alpha = 0.35 + Math.random() * 0.55;
      p.rotation = Math.random() * Math.PI * 2;
      p.vRot = (Math.random() - 0.5) * 1.2;
      p.phase = Math.random() * Math.PI * 2;
    }
  }

  spawnBurst(x, y, count = 18, allowedTypes = PARTICLE_TYPES, speedScale = 1) {
    let spawned = 0;
    for (let i = 0; i < this.pool.length && spawned < count; i++) {
      const p = this.pool[i];
      if (p.active) continue;
      p.active = true;
      p.ambient = false;
      p.type = allowedTypes[spawned % allowedTypes.length];
      p.x = x + (Math.random() - 0.5) * 30;
      p.y = y + (Math.random() - 0.5) * 30;
      const angle = Math.random() * Math.PI * 2;
      const speed = (90 + Math.random() * 220) * speedScale;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed - 95 * speedScale;
      p.gravity = p.type === 'virtual_coin' || p.type === 'droplet' ? 380 : 120;
      p.size = p.type === 'virtual_coin' ? 28 + Math.random() * 12 : 18 + Math.random() * 18;
      p.alpha = 1;
      p.rotation = Math.random() * Math.PI * 2;
      p.vRot = (Math.random() - 0.5) * 5;
      p.life = 0;
      p.maxLife = 0.85 + Math.random() * 0.75;
      spawned++;
    }
  }

  spawnWinFountain(tier = 'SMALL') {
    const counts = { SMALL: 22, MEDIUM: 40, BIG: 65, MEGA: 80 };
    const total = counts[tier] || 24;
    this.spawnBurst(
      640,
      380,
      total,
      ['virtual_coin', 'sparkle', 'star', 'glow', 'magic_dust'],
      tier === 'MEGA' ? 1.45 : tier === 'BIG' ? 1.25 : 1.0
    );
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      const dt = Math.min((now - this.lastTime) / 1000, 0.05);
      this.lastTime = now;
      this.update(dt, now * 0.001);
      this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  update(dt, timeSec) {
    // Update subtle water ripples in lower swamp area
    for (const r of this.ripples) {
      r.rx += 18 * dt;
      if (r.rx > r.maxRx) {
        r.rx = 8;
        r.x = 120 + Math.random() * 1040;
        r.y = 545 + Math.random() * 150;
      }
      r.alpha = Math.max(0, (1 - r.rx / r.maxRx) * 0.32);
    }

    for (const p of this.pool) {
      if (!p.active) continue;

      if (p.ambient) {
        p.x += p.vx * dt + Math.sin(timeSec * 1.5 + p.phase) * 14 * dt;
        p.y += p.vy * dt;
        p.rotation += p.vRot * dt;
        p.alpha = 0.35 + 0.45 * Math.abs(Math.sin(timeSec * 1.8 + p.phase));

        if (p.y < -30) p.y = this.height + 20;
        if (p.y > this.height + 30) p.y = -20;
        if (p.x < -30) p.x = this.width + 20;
        if (p.x > this.width + 30) p.x = -20;
      } else {
        p.life += dt;
        if (p.life >= p.maxLife) {
          p.active = false;
          continue;
        }
        p.vy += p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rotation += p.vRot * dt;
        p.alpha = Math.max(0, 1 - p.life / p.maxLife);
      }
    }
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    // Draw water ripples
    ctx.save();
    for (const r of this.ripples) {
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.rx, r.rx * 0.24, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(0, 245, 212, ${r.alpha.toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();

    // Draw pooled particles
    for (const p of this.pool) {
      if (!p.active || p.alpha <= 0.01) continue;
      const img = this.sprites[p.type];
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, -p.size / 2, -p.size / 2, p.size, p.size);
      } else {
        ctx.fillStyle = '#FFD100';
        ctx.beginPath();
        ctx.arc(0, 0, p.size * 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
}
