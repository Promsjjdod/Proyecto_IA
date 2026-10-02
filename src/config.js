// TINY TOADS — game configuration (fictional demo, virtual credits only)

export const REELS = 5;
export const ROWS = 3;
export const CELL_W = 140;
export const CELL_H = 128;

export const SYMBOLS = {
  ten:       { id: 'ten',       name: '10',        tier: 'low',     pays: [0,  0,  10,  25,  60] },
  j:         { id: 'j',         name: 'J',         tier: 'low',     pays: [0,  0,  10,  25,  60] },
  q:         { id: 'q',         name: 'Q',         tier: 'low',     pays: [0,  0,  12,  30,  75] },
  k:         { id: 'k',         name: 'K',         tier: 'low',     pays: [0,  0,  15,  35,  90] },
  a:         { id: 'a',         name: 'A',         tier: 'low',     pays: [0,  0,  18,  45,  110] },
  snail:     { id: 'snail',     name: 'Caracol',   tier: 'mid',     pays: [0,  0,  20,  60,  150] },
  fish:      { id: 'fish',      name: 'Pez',       tier: 'mid',     pays: [0,  0,  20,  60,  150] },
  fruit:     { id: 'fruit',     name: 'Fruta',     tier: 'mid',     pays: [0,  0,  25,  75,  180] },
  flower:    { id: 'flower',    name: 'Flor',      tier: 'mid',     pays: [0,  0,  25,  75,  180] },
  firefly:   { id: 'firefly',   name: 'Luciérnaga',tier: 'mid',     pays: [0,  0,  30,  90,  220] },
  dragonfly: { id: 'dragonfly', name: 'Libélula',  tier: 'mid',     pays: [0,  0,  30,  90,  220] },
  rock:      { id: 'rock',      name: 'Roca',      tier: 'high',    pays: [0,  0,  40,  120,  300] },
  lilypad:   { id: 'lilypad',   name: 'Nenúfar',   tier: 'high',    pays: [0,  0,  50,  150,  375] },
  chest:     { id: 'chest',     name: 'Cofre',     tier: 'high',    pays: [0,  0,  60,  200,  500] },
  frog:      { id: 'frog',      name: 'Rana',      tier: 'high',    pays: [0,  15,  75,  250,  650] },
  prize:     { id: 'prize',     name: 'Premio',    tier: 'special', pays: [0,  0,  80,  350,  1000] },
  wild:      { id: 'wild',      name: 'Wild',      tier: 'special', pays: [0,  0,  80,  350,  1000], wild: true },
  scatter:   { id: 'scatter',   name: 'Scatter',   tier: 'special', pays: [0,  0,  2,  10,  50], scatter: true },
  bonus:     { id: 'bonus',     name: 'Bonus',     tier: 'special', pays: [0,  0,  0,  0,  0], bonus: true },
};

// Reel strip weights (per reel). Higher = more frequent.
export const WEIGHTS = {
  ten: 16, j: 15, q: 13, k: 12, a: 11,
  snail: 8, fish: 8, fruit: 7, flower: 7, firefly: 6, dragonfly: 6,
  rock: 5, lilypad: 4.5, chest: 4, frog: 3.5,
  prize: 1.6, wild: 3.2, scatter: 1.6, bonus: 1.2,
};

export const STRIP_LENGTH = 48;

// 10 paylines (row index per reel; 0 = top)
export const PAYLINES = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 0, 1, 2, 1],
  [1, 2, 1, 0, 1],
  [0, 1, 1, 1, 0],
];

export const BET_STEPS = [5, 10, 20, 50, 100, 200];
export const START_CREDITS = 1000;

// Win tiers as multiples of total bet
export const WIN_TIERS = [
  { id: 'small',  min: 0.01, max: 5,   title: 'WIN' },
  { id: 'medium', min: 5,    max: 15,  title: 'NICE WIN' },
  { id: 'big',    min: 15,   max: 40,  title: 'BIG WIN' },
  { id: 'mega',   min: 40,   max: 1e9, title: 'MEGA WIN' },
];

// Virtual jackpot display (purely cosmetic counters)
export const JACKPOTS = {
  grand: { base: 50000, rate: 0.9 },
  major: { base: 5000,  rate: 0.25 },
  minor: { base: 500,   rate: 0.06 },
  mini:  { base: 100,   rate: 0.02 },
};

export const TOADS = ['green', 'blue', 'red', 'purple', 'gold'];
export const TOAD_POSES = ['idle', 'happy', 'shocked', 'jump'];

export const TIMING = {
  normal: { accel: 260, spinMin: 900, stagger: 240, decel: 420 },
  turbo:  { accel: 140, spinMin: 350, stagger: 110, decel: 260 },
};

// ADMIN cheat panel (solo demo). Cambia este PIN antes de compartir la build.
export const ADMIN_PIN = '1234';
