// ============================================================================
// TINY TOADS — Main Arcade Game Engine, 5x3 Reel Physics & Art Inspector
// FICTIONAL DEMO GAME — VIRTUAL CREDITS ONLY
// ============================================================================

import {
  GAME_CONFIG,
  CHARACTERS,
  CHARACTER_STATES,
  SYMBOLS,
  PAYLINES,
} from './config.js';
import { SwampParticleSystem } from './particles.js';
import { VisualSoundController } from './visualSound.js';

class TinyToadsGame {
  constructor() {
    this.credits = GAME_CONFIG.initialCredits;
    this.betIndex = GAME_CONFIG.defaultBetIndex;
    this.lastWin = 0;
    this.isSpinning = false;
    this.autoSpin = false;
    this.forcedOutcome = null; // null | 'SMALL' | 'MEDIUM' | 'BIG' | 'MEGA'

    this.jackpots = {
      grand: GAME_CONFIG.jackpots.grand.current,
      major: GAME_CONFIG.jackpots.major.current,
      minor: GAME_CONFIG.jackpots.minor.current,
      mini: GAME_CONFIG.jackpots.mini.current,
    };

    // 5 columns x 3 rows grid of symbol objects
    this.grid = Array.from({ length: 5 }, () => [
      SYMBOLS[4],
      SYMBOLS[14],
      SYMBOLS[6],
    ]);

    this.toadStates = {
      green: 'idle',
      blue: 'idle',
      gold: 'idle',
      red: 'idle',
      purple: 'idle',
    };

    this._cacheDOM();
    this.particles = new SwampParticleSystem(this.particleCanvas);
    this.visualSound = new VisualSoundController(
      this.visualSoundBadge,
      this.stageEl
    );

    this._initStageScaling();
    this._initReelsDOM();
    this._initToadsDOM();
    this._initControls();
    this._initModals();
    this._startAmbientLoops();
    this.particles.start();
    this._updateHUD();
  }

  get currentBet() {
    return GAME_CONFIG.betSteps[this.betIndex];
  }

  _cacheDOM() {
    this.viewportEl = document.getElementById('game-viewport');
    this.stageEl = document.getElementById('game-stage');
    this.particleCanvas = document.getElementById('swamp-particles');
    this.reelsGridEl = document.getElementById('reels-grid');
    this.paylinesSvgEl = document.getElementById('paylines-svg');
    this.toadsStageEl = document.getElementById('toads-stage-layer');

    // Top Jackpot numbers
    this.jpEls = {
      grand: document.getElementById('jp-val-grand'),
      major: document.getElementById('jp-val-major'),
      minor: document.getElementById('jp-val-minor'),
      mini: document.getElementById('jp-val-mini'),
    };

    // Bottom HUD
    this.creditsEl = document.getElementById('hud-credits-value');
    this.betEl = document.getElementById('hud-bet-value');
    this.winEl = document.getElementById('hud-win-value');
    this.statusBannerEl = document.getElementById('reel-status-banner');
    this.visualSoundBadge = document.getElementById('visual-sound-badge');

    // Buttons
    this.spinBtn = document.getElementById('btn-spin');
    this.spinBtnImg = document.getElementById('btn-spin-img');
    this.autoBtn = document.getElementById('btn-auto');
    this.betMinusBtn = document.getElementById('btn-bet-minus');
    this.betPlusBtn = document.getElementById('btn-bet-plus');
    this.infoBtn = document.getElementById('btn-info');
    this.galleryBtn = document.getElementById('btn-gallery');
    this.settingsBtn = document.getElementById('btn-settings');
    this.soundBtn = document.getElementById('btn-sound');
    this.musicBtn = document.getElementById('btn-music');

    // Win Celebration Overlay
    this.winOverlayEl = document.getElementById('win-celebration-overlay');
    this.winTierTitleEl = document.getElementById('win-tier-title');
    this.winTierSubtitleEl = document.getElementById('win-tier-subtitle');
    this.winTierAmountEl = document.getElementById('win-tier-amount');
    this.winToadsRowEl = document.getElementById('win-overlay-toads');
    this.closeWinOverlayBtn = document.getElementById('btn-close-win-overlay');
  }

  _initStageScaling() {
    const updateScale = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const scaleX = vw / GAME_CONFIG.baseWidth;
      const scaleY = vh / GAME_CONFIG.baseHeight;
      const scale = Math.max(0.2, Math.min(scaleX, scaleY));
      this.stageEl.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(4)})`;
    };
    window.addEventListener('resize', updateScale);
    updateScale();
  }

  _initReelsDOM() {
    this.reelsGridEl.innerHTML = '';
    this.reelColumns = [];

    // Initial picturesque board with all symbol categories visible
    const initialBoard = [
      ['symbol_frog', 'symbol_a', 'symbol_lilypad'],
      ['symbol_k', 'symbol_wild', 'symbol_dragonfly'],
      ['symbol_chest', 'symbol_frog', 'symbol_water_flower'],
      ['symbol_firefly', 'symbol_wild', 'symbol_q'],
      ['symbol_scatter', 'symbol_frog', 'symbol_tropical_fruit'],
    ];

    for (let col = 0; col < 5; col++) {
      const colEl = document.createElement('div');
      colEl.className = 'reel-column';
      colEl.dataset.col = col;

      const stripEl = document.createElement('div');
      stripEl.className = 'reel-strip';

      const cells = [];
      for (let row = 0; row < 3; row++) {
        const symId = initialBoard[col][row];
        const symObj = SYMBOLS.find((s) => s.id === symId) || SYMBOLS[0];
        this.grid[col][row] = symObj;

        const cellEl = document.createElement('div');
        cellEl.className = 'reel-cell state-normal';
        cellEl.dataset.col = col;
        cellEl.dataset.row = row;

        const img = document.createElement('img');
        img.className = 'symbol-sprite';
        img.src = `assets/symbols/${symObj.id}.png`;
        img.alt = symObj.name;
        img.draggable = false;

        const badge = document.createElement('span');
        badge.className = 'symbol-Sparkle-ring';

        cellEl.appendChild(img);
        cellEl.appendChild(badge);
        stripEl.appendChild(cellEl);
        cells.push({ cellEl, img, symObj });
      }

      colEl.appendChild(stripEl);
      this.reelsGridEl.appendChild(colEl);
      this.reelColumns.push({ colEl, stripEl, cells });
    }
  }

  _initToadsDOM() {
    this.toadsStageEl.innerHTML = '';
    this.toadEls = {};

    for (const char of CHARACTERS) {
      const wrapper = document.createElement('div');
      wrapper.className = `stage-toad toad-pos-${char.position}`;
      wrapper.dataset.toadId = char.id;
      wrapper.title = `${char.name} — ¡Haz clic para animar!`;

      const lily = document.createElement('div');
      lily.className = 'stage-toad-lilypad';

      const img = document.createElement('img');
      img.className = 'stage-toad-sprite state-idle';
      img.src = `assets/characters/tiny_toad_${char.id}_idle.png`;
      img.alt = char.name;
      img.draggable = false;

      const tag = document.createElement('span');
      tag.className = 'stage-toad-label';
      tag.textContent = char.name.split('(')[1]?.replace(')', '') || char.name;

      wrapper.appendChild(lily);
      wrapper.appendChild(img);
      wrapper.appendChild(tag);

      wrapper.addEventListener('click', (e) => {
        const rect = this.stageEl.getBoundingClientRect();
        const scale = rect.width / 1280;
        const x = (e.clientX - rect.left) / scale;
        const y = (e.clientY - rect.top) / scale;
        this.visualSound.trigger('button_click');
        this.particles.spawnBurst(x, y, 16, ['sparkle', 'star', 'magic_dust']);
        const cycle = ['happy', 'jump', 'win', 'excited', 'shocked'];
        const next = cycle[Math.floor(Math.random() * cycle.length)];
        this.setToadState(char.id, next, 1200);
      });

      this.toadsStageEl.appendChild(wrapper);
      this.toadEls[char.id] = { wrapper, img };
    }
  }

  setToadState(toadId, state, revertAfterMs = 0) {
    const entry = this.toadEls[toadId];
    if (!entry) return;
    this.toadStates[toadId] = state;
    entry.img.src = `assets/characters/tiny_toad_${toadId}_${state}.png`;
    entry.img.className = `stage-toad-sprite state-${state}`;

    if (revertAfterMs > 0) {
      clearTimeout(entry.revertTimer);
      entry.revertTimer = setTimeout(() => {
        if (!this.isSpinning) {
          this.setToadState(toadId, 'idle');
        }
      }, revertAfterMs);
    }
  }

  setAllToadsState(state, revertAfterMs = 0) {
    for (const c of CHARACTERS) {
      this.setToadState(c.id, state, revertAfterMs);
    }
  }

  _startAmbientLoops() {
    // Periodic natural blink & idle expressions for the 5 Tiny Toads
    setInterval(() => {
      if (this.isSpinning) return;
      const randomToad =
        CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
      if (this.toadStates[randomToad.id] === 'idle') {
        this.setToadState(randomToad.id, 'blink', 240);
      }
    }, 1800);

    // Gentle jackpot ticker
    setInterval(() => {
      this.jackpots.grand += 0.05;
      this.jackpots.major += 0.02;
      this._updateJackpotDOM();
    }, 2200);
  }

  _initControls() {
    // SPIN button states: IDLE, HOVER, PRESS, SPINNING, WIN, DISABLED
    this.spinBtn.addEventListener('mouseenter', () => {
      if (!this.isSpinning) this._setSpinButtonVisual('hover');
    });
    this.spinBtn.addEventListener('mouseleave', () => {
      if (!this.isSpinning) this._setSpinButtonVisual('idle');
    });
    this.spinBtn.addEventListener('mousedown', () => {
      if (!this.isSpinning) this._setSpinButtonVisual('pressed');
    });
    this.spinBtn.addEventListener('click', () => {
      this.visualSound.trigger('button_click');
      this.spin();
    });

    // Spacebar to spin
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !this._isModalOpen()) {
        e.preventDefault();
        this.spin();
      }
    });

    // Bet - / +
    this.betMinusBtn.addEventListener('click', () => {
      if (this.isSpinning) return;
      this.visualSound.trigger('button_click');
      this.betIndex = Math.max(0, this.betIndex - 1);
      this._updateHUD();
    });

    this.betPlusBtn.addEventListener('click', () => {
      if (this.isSpinning) return;
      this.visualSound.trigger('button_click');
      this.betIndex = Math.min(
        GAME_CONFIG.betSteps.length - 1,
        this.betIndex + 1
      );
      this._updateHUD();
    });

    // AUTO Spin toggle
    this.autoBtn.addEventListener('click', () => {
      this.visualSound.trigger('button_click');
      this.autoSpin = !this.autoSpin;
      this.autoBtn.classList.toggle('active', this.autoSpin);
      this.autoBtn.setAttribute('aria-pressed', String(this.autoSpin));
      if (this.autoSpin && !this.isSpinning) {
        this.spin();
      }
    });

    // Sound & Music toggles
    this.soundBtn.addEventListener('click', () => {
      this.visualSound.soundEnabled = !this.visualSound.soundEnabled;
      this.soundBtn.classList.toggle('muted', !this.visualSound.soundEnabled);
      this.soundBtn.querySelector('img').src = this.visualSound.soundEnabled
        ? 'assets/icons/icon_sound_on.png'
        : 'assets/icons/icon_sound_off.png';
      this.visualSound.trigger('button_click');
    });

    this.musicBtn.addEventListener('click', () => {
      this.visualSound.musicEnabled = !this.visualSound.musicEnabled;
      this.musicBtn.classList.toggle('muted', !this.visualSound.musicEnabled);
      this.musicBtn.querySelector('img').src = this.visualSound.musicEnabled
        ? 'assets/icons/icon_music_on.png'
        : 'assets/icons/icon_music_off.png';
      this.visualSound.trigger('button_click');
    });

    // Demo Director Trigger Buttons (Small Win, Medium Win, Big Win, Mega Win, Refill)
    document.querySelectorAll('[data-demo-trigger]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-demo-trigger');
        this.visualSound.trigger('button_click');
        if (mode === 'REFILL') {
          this.credits += 5000;
          this._updateHUD();
          this.particles.spawnBurst(260, 660, 20, ['virtual_coin', 'sparkle']);
          return;
        }
        this.forcedOutcome = mode;
        this.spin();
      });
    });

    this.closeWinOverlayBtn.addEventListener('click', () => {
      this.visualSound.trigger('button_click');
      this._hideWinOverlay();
    });
  }

  _setSpinButtonVisual(state) {
    this.spinBtn.dataset.state = state;
    this.spinBtnImg.src = `assets/buttons/spin_button_${state}.png`;
  }

  _isModalOpen() {
    return (
      !document.getElementById('modal-paytable').hidden ||
      !document.getElementById('modal-gallery').hidden ||
      !document.getElementById('modal-settings').hidden
    );
  }

  // ==========================================================================
  // CORE 5x3 REEL SPIN & PHYSICS
  // ==========================================================================
  async spin() {
    if (this.isSpinning) return;

    // Virtual credits check (auto-topup if needed so demo never dead-ends)
    if (this.credits < this.currentBet) {
      this.credits = GAME_CONFIG.initialCredits;
    }

    this.isSpinning = true;
    this.credits -= this.currentBet;
    this.lastWin = 0;
    this._hideWinOverlay();
    this._clearPaylines();
    this._resetSymbolStates();

    // Update jackpots slightly with virtual bet contribution
    this.jackpots.grand += this.currentBet * 0.08;
    this.jackpots.major += this.currentBet * 0.04;
    this.jackpots.minor += this.currentBet * 0.02;
    this.jackpots.mini += this.currentBet * 0.01;
    this._updateHUD();

    // Trigger SPIN state & visual sound
    this._setSpinButtonVisual('spinning');
    this.visualSound.trigger('spin');
    this.statusBannerEl.textContent = '¡GIRANDO EN EL PANTANO MÁGICO!';
    this.setAllToadsState('excited');
    this.particles.spawnBurst(640, 645, 16, ['sparkle', 'magic_dust']);

    // Generate target 5x3 matrix
    const outcomeMode = this.forcedOutcome;
    this.forcedOutcome = null;
    const targetGrid = this._generateTargetGrid(outcomeMode);

    // Start acceleration + motion blur on all 5 columns
    const spinTimers = [];
    for (let col = 0; col < 5; col++) {
      const colObj = this.reelColumns[col];
      colObj.colEl.classList.remove('reel-bounce');
      colObj.colEl.classList.add('reel-accelerating');

      setTimeout(() => {
        colObj.colEl.classList.remove('reel-accelerating');
        colObj.colEl.classList.add('reel-spinning-blur');
      }, GAME_CONFIG.physics.anticipationUpMs);

      // Cycle symbols rapidly during spin for authentic arcade feel
      const timer = setInterval(() => {
        for (let row = 0; row < 3; row++) {
          const randSym =
            SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
          colObj.cells[row].img.src = `assets/symbols/${randSym.id}.png`;
        }
      }, 75);
      spinTimers.push(timer);
    }

    // Stop each column individually with deceleration + bounce + settle
    for (let col = 0; col < 5; col++) {
      const waitMs =
        col === 0
          ? GAME_CONFIG.physics.spinDurationBaseMs
          : GAME_CONFIG.physics.columnStopStaggerMs;
      await new Promise((r) => setTimeout(r, waitMs));

      clearInterval(spinTimers[col]);
      const colObj = this.reelColumns[col];
      colObj.colEl.classList.remove('reel-spinning-blur');
      colObj.colEl.classList.add('reel-bounce');

      let hasSpecialLand = false;
      for (let row = 0; row < 3; row++) {
        const finalSym = targetGrid[col][row];
        this.grid[col][row] = finalSym;
        colObj.cells[row].symObj = finalSym;
        colObj.cells[row].img.src = `assets/symbols/${finalSym.id}.png`;
        colObj.cells[row].cellEl.className = 'reel-cell state-normal';
        if (finalSym.category === 'feature') {
          hasSpecialLand = true;
        }
      }

      // Trigger reel_stop or symbol_land visual sound
      this.visualSound.trigger(hasSpecialLand ? 'symbol_land' : 'reel_stop', {
        col,
      });

      // Spawn subtle dust/sparkle puff at stopped column bottom
      const colCenterX = 270 + col * 175;
      this.particles.spawnBurst(
        colCenterX,
        460,
        hasSpecialLand ? 14 : 6,
        hasSpecialLand ? ['sparkle', 'star'] : ['magic_dust', 'droplet'],
        0.75
      );
    }

    // Wait for final bounce settle
    await new Promise((r) =>
      setTimeout(r, GAME_CONFIG.physics.bounceDurationMs)
    );
    this.reelColumns.forEach((c) => c.colEl.classList.remove('reel-bounce'));

    // Evaluate wins
    const result = this._evaluateBoard();
    if (result.totalWin > 0) {
      await this._handleWinCelebration(result);
    } else {
      this._setSpinButtonVisual('idle');
      this.setAllToadsState('idle');
      this.statusBannerEl.textContent =
        '¡GIRA LOS REELS O PULSA UN TINY TOAD!';
    }

    this.isSpinning = false;
    this._updateHUD();

    if (this.autoSpin && this.winOverlayEl.hidden) {
      this._autoTimer = setTimeout(() => {
        if (this.autoSpin && !this.isSpinning) this.spin();
      }, 950);
    }
  }

  _pickWeightedSymbol() {
    const totalWeight = SYMBOLS.reduce((acc, s) => acc + s.weight, 0);
    let r = Math.random() * totalWeight;
    for (const s of SYMBOLS) {
      r -= s.weight;
      if (r <= 0) return s;
    }
    return SYMBOLS[SYMBOLS.length - 1];
  }

  _generateTargetGrid(forcedMode) {
    const matrix = Array.from({ length: 5 }, () =>
      Array.from({ length: 3 }, () => this._pickWeightedSymbol())
    );

    const byId = (id) => SYMBOLS.find((s) => s.id === id);

    if (forcedMode === 'SMALL') {
      // 3 Lilypads on center line
      const sym = byId('symbol_lilypad');
      matrix[0][1] = sym;
      matrix[1][1] = sym;
      matrix[2][1] = sym;
    } else if (forcedMode === 'MEDIUM') {
      // 4 Treasure Chests + Wild on top/center
      const chest = byId('symbol_chest');
      const wild = byId('symbol_wild');
      matrix[0][1] = chest;
      matrix[1][1] = wild;
      matrix[2][1] = chest;
      matrix[3][1] = chest;
      matrix[0][0] = byId('symbol_dragonfly');
      matrix[1][0] = byId('symbol_dragonfly');
      matrix[2][0] = byId('symbol_dragonfly');
    } else if (forcedMode === 'BIG') {
      // 5 Golden Frogs on center line + V line
      const frog = byId('symbol_frog');
      const wild = byId('symbol_wild');
      for (let c = 0; c < 5; c++) {
        matrix[c][1] = c === 2 ? wild : frog;
      }
      matrix[0][0] = frog;
      matrix[4][0] = frog;
    } else if (forcedMode === 'MEGA') {
      // Royal Prize + Wilds across multiple paylines
      const prize = byId('symbol_prize');
      const wild = byId('symbol_wild');
      for (let c = 0; c < 5; c++) {
        matrix[c][1] = prize;
        matrix[c][0] = c % 2 === 0 ? prize : wild;
      }
    }

    return matrix;
  }

  _evaluateBoard() {
    const winningLines = [];
    const winningCoords = new Set();
    let totalMultiplier = 0;

    // 1. Evaluate 15 Paylines
    for (const line of PAYLINES) {
      const lineSyms = line.rows.map((r, c) => this.grid[c][r]);

      // Determine base symbol (first non-wild, or wild if all wilds)
      let baseSym = lineSyms.find((s) => !s.isWild && !s.isScatter);
      if (!baseSym) baseSym = lineSyms[0];
      if (baseSym.isScatter) continue;

      let matchCount = 0;
      for (let c = 0; c < 5; c++) {
        const s = lineSyms[c];
        if (s.id === baseSym.id || s.isWild) {
          matchCount++;
        } else {
          break;
        }
      }

      if (matchCount >= 3) {
        const mult = baseSym.payouts[matchCount] || 1;
        totalMultiplier += mult;
        const coords = [];
        for (let c = 0; c < matchCount; c++) {
          const r = line.rows[c];
          coords.push([c, r]);
          winningCoords.add(`${c},${r}`);
        }
        winningLines.push({
          payline: line,
          symbol: baseSym,
          count: matchCount,
          multiplier: mult,
          coords,
        });
      }
    }

    // 2. Evaluate Scatters anywhere on 5x3
    const scatterCoords = [];
    for (let c = 0; c < 5; c++) {
      for (let r = 0; r < 3; r++) {
        if (this.grid[c][r].isScatter) {
          scatterCoords.push([c, r]);
        }
      }
    }
    if (scatterCoords.length >= 3) {
      const count = Math.min(5, scatterCoords.length);
      const scatterSym = SYMBOLS.find((s) => s.isScatter);
      const mult = scatterSym.payouts[count] || 4;
      totalMultiplier += mult;
      scatterCoords.forEach(([c, r]) => winningCoords.add(`${c},${r}`));
      winningLines.push({
        payline: { id: 'SCATTER', color: '#00F5D4', name: 'Scatter Místico' },
        symbol: scatterSym,
        count,
        multiplier: mult,
        coords: scatterCoords,
      });
    }

    const totalWin = Math.round(totalMultiplier * this.currentBet);
    let tier = 'NONE';
    if (totalMultiplier >= 40) tier = 'MEGA';
    else if (totalMultiplier >= 15) tier = 'BIG';
    else if (totalMultiplier >= 5) tier = 'MEDIUM';
    else if (totalMultiplier > 0) tier = 'SMALL';

    return {
      totalWin,
      totalMultiplier,
      tier,
      winningLines,
      winningCoords,
    };
  }

  async _handleWinCelebration(result) {
    this.lastWin = result.totalWin;
    this.credits += result.totalWin;
    this._setSpinButtonVisual('win');

    // Highlight winning symbols and dim non-winning symbols
    for (let col = 0; col < 5; col++) {
      for (let row = 0; row < 3; row++) {
        const cellObj = this.reelColumns[col].cells[row];
        const key = `${col},${row}`;
        if (result.winningCoords.has(key)) {
          cellObj.cellEl.className = 'reel-cell state-winning';
          cellObj.img.src = `assets/symbols/${cellObj.symObj.id}_winning.png`;
        } else {
          cellObj.cellEl.className = 'reel-cell state-disabled';
          cellObj.img.src = `assets/symbols/${cellObj.symObj.id}_disabled.png`;
        }
      }
    }

    // Draw glowing paylines
    this._drawWinningPaylines(result.winningLines);

    // Spawn win fountain particles
    this.particles.spawnWinFountain(result.tier);

    // Set Tiny Toads states & visual sound
    const tierLabels = {
      SMALL: '¡PEQUEÑA VICTORIA DEL PANTANO!',
      MEDIUM: '¡GRAN COMBINACIÓN TROPICAL!',
      BIG: '¡¡BIG WIN!! ¡TESORO ANFIBIO!',
      MEGA: '👑 ¡¡MEGA WIN IMPERIAL!! 👑',
    };
    this.statusBannerEl.textContent = `${tierLabels[result.tier]} +${result.totalWin.toLocaleString()} CRÉDITOS VIRTUALES`;

    if (result.tier === 'SMALL') {
      this.visualSound.trigger('win');
      this.setAllToadsState('happy', 2200);
    } else if (result.tier === 'MEDIUM') {
      this.visualSound.trigger('win');
      this.setAllToadsState('win', 2600);
    } else if (result.tier === 'BIG') {
      this.visualSound.trigger('big_win');
      this.setAllToadsState('jump', 3400);
      this._showWinOverlay('BIG WIN!', '¡Celebración del Pantano!', result.totalWin, 'big');
    } else if (result.tier === 'MEGA') {
      this.visualSound.trigger('jackpot');
      this.setAllToadsState('win', 4500);
      this._showWinOverlay('MEGA WIN!', '¡Los Tiny Toads celebran tu fortuna virtual!', result.totalWin, 'mega');
    }
  }

  _drawWinningPaylines(winningLines) {
    this.paylinesSvgEl.innerHTML = '';
    const colX = [128, 294, 460, 626, 792];
    const rowY = [115, 255, 395];

    for (const wl of winningLines) {
      if (wl.coords.length < 2) continue;
      const points = wl.coords
        .map(([c, r]) => `${colX[c]},${rowY[r]}`)
        .join(' ');

      const glowLine = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'polyline'
      );
      glowLine.setAttribute('points', points);
      glowLine.setAttribute('fill', 'none');
      glowLine.setAttribute('stroke', wl.payline.color || '#FFD100');
      glowLine.setAttribute('stroke-width', '12');
      glowLine.setAttribute('stroke-linecap', 'round');
      glowLine.setAttribute('stroke-linejoin', 'round');
      glowLine.setAttribute('opacity', '0.45');

      const coreLine = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'polyline'
      );
      coreLine.setAttribute('points', points);
      coreLine.setAttribute('fill', 'none');
      coreLine.setAttribute('stroke', '#FFF8D6');
      coreLine.setAttribute('stroke-width', '5');
      coreLine.setAttribute('stroke-linecap', 'round');
      coreLine.setAttribute('stroke-linejoin', 'round');
      coreLine.setAttribute('class', 'payline-beam');

      this.paylinesSvgEl.appendChild(glowLine);
      this.paylinesSvgEl.appendChild(coreLine);
    }
  }

  _clearPaylines() {
    this.paylinesSvgEl.innerHTML = '';
  }

  _resetSymbolStates() {
    for (let col = 0; col < 5; col++) {
      for (let row = 0; row < 3; row++) {
        const cellObj = this.reelColumns[col].cells[row];
        cellObj.cellEl.className = 'reel-cell state-normal';
        cellObj.img.src = `assets/symbols/${cellObj.symObj.id}.png`;
      }
    }
  }

  _showWinOverlay(title, subtitle, amount, tierClass) {
    this.winOverlayEl.hidden = false;
    this.winOverlayEl.className = `win-celebration-overlay tier-${tierClass}`;
    this.winTierTitleEl.textContent = title;
    this.winTierSubtitleEl.textContent = subtitle;

    // Populate celebrating Tiny Toads row
    this.winToadsRowEl.innerHTML = CHARACTERS.map(
      (c, i) => `
      <img src="assets/characters/tiny_toad_${c.id}_${i % 2 === 0 ? 'win' : 'jump'}.png"
           alt="${c.name}"
           class="win-celebration-toad"
           style="animation-delay: ${i * 0.1}s" />`
    ).join('');

    // Animated roll-up counter for virtual credits won
    const duration = 1400;
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const currentVal = Math.round(amount * (1 - Math.pow(1 - p, 3)));
      this.winTierAmountEl.textContent = `+${currentVal.toLocaleString()} CRÉDITOS`;
      if (p < 1 && !this.winOverlayEl.hidden) {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  }

  _hideWinOverlay() {
    this.winOverlayEl.hidden = true;
  }

  _updateHUD() {
    this.creditsEl.textContent = Math.floor(this.credits).toLocaleString();
    this.betEl.textContent = this.currentBet.toLocaleString();
    this.winEl.textContent = Math.floor(this.lastWin).toLocaleString();
    this._updateJackpotDOM();
  }

  _updateJackpotDOM() {
    for (const [key, el] of Object.entries(this.jpEls)) {
      if (el) {
        el.textContent = Math.floor(this.jackpots[key]).toLocaleString();
      }
    }
  }

  // ==========================================================================
  // MODALS: PAYTABLE (INFO), ART GALLERY INSPECTOR, SETTINGS
  // ==========================================================================
  _initModals() {
    const paytableModal = document.getElementById('modal-paytable');
    const galleryModal = document.getElementById('modal-gallery');
    const settingsModal = document.getElementById('modal-settings');

    // Populate Paytable Grid
    const paytableBody = document.getElementById('paytable-symbols-grid');
    paytableBody.innerHTML = SYMBOLS.map(
      (s) => `
      <div class="paytable-card category-${s.category}">
        <img src="assets/symbols/${s.id}.png" alt="${s.name}" loading="lazy" />
        <div class="paytable-card-info">
          <h4>${s.name}</h4>
          <span class="badge-cat">${s.category.toUpperCase()}</span>
          <div class="payout-list">
            <span>5x: <b>${s.payouts[5]}x</b></span>
            <span>4x: <b>${s.payouts[4]}x</b></span>
            <span>3x: <b>${s.payouts[3]}x</b></span>
          </div>
        </div>
      </div>`
    ).join('');

    // Populate Art Director Asset Inspector Gallery
    this._populateArtGallery();

    // Open handlers
    this.infoBtn.addEventListener('click', () => {
      this.visualSound.trigger('button_click');
      paytableModal.hidden = false;
    });
    this.galleryBtn.addEventListener('click', () => {
      this.visualSound.trigger('button_click');
      galleryModal.hidden = false;
    });
    this.settingsBtn.addEventListener('click', () => {
      this.visualSound.trigger('button_click');
      settingsModal.hidden = false;
    });

    // Close handlers
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.visualSound.trigger('button_click');
        const id = btn.getAttribute('data-close-modal');
        document.getElementById(id).hidden = true;
      });
    });
  }

  _populateArtGallery() {
    const toadsContainer = document.getElementById('gallery-toads-grid');
    const symbolsContainer = document.getElementById('gallery-symbols-grid');
    const logosContainer = document.getElementById('gallery-logos-grid');

    // All 5 Tiny Toads x 7 states interactive switcher
    toadsContainer.innerHTML = CHARACTERS.map(
      (c) => `
      <div class="gallery-toad-card">
        <h4>${c.name}</h4>
        <p class="role-sub">${c.role}</p>
        <div class="toad-states-strip">
          ${CHARACTER_STATES.map(
            (st) => `
            <figure class="state-thumb">
              <img src="assets/characters/tiny_toad_${c.id}_${st}.png" alt="${c.name} ${st}" loading="lazy" />
              <figcaption>${st}</figcaption>
            </figure>`
          ).join('')}
        </div>
      </div>`
    ).join('');

    // All 19 Symbols with state preview selector
    symbolsContainer.innerHTML = SYMBOLS.map(
      (s) => `
      <div class="gallery-sym-card">
        <div class="sym-states-row">
          <img src="assets/symbols/${s.id}_normal.png" title="normal" alt="${s.name} normal" loading="lazy" />
          <img src="assets/symbols/${s.id}_highlighted.png" title="highlighted" alt="${s.name} highlighted" loading="lazy" />
          <img src="assets/symbols/${s.id}_winning.png" title="winning" alt="${s.name} winning" loading="lazy" />
          <img src="assets/symbols/${s.id}_disabled.png" title="disabled" alt="${s.name} disabled" loading="lazy" />
        </div>
        <h5>${s.name}</h5>
        <code>assets/symbols/${s.id}.png</code>
      </div>`
    ).join('');

    // Logos, Spin Button States & Particles
    const logoFiles = [
      { title: '1. Logo Completo', path: 'assets/logo/tiny_toads_logo_full.png' },
      { title: '2. Logo Horizontal', path: 'assets/logo/tiny_toads_logo_horizontal.png' },
      { title: '3. Icono Principal', path: 'assets/logo/tiny_toads_logo_icon.png' },
      { title: '4. Favicon', path: 'assets/logo/favicon.png' },
      { title: '5. Versión Clara', path: 'assets/logo/tiny_toads_logo_light.png' },
      { title: '6. Versión Oscura', path: 'assets/logo/tiny_toads_logo_dark.png' },
      { title: 'Key Art Oficial', path: 'assets/logo/tiny_toads_splash_art.png' },
      { title: 'Fondo Pantano Pintado', path: 'assets/background/swamp_background.png' },
    ];
    logosContainer.innerHTML = logoFiles
      .map(
        (l) => `
      <div class="gallery-logo-card">
        <img src="${l.path}" alt="${l.title}" loading="lazy" />
        <h5>${l.title}</h5>
        <code>${l.path}</code>
      </div>`
      )
      .join('');
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', () => {
    window.tinyToadsGame = new TinyToadsGame();
  });
} else {
  window.tinyToadsGame = new TinyToadsGame();
}
