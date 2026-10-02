// ============================================================================
// TINY TOADS — Visual Sound Synchronizer & Procedural WebAudio Cue Engine
// Synchronizes visual states for: spin, reel_stop, symbol_land, win, big_win,
// jackpot, and button_click.
// ============================================================================

export class VisualSoundController {
  constructor(indicatorEl, stageEl) {
    this.indicatorEl = indicatorEl;
    this.stageEl = stageEl;
    this.soundEnabled = true;
    this.musicEnabled = false;
    this.audioCtx = null;
    this.lastEvent = 'ready';
  }

  _ensureAudio() {
    if (!this.soundEnabled) return null;
    if (!this.audioCtx && typeof window !== 'undefined') {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  trigger(eventName, detail = {}) {
    this.lastEvent = eventName;

    // 1. Visual Sound HUD Indicator & Stage Attribute
    if (this.stageEl) {
      this.stageEl.setAttribute('data-visual-sound', eventName);
      clearTimeout(this._stageTimer);
      this._stageTimer = setTimeout(() => {
        if (this.stageEl.getAttribute('data-visual-sound') === eventName) {
          this.stageEl.removeAttribute('data-visual-sound');
        }
      }, 420);
    }

    if (this.indicatorEl) {
      const labels = {
        spin: '🌀 SPIN PULSE',
        reel_stop: '🪵 REEL LOCK',
        symbol_land: '✨ SYMBOL LAND',
        win: '🎵 WIN CHIME',
        big_win: '🎺 BIG WIN FANFARE',
        jackpot: '👑 JACKPOT SYMPHONY',
        button_click: '💧 CLICK RIPPLE',
      };
      this.indicatorEl.textContent = labels[eventName] || `🔔 ${eventName.toUpperCase()}`;
      this.indicatorEl.classList.remove('vs-pulse');
      void this.indicatorEl.offsetWidth;
      this.indicatorEl.classList.add('vs-pulse');
    }

    // 2. Optional Procedural Arcade Audio Cue (zero external files)
    const ctx = this._ensureAudio();
    if (!ctx) return;

    const now = ctx.currentTime;
    try {
      if (eventName === 'button_click') {
        this._tone(ctx, 580, 780, 0.06, 'sine', 0.08, now);
      } else if (eventName === 'spin') {
        this._tone(ctx, 260, 620, 0.16, 'triangle', 0.1, now);
      } else if (eventName === 'reel_stop') {
        const col = detail.col || 0;
        this._tone(ctx, 210 + col * 35, 140, 0.08, 'triangle', 0.11, now);
      } else if (eventName === 'symbol_land') {
        this._tone(ctx, 520, 880, 0.12, 'sine', 0.09, now);
      } else if (eventName === 'win') {
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
          this._tone(ctx, freq, freq * 1.02, 0.14, 'triangle', 0.1, now + idx * 0.08);
        });
      } else if (eventName === 'big_win' || eventName === 'jackpot') {
        [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98].forEach((freq, idx) => {
          this._tone(ctx, freq, freq * 1.04, 0.22, 'sawtooth', 0.08, now + idx * 0.09);
        });
      }
    } catch (_) {
      // Ignore WebAudio autoplay restrictions
    }
  }

  _tone(ctx, fStart, fEnd, duration, type, gainVal, startTime) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(fStart, startTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, fEnd), startTime + duration);
    gain.gain.setValueAtTime(gainVal, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration);
  }
}
