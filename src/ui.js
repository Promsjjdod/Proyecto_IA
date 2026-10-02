// HUD / controls / jackpots / modals
import { BET_STEPS, JACKPOTS, SYMBOLS, TOADS } from './config.js';
import { symbolPath, toadPath } from './assets.js';
import { events } from './events.js';

export const fmt = n => Math.round(n).toLocaleString('es-ES').replace(/\./g, ' ');

export class UI {
  constructor() {
    this.$ = id => document.getElementById(id);
    this.credits = this.$('creditsValue'); this.bet = this.$('betValue'); this.win = this.$('winValue');
    this.spin = this.$('btnSpin'); this.auto = this.$('btnAuto'); this.turbo = this.$('btnTurbo');
    this.plate = this.$('messagePlate'); this.autoCount = this.$('autoCount');
    this.machine = this.$('machine'); this.dim = this.$('dim');
    this.banner = this.$('winBanner'); this.winTitle = this.$('winTitle'); this.winAmount = this.$('winAmount'); this.winToads = this.$('winToads');
    this.jackpotEls = [...document.querySelectorAll('.jackpot')];
    this.jackpotVals = {};
    for (const k of Object.keys(JACKPOTS)) this.jackpotVals[k] = JACKPOTS[k].base + Math.random() * JACKPOTS[k].base * 0.2;
    this.buildPaytable();
    this.bindModals();
    this.spinState = 'idle';
    this.spin.addEventListener('pointerdown', () => this.setSpinState(this.spinState === 'idle' ? 'press' : this.spinState));
    this.spin.addEventListener('pointerup', () => { if (this.spinState === 'press') this.setSpinState('idle'); });
    this.spin.addEventListener('pointerleave', () => { if (this.spinState === 'press') this.setSpinState('idle'); });
  }

  setSpinState(s) { this.spinState = s; this.spin.dataset.state = s; }
  setCredits(v) { this.credits.textContent = fmt(v); this.bump(this.credits); }
  setBet(v) { this.bet.textContent = fmt(v); this.$('betMinus').disabled = v <= BET_STEPS[0]; this.$('betPlus').disabled = v >= BET_STEPS[BET_STEPS.length - 1]; }
  setWin(v) { this.win.textContent = fmt(v); if (v > 0) this.bump(this.win); }
  message(t) { this.plate.textContent = t; }
  bump(el) { el.classList.remove('is-bump'); void el.offsetWidth; el.classList.add('is-bump'); }

  /** Count-up animation for win value. */
  countWin(from, to, ms, onDone) {
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms); const e = 1 - Math.pow(1 - k, 3);
      this.win.textContent = fmt(from + (to - from) * e);
      if (this.bannerOn) this.winAmount.textContent = fmt(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step); else onDone && onDone();
    };
    requestAnimationFrame(step);
  }

  tickJackpots(dt) {
    for (const el of this.jackpotEls) {
      const k = el.dataset.tier;
      this.jackpotVals[k] += JACKPOTS[k].rate * dt * 10;
      el.querySelector('[data-value]').textContent = fmt(this.jackpotVals[k]);
    }
  }
  hitJackpot(tier) {
    const el = this.jackpotEls.find(e => e.dataset.tier === tier);
    el.classList.remove('is-hit'); void el.offsetWidth; el.classList.add('is-hit');
    events.emit('jackpot', { tier });
    setTimeout(() => el.classList.remove('is-hit'), 1000);
  }

  showBanner(tier, title, amount) {
    this.banner.className = `win-banner win-banner--${tier} is-on`; this.bannerOn = true;
    this.winTitle.textContent = title; this.winAmount.textContent = fmt(amount);
    this.winToads.innerHTML = '';
    if (tier === 'mega') for (const c of TOADS) { const im = document.createElement('img'); im.src = toadPath(c, 'happy'); this.winToads.appendChild(im); }
    this.dim.classList.toggle('is-on', tier === 'big' || tier === 'mega');
  }
  hideBanner() { this.banner.classList.remove('is-on'); this.bannerOn = false; this.dim.classList.remove('is-on'); }

  buildPaytable() {
    const wrap = this.$('paytable');
    for (const id of Object.keys(SYMBOLS)) {
      const s = SYMBOLS[id];
      const pays = s.pays.map((p, i) => p ? `${i + 1}× — ${p}` : null).filter(Boolean).join('<br>') || 'Dispara la celebración';
      const el = document.createElement('div');
      el.className = 'paytable__item';
      el.innerHTML = `<img src="${symbolPath(id)}" alt=""><div class="paytable__name">${s.name.toUpperCase()}</div><div class="paytable__pays">${pays}</div>`;
      wrap.appendChild(el);
    }
  }

  bindModals() {
    const open = (id) => { this.$(id).hidden = false; events.emit('click'); };
    const close = (id) => { this.$(id).hidden = true; events.emit('click'); };
    this.$('btnInfo').addEventListener('click', () => open('modalInfo'));
    this.$('modalClose').addEventListener('click', () => close('modalInfo'));
    this.$('btnSettings').addEventListener('click', () => open('modalSettings'));
    this.$('settingsClose').addEventListener('click', () => close('modalSettings'));
    for (const m of ['modalInfo', 'modalSettings']) this.$(m).addEventListener('click', (e) => { if (e.target.id === m) close(m); });
    for (const id of ['btnSound', 'btnMusic']) {
      const b = this.$(id);
      b.addEventListener('click', () => { b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true'); events.emit('click'); });
    }
  }
}
