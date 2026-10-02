// ============================================================================
// TINY TOADS — Game Configuration, Symbols, Paylines & Art Catalog
// DEMO ARCADE GAME — VIRTUAL CREDITS ONLY (NO REAL MONEY)
// ============================================================================

export const GAME_CONFIG = {
  title: 'TINY TOADS',
  baseWidth: 1280,
  baseHeight: 720,
  initialCredits: 10000,
  betSteps: [10, 20, 50, 100, 200, 500],
  defaultBetIndex: 2, // 50 virtual credits
  reelsCount: 5,
  rowsCount: 3,
  jackpots: {
    grand: { label: 'GRAND', base: 50000, current: 50000, incrementRate: 0.45 },
    major: { label: 'MAJOR', base: 10000, current: 10000, incrementRate: 0.18 },
    minor: { label: 'MINOR', base: 2500, current: 2500, incrementRate: 0.07 },
    mini: { label: 'MINI', base: 500, current: 500, incrementRate: 0.03 },
  },
  physics: {
    anticipationUpMs: 130,
    spinDurationBaseMs: 720,
    columnStopStaggerMs: 190,
    bounceDurationMs: 280,
  },
};

export const CHARACTERS = [
  {
    id: 'green',
    name: 'Tiny Toad Verde (Hoppy)',
    role: 'Explorador del Nenúfar',
    color: '#38E54D',
    position: 'left-top',
  },
  {
    id: 'blue',
    name: 'Tiny Toad Azul (Splash)',
    role: 'Guardián de la Laguna',
    color: '#00A8E8',
    position: 'left-bottom',
  },
  {
    id: 'gold',
    name: 'Tiny Toad Dorado (King Croak)',
    role: 'Rey del Pantano Dorado',
    color: '#FFD100',
    position: 'top-center',
  },
  {
    id: 'red',
    name: 'Tiny Toad Rojo (Blaze)',
    role: 'Cazador de Tesoros',
    color: '#FF2A55',
    position: 'right-top',
  },
  {
    id: 'purple',
    name: 'Tiny Toad Morado (Mystic)',
    role: 'Hechicera Bioluminiscente',
    color: '#9D4EDD',
    position: 'right-bottom',
  },
];

export const CHARACTER_STATES = [
  'idle',
  'blink',
  'happy',
  'excited',
  'win',
  'jump',
  'shocked',
];

export const SYMBOLS = [
  // Feature Symbols
  {
    id: 'symbol_wild',
    name: 'Wild Loto Real',
    category: 'feature',
    weight: 3,
    payouts: { 3: 5, 4: 15, 5: 50 },
    isWild: true,
    description: 'Sustituye a cualquier símbolo común o especial en línea de premio.',
  },
  {
    id: 'symbol_scatter',
    name: 'Scatter Cristal Místico',
    category: 'feature',
    weight: 3,
    payouts: { 3: 4, 4: 12, 5: 40 },
    isScatter: true,
    description: 'Paga en cualquier posición del tablero 5x3.',
  },
  {
    id: 'symbol_bonus',
    name: 'Bonus Tótem Dorado',
    category: 'feature',
    weight: 3,
    payouts: { 3: 6, 4: 18, 5: 45 },
    isBonus: true,
    description: 'Activa celebración especial del pantano.',
  },
  {
    id: 'symbol_prize',
    name: 'Perla Imperial de Premio',
    category: 'feature',
    weight: 2,
    payouts: { 3: 8, 4: 25, 5: 60 },
    isPrize: true,
    description: 'Símbolo especial de premio mayor virtual.',
  },

  // Special Swamp Symbols (10)
  {
    id: 'symbol_frog',
    name: 'Ídolo Rana Dorada',
    category: 'special',
    weight: 5,
    payouts: { 3: 4, 4: 10, 5: 30 },
  },
  {
    id: 'symbol_chest',
    name: 'Cofre del Pantano',
    category: 'special',
    weight: 5,
    payouts: { 3: 3.5, 4: 9, 5: 25 },
  },
  {
    id: 'symbol_lilypad',
    name: 'Nenúfar Brillante',
    category: 'special',
    weight: 6,
    payouts: { 3: 3, 4: 8, 5: 20 },
  },
  {
    id: 'symbol_dragonfly',
    name: 'Libélula Joya',
    category: 'special',
    weight: 6,
    payouts: { 3: 2.5, 4: 7, 5: 18 },
  },
  {
    id: 'symbol_firefly',
    name: 'Luciérnaga Linterna',
    category: 'special',
    weight: 6,
    payouts: { 3: 2.5, 4: 6, 5: 16 },
  },
  {
    id: 'symbol_water_flower',
    name: 'Flor Acuática de Loto',
    category: 'special',
    weight: 7,
    payouts: { 3: 2, 4: 5, 5: 14 },
  },
  {
    id: 'symbol_fish',
    name: 'Pez Koi Tropical',
    category: 'special',
    weight: 7,
    payouts: { 3: 2, 4: 5, 5: 12 },
  },
  {
    id: 'symbol_snail',
    name: 'Caracol Cristal',
    category: 'special',
    weight: 7,
    payouts: { 3: 1.5, 4: 4, 5: 10 },
  },
  {
    id: 'symbol_tropical_fruit',
    name: 'Fruta Tropical Pitahaya',
    category: 'special',
    weight: 8,
    payouts: { 3: 1.5, 4: 3.5, 5: 9 },
  },
  {
    id: 'symbol_rock',
    name: 'Roca Rúnica Musgosa',
    category: 'special',
    weight: 8,
    payouts: { 3: 1.2, 4: 3, 5: 8 },
  },

  // Common Carved Wood Symbols (5)
  {
    id: 'symbol_a',
    name: 'A de Madera Tallada',
    category: 'common',
    weight: 11,
    payouts: { 3: 1, 4: 2.5, 5: 6 },
  },
  {
    id: 'symbol_k',
    name: 'K de Madera Tallada',
    category: 'common',
    weight: 11,
    payouts: { 3: 0.8, 4: 2, 5: 5 },
  },
  {
    id: 'symbol_q',
    name: 'Q de Madera Tallada',
    category: 'common',
    weight: 12,
    payouts: { 3: 0.6, 4: 1.5, 5: 4 },
  },
  {
    id: 'symbol_j',
    name: 'J de Madera Tallada',
    category: 'common',
    weight: 12,
    payouts: { 3: 0.5, 4: 1.2, 5: 3.5 },
  },
  {
    id: 'symbol_10',
    name: '10 de Madera Tallada',
    category: 'common',
    weight: 13,
    payouts: { 3: 0.4, 4: 1, 5: 3 },
  },
];

// 15 Classic 5x3 Paylines (row indices 0, 1, 2 for each of the 5 columns)
export const PAYLINES = [
  { id: 1, rows: [1, 1, 1, 1, 1], color: '#FFD100', name: 'Línea Central' },
  { id: 2, rows: [0, 0, 0, 0, 0], color: '#00F5D4', name: 'Línea Superior' },
  { id: 3, rows: [2, 2, 2, 2, 2], color: '#38E54D', name: 'Línea Inferior' },
  { id: 4, rows: [0, 1, 2, 1, 0], color: '#FF2A6D', name: 'V Invertida' },
  { id: 5, rows: [2, 1, 0, 1, 2], color: '#9D4EDD', name: 'Gran V' },
  { id: 6, rows: [0, 0, 1, 0, 0], color: '#00A8E8', name: 'Arco Superior' },
  { id: 7, rows: [2, 2, 1, 2, 2], color: '#FFBE0B', name: 'Arco Inferior' },
  { id: 8, rows: [1, 0, 0, 0, 1], color: '#80FF72', name: 'Puente Alto' },
  { id: 9, rows: [1, 2, 2, 2, 1], color: '#FF70A6', name: 'Puente Bajo' },
  { id: 10, rows: [0, 1, 1, 1, 0], color: '#72F6FF', name: 'Cuna Central' },
  { id: 11, rows: [2, 1, 1, 1, 2], color: '#E0AAFF', name: 'Domo Central' },
  { id: 12, rows: [1, 0, 1, 2, 1], color: '#FB8500', name: 'Onda del Pantano' },
  { id: 13, rows: [1, 2, 1, 0, 1], color: '#2EC4B6', name: 'Salto de Rana' },
  { id: 14, rows: [0, 2, 0, 2, 0], color: '#FF4D6D', name: 'Zigzag Real' },
  { id: 15, rows: [2, 0, 2, 0, 2], color: '#FFF3B0', name: 'Doble Salto' },
];
