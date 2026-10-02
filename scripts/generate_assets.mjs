import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire('/tmp/svgtools/ node_modules/');
const { Resvg } = require('/tmp/svgtools/node_modules/@resvg/resvg-js');

const ROOT = process.cwd();
const ASSETS_DIR = path.join(ROOT, 'assets');

const DIRS = [
  'characters',
  'symbols',
  'background',
  'reels',
  'ui',
  'buttons',
  'particles',
  'effects',
  'logo',
  'icons',
  'animations',
];

for (const d of DIRS) {
  fs.mkdirSync(path.join(ASSETS_DIR, d), { recursive: true });
}

function saveAsset(relPathWithoutExt, svgContent, width = null) {
  const svgPath = path.join(ASSETS_DIR, `${relPathWithoutExt}.svg`);
  const pngPath = path.join(ASSETS_DIR, `${relPathWithoutExt}.png`);
  fs.mkdirSync(path.dirname(svgPath), { recursive: true });
  fs.writeFileSync(svgPath, svgContent, 'utf8');

  const opts = {
    background: 'rgba(0, 0, 0, 0)',
    font: {
      loadSystemFonts: true,
      defaultFontFamily: 'DejaVu Sans',
    },
  };
  if (width) {
    opts.fitTo = { mode: 'width', value: width };
  }
  const resvg = new Resvg(svgContent, opts);
  const pngData = resvg.render();
  fs.writeFileSync(pngPath, pngData.asPng());
}

// ============================================================================
// 1. CHARACTERS: 5 TINY TOADS x 7 STATES
// ============================================================================
const TOADS = [
  {
    id: 'green',
    name: 'Hoppy',
    bodyLight: '#80FF72',
    bodyMid: '#29D844',
    bodyDark: '#0D7A22',
    bellyLight: '#FFF9B0',
    bellyDark: '#C8F560',
    outline: '#0A2910',
    cheek: '#FF6B8B',
    iris: '#18A558',
    rim: '#A8FF3E',
    accessory: 'leaf',
  },
  {
    id: 'blue',
    name: 'Splash',
    bodyLight: '#72F6FF',
    bodyMid: '#00A8E8',
    bodyDark: '#004E89',
    bellyLight: '#E0FBFc',
    bellyDark: '#7CE8FF',
    outline: '#062038',
    cheek: '#FF85A1',
    iris: '#0077B6',
    rim: '#00F5D4',
    accessory: 'fin',
  },
  {
    id: 'red',
    name: 'Blaze',
    bodyLight: '#FF8FA3',
    bodyMid: '#FF2A55',
    bodyDark: '#8F0924',
    bellyLight: '#FFE5B4',
    bellyDark: '#FF9E6D',
    outline: '#2D0610',
    cheek: '#FFBE0B',
    iris: '#D90429',
    rim: '#FFBE0B',
    accessory: 'crest',
  },
  {
    id: 'purple',
    name: 'Mystic',
    bodyLight: '#E0AAFF',
    bodyMid: '#9D4EDD',
    bodyDark: '#480CA8',
    bellyLight: '#F8E8FF',
    bellyDark: '#C77DFF',
    outline: '#1F0538',
    cheek: '#FF70A6',
    iris: '#7209B7',
    rim: '#00F5D4',
    accessory: 'crystal',
  },
  {
    id: 'gold',
    name: 'King Croak',
    bodyLight: '#FFF3B0',
    bodyMid: '#FFB703',
    bodyDark: '#B65E00',
    bellyLight: '#FFFFFF',
    bellyDark: '#FFE169',
    outline: '#331A00',
    cheek: '#FF5D8F',
    iris: '#FB8500',
    rim: '#FFF8D6',
    accessory: 'crown',
  },
];

const TOAD_STATES = ['idle', 'blink', 'happy', 'excited', 'win', 'jump', 'shocked'];

function renderToadSVG(toad, state) {
  const isJump = state === 'jump' || state === 'win';
  const isExcited = state === 'excited' || state === 'win';
  const isShocked = state === 'shocked';
  const isBlink = state === 'blink';
  const isHappy = state === 'happy' || state === 'win';

  const offsetY = isJump ? -16 : isExcited ? -6 : 0;
  const scaleY = isJump ? 1.05 : state === 'idle' ? 1.0 : 1.02;
  const shadowRx = isJump ? 46 : 64;
  const shadowOpacity = isJump ? 0.28 : 0.45;

  // Accessory SVG on top of head
  let accessorySVG = '';
  if (toad.accessory === 'leaf') {
    accessorySVG = `
      <g transform="translate(128, 36)">
        <path d="M0,16 C-4,0 -24,-12 -32,-4 C-24,12 -8,16 0,16 Z" fill="#38E54D" stroke="${toad.outline}" stroke-width="5" stroke-linejoin="round"/>
        <path d="M0,16 C6,-4 28,-16 36,-4 C26,12 10,16 0,16 Z" fill="#80FF72" stroke="${toad.outline}" stroke-width="5" stroke-linejoin="round"/>
        <path d="M0,18 L0,2" stroke="${toad.outline}" stroke-width="4" stroke-linecap="round"/>
      </g>`;
  } else if (toad.accessory === 'fin') {
    accessorySVG = `
      <g transform="translate(128, 34)">
        <path d="M-22,18 L-12,-4 L0,8 L12,-4 L22,18 Z" fill="#00F5D4" stroke="${toad.outline}" stroke-width="5" stroke-linejoin="round"/>
        <circle cx="-12" cy="-4" r="4" fill="#FFFFFF"/>
        <circle cx="12" cy="-4" r="4" fill="#FFFFFF"/>
      </g>`;
  } else if (toad.accessory === 'crest') {
    accessorySVG = `
      <g transform="translate(128, 34)">
        <path d="M-18,18 C-24,-2 -6,-12 0,4 C8,-14 24,-2 18,18 Z" fill="#FFBE0B" stroke="${toad.outline}" stroke-width="5" stroke-linejoin="round"/>
      </g>`;
  } else if (toad.accessory === 'crystal') {
    accessorySVG = `
      <g transform="translate(128, 32)">
        <polygon points="0,-12 12,6 0,20 -12,6" fill="#00F5D4" stroke="${toad.outline}" stroke-width="5" stroke-linejoin="round"/>
        <polygon points="0,-8 6,6 0,14 -6,6" fill="#FFFFFF" opacity="0.7"/>
      </g>`;
  } else if (toad.accessory === 'crown') {
    accessorySVG = `
      <g transform="translate(128, 30)">
        <path d="M-28,22 L-34,-4 L-14,10 L0,-12 L14,10 L34,-4 L28,22 Z" fill="url(#goldCrownGrad)" stroke="${toad.outline}" stroke-width="5" stroke-linejoin="round"/>
        <circle cx="0" cy="6" r="5" fill="#FF2A6D" stroke="${toad.outline}" stroke-width="2.5"/>
        <circle cx="-18" cy="10" r="4" fill="#00F5D4" stroke="${toad.outline}" stroke-width="2"/>
        <circle cx="18" cy="10" r="4" fill="#00F5D4" stroke="${toad.outline}" stroke-width="2"/>
      </g>`;
  }

  // Eyes rendering based on state
  let eyesSVG = '';
  if (isBlink) {
    eyesSVG = `
      <g>
        <circle cx="88" cy="78" r="30" fill="url(#bodyGrad)" stroke="${toad.outline}" stroke-width="6"/>
        <circle cx="168" cy="78" r="30" fill="url(#bodyGrad)" stroke="${toad.outline}" stroke-width="6"/>
        <path d="M68,80 Q88,92 108,80" fill="none" stroke="${toad.outline}" stroke-width="6" stroke-linecap="round"/>
        <path d="M148,80 Q168,92 188,80" fill="none" stroke="${toad.outline}" stroke-width="6" stroke-linecap="round"/>
      </g>`;
  } else if (isHappy && state === 'happy') {
    eyesSVG = `
      <g>
        <circle cx="88" cy="78" r="30" fill="#FFFFFF" stroke="${toad.outline}" stroke-width="6"/>
        <circle cx="168" cy="78" r="30" fill="#FFFFFF" stroke="${toad.outline}" stroke-width="6"/>
        <circle cx="90" cy="78" r="19" fill="${toad.iris}"/>
        <circle cx="166" cy="78" r="19" fill="${toad.iris}"/>
        <circle cx="90" cy="78" r="11" fill="#090C10"/>
        <circle cx="166" cy="78" r="11" fill="#090C10"/>
        <circle cx="82" cy="70" r="7" fill="#FFFFFF"/>
        <circle cx="158" cy="70" r="7" fill="#FFFFFF"/>
        <circle cx="97" cy="85" r="3.5" fill="#FFFFFF"/>
        <circle cx="173" cy="85" r="3.5" fill="#FFFFFF"/>
        <path d="M64,92 Q88,78 112,92" fill="url(#bodyGrad)" stroke="${toad.outline}" stroke-width="5" stroke-linecap="round"/>
        <path d="M144,92 Q168,78 192,92" fill="url(#bodyGrad)" stroke="${toad.outline}" stroke-width="5" stroke-linecap="round"/>
      </g>`;
  } else if (isShocked) {
    eyesSVG = `
      <g>
        <circle cx="86" cy="74" r="33" fill="#FFFFFF" stroke="${toad.outline}" stroke-width="6"/>
        <circle cx="170" cy="74" r="33" fill="#FFFFFF" stroke="${toad.outline}" stroke-width="6"/>
        <circle cx="88" cy="74" r="12" fill="${toad.iris}"/>
        <circle cx="168" cy="74" r="12" fill="${toad.iris}"/>
        <circle cx="88" cy="74" r="6" fill="#090C10"/>
        <circle cx="168" cy="74" r="6" fill="#090C10"/>
        <circle cx="83" cy="69" r="5" fill="#FFFFFF"/>
        <circle cx="163" cy="69" r="5" fill="#FFFFFF"/>
      </g>`;
  } else {
    // idle, excited, win, jump
    const starEyes = state === 'win' || state === 'excited';
    eyesSVG = `
      <g>
        <circle cx="88" cy="78" r="31" fill="#FFFFFF" stroke="${toad.outline}" stroke-width="6"/>
        <circle cx="168" cy="78" r="31" fill="#FFFFFF" stroke="${toad.outline}" stroke-width="6"/>
        <circle cx="91" cy="78" r="20" fill="${toad.iris}"/>
        <circle cx="165" cy="78" r="20" fill="${toad.iris}"/>
        <circle cx="91" cy="78" r="12" fill="#090C10"/>
        <circle cx="165" cy="78" r="12" fill="#090C10"/>
        <circle cx="83" cy="69" r="8" fill="#FFFFFF"/>
        <circle cx="157" cy="69" r="8" fill="#FFFFFF"/>
        <circle cx="98" cy="86" r="4" fill="#FFFFFF"/>
        <circle cx="172" cy="86" r="4" fill="#FFFFFF"/>
        ${
          starEyes
            ? `<polygon points="91,64 94,72 102,75 94,78 91,86 88,78 80,75 88,72" fill="#FFF3B0"/>
               <polygon points="165,64 168,72 176,75 168,78 165,86 162,78 154,75 162,72" fill="#FFF3B0"/>`
            : ''
        }
      </g>`;
  }

  // Mouth rendering based on state
  let mouthSVG = '';
  if (isShocked) {
    mouthSVG = `
      <ellipse cx="128" cy="132" rx="18" ry="22" fill="#6B0F2B" stroke="${toad.outline}" stroke-width="5"/>
      <ellipse cx="128" cy="142" rx="12" ry="9" fill="#FF6B8B"/>`;
  } else if (isExcited || isHappy || isJump) {
    mouthSVG = `
      <path d="M84,118 Q128,130 172,118 C170,154 86,154 84,118 Z" fill="#6B0F2B" stroke="${toad.outline}" stroke-width="5.5" stroke-linejoin="round"/>
      <path d="M102,138 Q128,125 154,138 C146,150 110,150 102,138 Z" fill="#FF6B8B"/>`;
  } else {
    // idle / blink
    mouthSVG = `
      <path d="M88,122 Q128,142 168,122" fill="none" stroke="${toad.outline}" stroke-width="6" stroke-linecap="round"/>
      <path d="M116,133 Q128,145 140,133 Z" fill="#FF6B8B" stroke="${toad.outline}" stroke-width="4" stroke-linejoin="round"/>`;
  }

  // Arms based on state
  let armsSVG = '';
  if (isExcited || isJump || state === 'win') {
    armsSVG = `
      <path d="M62,150 C32,126 22,98 34,88 C44,80 58,104 72,132" fill="url(#bodyGrad)" stroke="${toad.outline}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M194,150 C224,126 234,98 222,88 C212,80 198,104 184,132" fill="url(#bodyGrad)" stroke="${toad.outline}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="32" cy="88" r="9" fill="${toad.bodyLight}" stroke="${toad.outline}" stroke-width="4"/>
      <circle cx="224" cy="88" r="9" fill="${toad.bodyLight}" stroke="${toad.outline}" stroke-width="4"/>`;
  } else {
    armsSVG = `
      <path d="M66,154 C46,168 48,196 66,204 C78,208 86,192 82,172" fill="url(#bodyGrad)" stroke="${toad.outline}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M190,154 C210,168 208,196 190,204 C178,208 170,192 174,172" fill="url(#bodyGrad)" stroke="${toad.outline}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  // Win aura / sparkles
  const fxSVG =
    state === 'win' || state === 'excited'
      ? `
      <g opacity="0.95">
        <polygon points="32,46 36,56 46,60 36,64 32,74 28,64 18,60 28,56" fill="#FFD100" stroke="${toad.outline}" stroke-width="2"/>
        <polygon points="224,46 228,56 238,60 228,64 224,74 220,64 210,60 220,56" fill="#FFD100" stroke="${toad.outline}" stroke-width="2"/>
        <circle cx="48" cy="30" r="5" fill="#00F5D4"/>
        <circle cx="208" cy="30" r="5" fill="#00F5D4"/>
      </g>`
      : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
    <defs>
      <radialGradient id="bodyGrad" cx="38%" cy="28%" r="70%">
        <stop offset="0%" stop-color="${toad.bodyLight}"/>
        <stop offset="55%" stop-color="${toad.bodyMid}"/>
        <stop offset="100%" stop-color="${toad.bodyDark}"/>
      </radialGradient>
      <linearGradient id="bellyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="${toad.bellyLight}"/>
        <stop offset="100%" stop-color="${toad.bellyDark}"/>
      </linearGradient>
      <linearGradient id="goldCrownGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#FFF8B8"/>
        <stop offset="50%" stop-color="#FFD100"/>
        <stop offset="100%" stop-color="#D97706"/>
      </linearGradient>
    </defs>

    <!-- Ground / Lilypad Shadow -->
    <ellipse cx="128" cy="232" rx="${shadowRx}" ry="14" fill="#041518" opacity="${shadowOpacity}"/>

    <g transform="translate(0, ${offsetY}) scale(1, ${scaleY})">
      <!-- Back Legs -->
      <ellipse cx="66" cy="198" rx="30" ry="22" transform="rotate(-18 66 198)" fill="url(#bodyGrad)" stroke="${toad.outline}" stroke-width="6"/>
      <ellipse cx="190" cy="198" rx="30" ry="22" transform="rotate(18 190 198)" fill="url(#bodyGrad)" stroke="${toad.outline}" stroke-width="6"/>

      <!-- Webbed Feet -->
      <path d="M36,214 C42,202 68,202 78,216 C64,222 46,222 36,214 Z" fill="${toad.bodyLight}" stroke="${toad.outline}" stroke-width="5.5" stroke-linejoin="round"/>
      <path d="M178,216 C188,202 214,202 220,214 C210,222 192,222 178,216 Z" fill="${toad.bodyLight}" stroke="${toad.outline}" stroke-width="5.5" stroke-linejoin="round"/>

      <!-- Main Chubby Body & Head -->
      <ellipse cx="128" cy="150" rx="76" ry="68" fill="url(#bodyGrad)" stroke="${toad.outline}" stroke-width="6.5"/>
      <ellipse cx="128" cy="112" rx="74" ry="54" fill="url(#bodyGrad)" stroke="${toad.outline}" stroke-width="6.5"/>
      <!-- Seamless body merge fill -->
      <ellipse cx="128" cy="134" rx="71" ry="56" fill="url(#bodyGrad)"/>

      <!-- Glossy Rim Highlight -->
      <path d="M68,94 C88,68 168,68 188,94" fill="none" stroke="${toad.rim}" stroke-width="4" stroke-linecap="round" opacity="0.65"/>

      <!-- Belly Patch -->
      <ellipse cx="128" cy="168" rx="48" ry="40" fill="url(#bellyGrad)" stroke="${toad.outline}" stroke-width="4"/>
      <ellipse cx="114" cy="154" rx="16" ry="9" fill="#FFFFFF" opacity="0.45" transform="rotate(-15 114 154)"/>

      <!-- Cheeks -->
      <ellipse cx="68" cy="118" rx="13" ry="8" fill="${toad.cheek}" opacity="0.75"/>
      <ellipse cx="188" cy="118" rx="13" ry="8" fill="${toad.cheek}" opacity="0.75"/>

      <!-- Arms -->
      ${armsSVG}

      <!-- Head Accessory -->
      ${accessorySVG}

      <!-- Eyes -->
      ${eyesSVG}

      <!-- Nostrils -->
      <circle cx="120" cy="102" r="3" fill="${toad.outline}"/>
      <circle cx="136" cy="102" r="3" fill="${toad.outline}"/>

      <!-- Mouth -->
      ${mouthSVG}
    </g>

    ${fxSVG}
  </svg>`;
}

for (const toad of TOADS) {
  for (const state of TOAD_STATES) {
    const svg = renderToadSVG(toad, state);
    saveAsset(`characters/tiny_toad_${toad.id}_${state}`, svg, 256);
  }
}

// ============================================================================
// 2. REEL SYMBOLS (COMMON, SPECIAL, FEATURE + STATES)
// ============================================================================
const SYMBOLS = [
  // Common carved wood symbols
  { id: 'symbol_a', type: 'common', label: 'A', color1: '#FF4D6D', color2: '#A4133C', rim: '#FFB3C1' },
  { id: 'symbol_k', type: 'common', label: 'K', color1: '#FFB703', color2: '#B65E00', rim: '#FFF3B0' },
  { id: 'symbol_q', type: 'common', label: 'Q', color1: '#C77DFF', color2: '#5A189A', rim: '#F3D5FF' },
  { id: 'symbol_j', type: 'common', label: 'J', color1: '#00B4D8', color2: '#03045E', rim: '#90E0EF' },
  { id: 'symbol_10', type: 'common', label: '10', color1: '#38E54D', color2: '#0D7A22', rim: '#B7FFBF' },

  // Special swamp symbols
  { id: 'symbol_frog', type: 'special', name: 'Rana' },
  { id: 'symbol_lilypad', type: 'special', name: 'Nenúfar' },
  { id: 'symbol_chest', type: 'special', name: 'Cofre' },
  { id: 'symbol_rock', type: 'special', name: 'Roca' },
  { id: 'symbol_dragonfly', type: 'special', name: 'Libélula' },
  { id: 'symbol_firefly', type: 'special', name: 'Luciérnaga' },
  { id: 'symbol_water_flower', type: 'special', name: 'Flor Acuática' },
  { id: 'symbol_snail', type: 'special', name: 'Caracol' },
  { id: 'symbol_fish', type: 'special', name: 'Pez' },
  { id: 'symbol_tropical_fruit', type: 'special', name: 'Fruta Tropical' },

  // Feature symbols
  { id: 'symbol_wild', type: 'feature', badge: 'WILD', c1: '#FFD100', c2: '#FF5400' },
  { id: 'symbol_bonus', type: 'feature', badge: 'BONUS', c1: '#FF2A6D', c2: '#7209B7' },
  { id: 'symbol_scatter', type: 'feature', badge: 'SCATTER', c1: '#00F5D4', c2: '#0077B6' },
  { id: 'symbol_prize', type: 'feature', badge: 'PRIZE', c1: '#FFF3B0', c2: '#FB8500' },
];

function renderSymbolIllustration(sym) {
  if (sym.type === 'common') {
    return `
      <!-- Carved Swamp Wood Backing Tile -->
      <rect x="26" y="26" width="148" height="148" rx="30" fill="url(#woodTileGrad)" stroke="#1A0C05" stroke-width="7"/>
      <rect x="34" y="34" width="132" height="132" rx="22" fill="none" stroke="#8C583A" stroke-width="3" opacity="0.65"/>
      <!-- Wood grain notches -->
      <path d="M48,34 L54,44 M148,34 L142,44 M34,130 L46,126 M166,118 L154,122" stroke="#241107" stroke-width="4" stroke-linecap="round"/>
      <!-- Corner swamp leaves -->
      <path d="M26,52 C14,34 32,16 52,28 C44,40 34,46 26,52 Z" fill="#38E54D" stroke="#1A0C05" stroke-width="4"/>
      <path d="M174,148 C186,166 168,184 148,172 C156,160 166,154 174,148 Z" fill="#38E54D" stroke="#1A0C05" stroke-width="4"/>
      <!-- 3D Extruded Letter -->
      <text x="100" y="136" font-family="DejaVu Sans, sans-serif" font-weight="900" font-size="${sym.label === '10' ? '82' : '98'}" text-anchor="middle" fill="#1A0C05" stroke="#1A0C05" stroke-width="18" stroke-linejoin="round">${sym.label}</text>
      <text x="100" y="130" font-family="DejaVu Sans, sans-serif" font-weight="900" font-size="${sym.label === '10' ? '82' : '98'}" text-anchor="middle" fill="url(#symGrad_${sym.id})" stroke="#1A0C05" stroke-width="10" stroke-linejoin="round">${sym.label}</text>
      <text x="100" y="128" font-family="DejaVu Sans, sans-serif" font-weight="900" font-size="${sym.label === '10' ? '82' : '98'}" text-anchor="middle" fill="url(#symGrad_${sym.id})">${sym.label}</text>
      <!-- Specular Sparkles -->
      <circle cx="54" cy="54" r="4" fill="#FFF8D6"/>
      <circle cx="148" cy="56" r="3" fill="#00F5D4"/>
    `;
  }

  switch (sym.id) {
    case 'symbol_frog':
      return `
        <circle cx="100" cy="104" r="72" fill="#0B3B3C" stroke="#FFD100" stroke-width="6"/>
        <ellipse cx="100" cy="122" rx="54" ry="44" fill="url(#frogSymGrad)" stroke="#1A0C05" stroke-width="6"/>
        <circle cx="72" cy="78" r="22" fill="#FFFFFF" stroke="#1A0C05" stroke-width="5.5"/>
        <circle cx="128" cy="78" r="22" fill="#FFFFFF" stroke="#1A0C05" stroke-width="5.5"/>
        <circle cx="74" cy="78" r="11" fill="#090C10"/>
        <circle cx="126" cy="78" r="11" fill="#090C10"/>
        <circle cx="69" cy="72" r="5" fill="#FFFFFF"/>
        <circle cx="121" cy="72" r="5" fill="#FFFFFF"/>
        <path d="M68,118 Q100,142 132,118" fill="none" stroke="#1A0C05" stroke-width="6" stroke-linecap="round"/>
        <polygon points="100,34 112,54 88,54" fill="#FFD100" stroke="#1A0C05" stroke-width="4"/>
      `;
    case 'symbol_lilypad':
      return `
        <ellipse cx="100" cy="112" rx="74" ry="54" fill="#00A8E8" opacity="0.45"/>
        <path d="M100,106 L166,78 C182,118 148,162 96,162 C44,162 18,120 38,76 C58,42 128,42 154,66 Z" fill="url(#lilyGrad)" stroke="#1A0C05" stroke-width="6.5" stroke-linejoin="round"/>
        <path d="M100,106 L64,64 M100,106 L52,108 M100,106 L78,148 M100,106 L132,142 M100,106 L130,64" stroke="#145A1D" stroke-width="4" stroke-linecap="round"/>
        <!-- Water droplets -->
        <circle cx="72" cy="94" r="8" fill="#72F6FF" stroke="#1A0C05" stroke-width="3"/>
        <circle cx="70" cy="91" r="3" fill="#FFFFFF"/>
        <circle cx="122" cy="122" r="6" fill="#72F6FF" stroke="#1A0C05" stroke-width="2.5"/>
      `;
    case 'symbol_chest':
      return `
        <!-- Treasure Chest -->
        <rect x="34" y="84" width="132" height="78" rx="14" fill="url(#woodTileGrad)" stroke="#1A0C05" stroke-width="6.5"/>
        <!-- Glowing gold coins inside -->
        <ellipse cx="100" cy="84" rx="58" ry="18" fill="#FFD100" stroke="#1A0C05" stroke-width="4"/>
        <circle cx="76" cy="80" r="12" fill="#FFF3B0"/>
        <circle cx="102" cy="76" r="14" fill="#FFD100"/>
        <circle cx="126" cy="80" r="11" fill="#FFF3B0"/>
        <!-- Chest Lid -->
        <path d="M30,82 C30,42 170,42 170,82 Z" fill="#6F3818" stroke="#1A0C05" stroke-width="6.5" stroke-linejoin="round"/>
        <!-- Gold straps & lock -->
        <rect x="52" y="52" width="16" height="110" fill="#FFB703" stroke="#1A0C05" stroke-width="4"/>
        <rect x="132" y="52" width="16" height="110" fill="#FFB703" stroke="#1A0C05" stroke-width="4"/>
        <rect x="84" y="76" width="32" height="38" rx="8" fill="#FFD100" stroke="#1A0C05" stroke-width="5"/>
        <circle cx="100" cy="94" r="6" fill="#1A0C05"/>
      `;
    case 'symbol_rock':
      return `
        <!-- Mossy Swamp Rune Stone -->
        <polygon points="52,162 32,108 62,44 134,38 168,98 152,162" fill="#5C6B73" stroke="#1A0C05" stroke-width="6.5" stroke-linejoin="round"/>
        <polygon points="62,44 134,38 152,82 72,88" fill="#8D99AE" opacity="0.5"/>
        <!-- Glowing Cyan Rune -->
        <path d="M100,64 L124,98 L100,136 L76,98 Z" fill="none" stroke="#00F5D4" stroke-width="7" stroke-linejoin="round"/>
        <circle cx="100" cy="100" r="10" fill="#00F5D4"/>
        <!-- Green Moss Cap -->
        <path d="M48,68 C62,36 136,32 152,66 C134,78 116,64 98,74 C78,62 64,78 48,68 Z" fill="#38E54D" stroke="#1A0C05" stroke-width="5" stroke-linejoin="round"/>
      `;
    case 'symbol_dragonfly':
      return `
        <!-- Glowing Wings -->
        <ellipse cx="62" cy="76" rx="44" ry="18" transform="rotate(-22 62 76)" fill="#72F6FF" opacity="0.85" stroke="#1A0C05" stroke-width="5"/>
        <ellipse cx="138" cy="76" rx="44" ry="18" transform="rotate(22 138 76)" fill="#72F6FF" opacity="0.85" stroke="#1A0C05" stroke-width="5"/>
        <ellipse cx="66" cy="112" rx="36" ry="14" transform="rotate(14 66 112)" fill="#E0AAFF" opacity="0.85" stroke="#1A0C05" stroke-width="5"/>
        <ellipse cx="134" cy="112" rx="36" ry="14" transform="rotate(-14 134 112)" fill="#E0AAFF" opacity="0.85" stroke="#1A0C05" stroke-width="5"/>
        <!-- Jeweled Body -->
        <rect x="91" y="54" width="18" height="112" rx="9" fill="#00F5D4" stroke="#1A0C05" stroke-width="5.5"/>
        <circle cx="100" cy="52" r="18" fill="#38E54D" stroke="#1A0C05" stroke-width="5.5"/>
        <circle cx="90" cy="46" r="8" fill="#FFD100" stroke="#1A0C05" stroke-width="3"/>
        <circle cx="110" cy="46" r="8" fill="#FFD100" stroke="#1A0C05" stroke-width="3"/>
      `;
    case 'symbol_firefly':
      return `
        <!-- Outer Glow Aura -->
        <circle cx="100" cy="134" r="46" fill="#FFD100" opacity="0.35"/>
        <!-- Wings -->
        <ellipse cx="66" cy="86" rx="34" ry="18" transform="rotate(-28 66 86)" fill="#FFF8D6" stroke="#1A0C05" stroke-width="5"/>
        <ellipse cx="134" cy="86" rx="34" ry="18" transform="rotate(28 134 86)" fill="#FFF8D6" stroke="#1A0C05" stroke-width="5"/>
        <!-- Glowing Lantern Abdomen -->
        <ellipse cx="100" cy="132" rx="30" ry="34" fill="#FFF3B0" stroke="#1A0C05" stroke-width="6"/>
        <ellipse cx="100" cy="132" rx="22" ry="25" fill="#FFD100"/>
        <!-- Thorax & Cute Head -->
        <ellipse cx="100" cy="86" rx="26" ry="22" fill="#5A189A" stroke="#1A0C05" stroke-width="6"/>
        <circle cx="88" cy="80" r="8" fill="#FFFFFF" stroke="#1A0C05" stroke-width="3"/>
        <circle cx="112" cy="80" r="8" fill="#FFFFFF" stroke="#1A0C05" stroke-width="3"/>
        <path d="M88,64 C78,42 62,44 66,54" fill="none" stroke="#1A0C05" stroke-width="5" stroke-linecap="round"/>
        <path d="M112,64 C122,42 138,44 134,54" fill="none" stroke="#1A0C05" stroke-width="5" stroke-linecap="round"/>
      `;
    case 'symbol_water_flower':
      return `
        <!-- Lily base -->
        <ellipse cx="100" cy="142" rx="68" ry="24" fill="#38E54D" stroke="#1A0C05" stroke-width="5.5"/>
        <!-- Back Petals -->
        <path d="M100,38 C124,66 126,114 100,138 C74,114 76,66 100,38 Z" fill="#FF70A6" stroke="#1A0C05" stroke-width="5.5"/>
        <path d="M52,58 C88,72 104,112 96,138 C64,126 44,92 52,58 Z" fill="#FF4D6D" stroke="#1A0C05" stroke-width="5.5"/>
        <path d="M148,58 C112,72 96,112 104,138 C136,126 156,92 148,58 Z" fill="#FF4D6D" stroke="#1A0C05" stroke-width="5.5"/>
        <!-- Front Petals -->
        <path d="M32,96 C68,94 94,116 100,140 C66,144 38,126 32,96 Z" fill="#FF85A1" stroke="#1A0C05" stroke-width="5.5"/>
        <path d="M168,96 C132,94 106,116 100,140 C134,144 162,126 168,96 Z" fill="#FF85A1" stroke="#1A0C05" stroke-width="5.5"/>
        <circle cx="100" cy="116" r="16" fill="#FFD100" stroke="#1A0C05" stroke-width="4.5"/>
      `;
    case 'symbol_snail':
      return `
        <!-- Soft Snail Body -->
        <path d="M28,144 C44,126 146,126 172,142 C180,154 156,164 98,164 C44,164 20,154 28,144 Z" fill="#72F6FF" stroke="#1A0C05" stroke-width="6" stroke-linejoin="round"/>
        <circle cx="156" cy="96" r="7" fill="#FFFFFF" stroke="#1A0C05" stroke-width="4"/>
        <circle cx="174" cy="102" r="7" fill="#FFFFFF" stroke="#1A0C05" stroke-width="4"/>
        <line x1="148" y1="132" x2="156" y2="103" stroke="#1A0C05" stroke-width="5"/>
        <line x1="160" y1="134" x2="172" y2="109" stroke="#1A0C05" stroke-width="5"/>
        <!-- Spiral Crystal Shell -->
        <circle cx="88" cy="104" r="46" fill="#9D4EDD" stroke="#1A0C05" stroke-width="6.5"/>
        <path d="M88,104 C88,88 108,88 108,104 C108,124 72,124 72,100 C72,72 122,72 122,106" fill="none" stroke="#FFD100" stroke-width="6" stroke-linecap="round"/>
      `;
    case 'symbol_fish':
      return `
        <!-- Tropical Swamp Fish -->
        <path d="M142,100 L178,66 L170,100 L178,134 Z" fill="#FF2A6D" stroke="#1A0C05" stroke-width="6" stroke-linejoin="round"/>
        <ellipse cx="94" cy="100" rx="58" ry="42" fill="#00B4D8" stroke="#1A0C05" stroke-width="6.5"/>
        <path d="M74,60 C94,34 126,42 122,64" fill="#FFD100" stroke="#1A0C05" stroke-width="5.5" stroke-linejoin="round"/>
        <path d="M84,62 Q104,100 84,138" fill="none" stroke="#FFD100" stroke-width="8" stroke-linecap="round"/>
        <path d="M112,66 Q128,100 112,134" fill="none" stroke="#FF2A6D" stroke-width="7" stroke-linecap="round"/>
        <circle cx="62" cy="92" r="12" fill="#FFFFFF" stroke="#1A0C05" stroke-width="4.5"/>
        <circle cx="60" cy="92" r="6" fill="#090C10"/>
      `;
    case 'symbol_tropical_fruit':
      return `
        <!-- Exotic Glowing Star-Dragonfruit -->
        <ellipse cx="100" cy="110" rx="52" ry="58" fill="#FF2A6D" stroke="#1A0C05" stroke-width="6.5"/>
        <ellipse cx="100" cy="114" rx="38" ry="42" fill="#FFF8D6" stroke="#1A0C05" stroke-width="4"/>
        <!-- Seeds -->
        <circle cx="88" cy="100" r="3.5" fill="#1A0C05"/>
        <circle cx="112" cy="102" r="3.5" fill="#1A0C05"/>
        <circle cx="100" cy="116" r="3.5" fill="#1A0C05"/>
        <circle cx="86" cy="128" r="3.5" fill="#1A0C05"/>
        <circle cx="114" cy="126" r="3.5" fill="#1A0C05"/>
        <!-- Tropical Crown Leaves -->
        <path d="M100,52 L80,26 L98,40 L100,20 L106,40 L124,26 Z" fill="#38E54D" stroke="#1A0C05" stroke-width="5" stroke-linejoin="round"/>
      `;
    case 'symbol_wild':
      return `
        <circle cx="100" cy="94" r="70" fill="url(#featGrad_symbol_wild)" stroke="#1A0C05" stroke-width="7"/>
        <circle cx="100" cy="94" r="62" fill="none" stroke="#FFF3B0" stroke-width="3.5"/>
        <!-- Golden Lilypad & Crowned Frog Wild Emblem -->
        <ellipse cx="100" cy="112" rx="52" ry="22" fill="#38E54D" stroke="#1A0C05" stroke-width="5"/>
        <path d="M62,92 L54,54 L80,72 L100,42 L120,72 L146,54 L138,92 Z" fill="#FFF3B0" stroke="#1A0C05" stroke-width="5.5" stroke-linejoin="round"/>
        <circle cx="100" cy="76" r="7" fill="#FF2A6D" stroke="#1A0C05" stroke-width="2.5"/>
        <circle cx="78" cy="80" r="5" fill="#00F5D4" stroke="#1A0C05" stroke-width="2"/>
        <circle cx="122" cy="80" r="5" fill="#00F5D4" stroke="#1A0C05" stroke-width="2"/>
        <rect x="18" y="132" width="164" height="46" rx="15" fill="#1A0C05" stroke="#FFD100" stroke-width="5.5"/>
        <text x="100" y="164" font-family="DejaVu Sans, sans-serif" font-weight="900" font-size="31" text-anchor="middle" fill="#FFD100" letter-spacing="2">WILD</text>
      `;
    case 'symbol_bonus':
      return `
        <circle cx="100" cy="94" r="70" fill="url(#featGrad_symbol_bonus)" stroke="#1A0C05" stroke-width="7"/>
        <circle cx="100" cy="94" r="62" fill="none" stroke="#FF85A1" stroke-width="3.5"/>
        <!-- Golden Totem Drum & Gems -->
        <rect x="56" y="48" width="88" height="76" rx="16" fill="#FFB703" stroke="#1A0C05" stroke-width="5.5"/>
        <circle cx="82" cy="76" r="10" fill="#00F5D4" stroke="#1A0C05" stroke-width="3.5"/>
        <circle cx="118" cy="76" r="10" fill="#00F5D4" stroke="#1A0C05" stroke-width="3.5"/>
        <rect x="74" y="98" width="52" height="14" rx="5" fill="#FFF3B0" stroke="#1A0C05" stroke-width="3.5"/>
        <rect x="18" y="132" width="164" height="46" rx="15" fill="#1A0C05" stroke="#FF2A6D" stroke-width="5.5"/>
        <text x="100" y="163" font-family="DejaVu Sans, sans-serif" font-weight="900" font-size="28" text-anchor="middle" fill="#FF85A1" letter-spacing="1.5">BONUS</text>
      `;
    case 'symbol_scatter':
      return `
        <circle cx="100" cy="94" r="70" fill="url(#featGrad_symbol_scatter)" stroke="#1A0C05" stroke-width="7"/>
        <circle cx="100" cy="94" r="62" fill="none" stroke="#72F6FF" stroke-width="3.5"/>
        <!-- Bioluminescent Crystal Cluster -->
        <polygon points="100,30 122,74 100,122 78,74" fill="#00F5D4" stroke="#1A0C05" stroke-width="5" stroke-linejoin="round"/>
        <polygon points="64,52 88,82 72,118 52,84" fill="#E0AAFF" stroke="#1A0C05" stroke-width="4.5" stroke-linejoin="round"/>
        <polygon points="136,52 148,84 128,118 112,82" fill="#E0AAFF" stroke="#1A0C05" stroke-width="4.5" stroke-linejoin="round"/>
        <rect x="14" y="132" width="172" height="46" rx="15" fill="#1A0C05" stroke="#00F5D4" stroke-width="5.5"/>
        <text x="100" y="162" font-family="DejaVu Sans, sans-serif" font-weight="900" font-size="25" text-anchor="middle" fill="#00F5D4" letter-spacing="1">SCATTER</text>
      `;
    default:
      // symbol_prize: Golden Pearl Lotus Prize
      return `
        <circle cx="100" cy="94" r="70" fill="url(#featGrad_${sym.id})" stroke="#1A0C05" stroke-width="7"/>
        <circle cx="100" cy="94" r="62" fill="none" stroke="#FFFFFF" stroke-width="3.5" opacity="0.8"/>
        <path d="M44,104 C64,128 136,128 156,104 C142,76 58,76 44,104 Z" fill="#FF2A6D" stroke="#1A0C05" stroke-width="5"/>
        <circle cx="100" cy="82" r="28" fill="#FFF8D6" stroke="#1A0C05" stroke-width="5"/>
        <circle cx="90" cy="72" r="9" fill="#FFFFFF"/>
        <rect x="18" y="132" width="164" height="46" rx="15" fill="#1A0C05" stroke="#FFD100" stroke-width="5.5"/>
        <text x="100" y="163" font-family="DejaVu Sans, sans-serif" font-weight="900" font-size="28" text-anchor="middle" fill="#FFF3B0" letter-spacing="1.5">${sym.badge}</text>
      `;
  }
}

const SYMBOL_STATES = ['normal', 'highlighted', 'winning', 'disabled', 'animated'];

for (const sym of SYMBOLS) {
  for (const st of SYMBOL_STATES) {
    const isHighlight = st === 'highlighted' || st === 'winning' || st === 'animated';
    const isWin = st === 'winning' || st === 'animated';
    const isDisabled = st === 'disabled';

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
      <defs>
        <linearGradient id="woodTileGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#7A4424"/>
          <stop offset="50%" stop-color="#4E2A14"/>
          <stop offset="100%" stop-color="#2B1508"/>
        </linearGradient>
        <linearGradient id="lilyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#80FF72"/>
          <stop offset="100%" stop-color="#18A558"/>
        </linearGradient>
        <radialGradient id="frogSymGrad" cx="40%" cy="30%" r="70%">
          <stop offset="0%" stop-color="#FFF3B0"/>
          <stop offset="55%" stop-color="#FFD100"/>
          <stop offset="100%" stop-color="#D97706"/>
        </radialGradient>
        ${
          sym.type === 'common'
            ? `<linearGradient id="symGrad_${sym.id}" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="${sym.rim}"/>
                <stop offset="45%" stop-color="${sym.color1}"/>
                <stop offset="100%" stop-color="${sym.color2}"/>
              </linearGradient>`
            : ''
        }
        ${
          sym.type === 'feature'
            ? `<radialGradient id="featGrad_${sym.id}" cx="50%" cy="40%" r="65%">
                <stop offset="0%" stop-color="${sym.c1}"/>
                <stop offset="100%" stop-color="${sym.c2}"/>
              </radialGradient>`
            : ''
        }
      </defs>

      <g opacity="${isDisabled ? '0.42' : '1'}">
        ${
          isHighlight
            ? `<rect x="10" y="10" width="180" height="180" rx="36" fill="none" stroke="${isWin ? '#FFD100' : '#00F5D4'}" stroke-width="${isWin ? '8' : '5'}" opacity="0.9"/>`
            : ''
        }
        ${
          isWin
            ? `<circle cx="100" cy="100" r="88" fill="#FFD100" opacity="0.22"/>
               <polygon points="28,28 33,40 45,45 33,50 28,62 23,50 11,45 23,40" fill="#FFF3B0"/>
               <polygon points="172,28 177,40 189,45 177,50 172,62 167,50 155,45 167,40" fill="#FFF3B0"/>`
            : ''
        }
        ${renderSymbolIllustration(sym)}
      </g>
    </svg>`;

    saveAsset(`symbols/${sym.id}_${st}`, svg, 200);
    if (st === 'normal') {
      saveAsset(`symbols/${sym.id}`, svg, 200);
    }
  }
}

// ============================================================================
// 3. REEL MACHINE FRAME (5x3 DARK SWAMP WOOD, ROOTS, VINES, GLOW)
// ============================================================================
const reelFrameSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 520" width="920" height="520">
  <defs>
    <linearGradient id="woodFrameGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#69381C"/>
      <stop offset="50%" stop-color="#3D1E0D"/>
      <stop offset="100%" stop-color="#210E05"/>
    </linearGradient>
    <linearGradient id="goldTrimGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFF3B0"/>
      <stop offset="50%" stop-color="#FFD100"/>
      <stop offset="100%" stop-color="#B65E00"/>
    </linearGradient>
    <linearGradient id="reelBgGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#051B24" stop-opacity="0.92"/>
      <stop offset="50%" stop-color="#092C36" stop-opacity="0.88"/>
      <stop offset="100%" stop-color="#04151C" stop-opacity="0.94"/>
    </linearGradient>
  </defs>

  <!-- Outer Roots & Swamp Branches -->
  <path d="M36,48 C6,20 4,6 28,12 C52,18 68,36 60,52 Z" fill="#3D1E0D" stroke="#1A0C05" stroke-width="5"/>
  <path d="M884,48 C914,20 916,6 892,12 C868,18 852,36 860,52 Z" fill="#3D1E0D" stroke="#1A0C05" stroke-width="5"/>
  <path d="M36,472 C6,500 4,514 28,508 C52,502 68,484 60,468 Z" fill="#3D1E0D" stroke="#1A0C05" stroke-width="5"/>
  <path d="M884,472 C914,500 916,514 892,508 C868,502 852,484 860,468 Z" fill="#3D1E0D" stroke="#1A0C05" stroke-width="5"/>

  <!-- Main Dark Wood Outer Frame -->
  <rect x="20" y="20" width="880" height="480" rx="36" fill="url(#woodFrameGrad)" stroke="#1A0C05" stroke-width="8"/>
  <rect x="32" y="32" width="856" height="456" rx="28" fill="none" stroke="url(#goldTrimGrad)" stroke-width="5"/>

  <!-- Inner Reel Cavern (5x3 Grid Area: x=46..874, y=46..474 -> 828x428) -->
  <rect x="46" y="46" width="828" height="428" rx="20" fill="url(#reelBgGrad)" stroke="#00F5D4" stroke-width="3" stroke-opacity="0.65"/>

  <!-- 4 Vertical Illuminated Reel Separators (using rects so gradient renders crisply) -->
  <g opacity="0.92">
    <rect x="208.6" y="48" width="6" height="424" rx="3" fill="url(#goldTrimGrad)" stroke="#1A0C05" stroke-width="1.5"/>
    <rect x="374.2" y="48" width="6" height="424" rx="3" fill="url(#goldTrimGrad)" stroke="#1A0C05" stroke-width="1.5"/>
    <rect x="539.8" y="48" width="6" height="424" rx="3" fill="url(#goldTrimGrad)" stroke="#1A0C05" stroke-width="1.5"/>
    <rect x="705.4" y="48" width="6" height="424" rx="3" fill="url(#goldTrimGrad)" stroke="#1A0C05" stroke-width="1.5"/>
    <!-- Glowing Cyan Center Threads on Dividers -->
    <rect x="210.6" y="56" width="2" height="408" fill="#00F5D4" opacity="0.7"/>
    <rect x="376.2" y="56" width="2" height="408" fill="#00F5D4" opacity="0.7"/>
    <rect x="541.8" y="56" width="2" height="408" fill="#00F5D4" opacity="0.7"/>
    <rect x="707.4" y="56" width="2" height="408" fill="#00F5D4" opacity="0.7"/>
  </g>

  <!-- Horizontal Subtle Row Guides -->
  <g opacity="0.22" fill="#00F5D4">
    <rect x="50" y="188" width="820" height="2"/>
    <rect x="50" y="330" width="820" height="2"/>
  </g>

  <!-- Swamp Vines, Mossy Roots & Metallic Rivets along the Frame -->
  <g stroke="#1A0C05" stroke-width="4" stroke-linejoin="round">
    <path d="M120,20 C160,8 210,12 250,24 C210,32 160,30 120,20 Z" fill="#29D844"/>
    <path d="M670,20 C710,8 760,12 800,24 C760,32 710,30 670,20 Z" fill="#29D844"/>
    <path d="M140,500 C180,512 230,508 270,496 C230,488 180,490 140,500 Z" fill="#29D844"/>
    <path d="M650,500 C690,512 740,508 780,496 C740,488 690,490 650,500 Z" fill="#29D844"/>
    <!-- Bronze/Gold Swamp Rivets -->
    <circle cx="211.6" cy="30" r="6" fill="#FFD100"/>
    <circle cx="377.2" cy="30" r="6" fill="#FFD100"/>
    <circle cx="542.8" cy="30" r="6" fill="#FFD100"/>
    <circle cx="708.4" cy="30" r="6" fill="#FFD100"/>
    <circle cx="211.6" cy="490" r="6" fill="#FFD100"/>
    <circle cx="377.2" cy="490" r="6" fill="#FFD100"/>
    <circle cx="542.8" cy="490" r="6" fill="#FFD100"/>
    <circle cx="708.4" cy="490" r="6" fill="#FFD100"/>
  </g>

  <!-- Corner Tropical Leaves & Glowing Gems -->
  <g stroke="#1A0C05" stroke-width="4">
    <path d="M18,76 C-4,44 26,10 66,22 C48,44 36,60 18,76 Z" fill="#38E54D"/>
    <path d="M902,76 C924,44 894,10 854,22 C872,44 884,60 902,76 Z" fill="#38E54D"/>
    <path d="M18,444 C-4,476 26,510 66,498 C48,476 36,460 18,444 Z" fill="#38E54D"/>
    <path d="M902,444 C924,476 894,510 854,498 C872,476 884,460 902,444 Z" fill="#38E54D"/>
    <circle cx="42" cy="42" r="10" fill="#00F5D4"/>
    <circle cx="878" cy="42" r="10" fill="#00F5D4"/>
    <circle cx="42" cy="478" r="10" fill="#00F5D4"/>
    <circle cx="878" cy="478" r="10" fill="#00F5D4"/>
  </g>
</svg>`;
saveAsset('reels/reel_frame', reelFrameSVG, 920);

// ============================================================================
// 4. BACKGROUND PARALLAX LAYERS & WATER OVERLAY (1280x720)
// ============================================================================
const bgLayerBackgroundSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720">
  <defs>
    <linearGradient id="skySwamp" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#071E26"/>
      <stop offset="45%" stop-color="#0B4F5C"/>
      <stop offset="100%" stop-color="#00A8E8"/>
    </linearGradient>
    <radialGradient id="sunGlow" cx="50%" cy="22%" r="45%">
      <stop offset="0%" stop-color="#FFF3B0" stop-opacity="0.75"/>
      <stop offset="50%" stop-color="#00F5D4" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#071E26" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#skySwamp)"/>
  <circle cx="640" cy="160" r="460" fill="url(#sunGlow)"/>
  <!-- Distant Swamp Canopy Silhouettes -->
  <path d="M0,380 Q180,310 340,360 T720,350 T1080,365 T1280,340 L1280,720 L0,720 Z" fill="#062930" opacity="0.6"/>
</svg>`;
saveAsset('background/bg_layer_background', bgLayerBackgroundSVG, 1280);

const bgLayerMidgroundSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720">
  <!-- Glowing Lilypads & Lotus Flowers on Water -->
  <g opacity="0.92">
    <ellipse cx="140" cy="590" rx="95" ry="32" fill="#29D844" stroke="#0A2910" stroke-width="5"/>
    <ellipse cx="1140" cy="585" rx="95" ry="32" fill="#29D844" stroke="#0A2910" stroke-width="5"/>
    <ellipse cx="240" cy="660" rx="75" ry="25" fill="#38E54D" stroke="#0A2910" stroke-width="4"/>
    <ellipse cx="1040" cy="655" rx="75" ry="25" fill="#38E54D" stroke="#0A2910" stroke-width="4"/>
  </g>
</svg>`;
saveAsset('background/bg_layer_midground', bgLayerMidgroundSVG, 1280);

const bgLayerForegroundSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720">
  <!-- Left & Right Framing Mangrove Roots & Tropical Leaves -->
  <path d="M0,0 L120,0 C70,160 85,360 40,560 L110,720 L0,720 Z" fill="#1F0E06" opacity="0.85"/>
  <path d="M1280,0 L1160,0 C1210,160 1195,360 1240,560 L1170,720 L1280,720 Z" fill="#1F0E06" opacity="0.85"/>
  <path d="M0,620 C80,580 140,630 170,720 L0,720 Z" fill="#18A558" stroke="#0A2910" stroke-width="5"/>
  <path d="M1280,620 C1200,580 1140,630 1110,720 L1280,720 Z" fill="#18A558" stroke="#0A2910" stroke-width="5"/>
</svg>`;
saveAsset('background/bg_layer_foreground', bgLayerForegroundSVG, 1280);

const waterOverlaySVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720">
  <g fill="none" stroke="#00F5D4" stroke-width="3" opacity="0.35">
    <ellipse cx="220" cy="600" rx="110" ry="22"/>
    <ellipse cx="640" cy="650" rx="180" ry="30"/>
    <ellipse cx="1060" cy="600" rx="110" ry="22"/>
    <path d="M120,520 Q320,505 520,520 T920,515 T1180,525"/>
  </g>
</svg>`;
saveAsset('background/water_overlay', waterOverlaySVG, 1280);

// ============================================================================
// 5. TOP UI JACKPOT PANELS (GRAND, MAJOR, MINOR, MINI) & BOTTOM HUD
// ============================================================================
const JACKPOTS = [
  { id: 'grand', label: 'GRAND', c1: '#FF2A6D', c2: '#7A0026', border: '#FFD100', val: '50,000' },
  { id: 'major', label: 'MAJOR', c1: '#B5179E', c2: '#480CA8', border: '#FFD100', val: '10,000' },
  { id: 'minor', label: 'MINOR', c1: '#0096FF', c2: '#03045E', border: '#72F6FF', val: '2,500' },
  { id: 'mini', label: 'MINI', c1: '#2EC4B6', c2: '#0B525B', border: '#80FF72', val: '500' },
];

for (const jp of JACKPOTS) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 84" width="240" height="84">
    <defs>
      <linearGradient id="jpGrad_${jp.id}" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="${jp.c1}"/>
        <stop offset="100%" stop-color="${jp.c2}"/>
      </linearGradient>
    </defs>
    <rect x="6" y="10" width="228" height="66" rx="22" fill="url(#jpGrad_${jp.id})" stroke="#1A0C05" stroke-width="6"/>
    <rect x="10" y="14" width="220" height="58" rx="18" fill="none" stroke="${jp.border}" stroke-width="3.5"/>
    <text x="120" y="34" font-family="DejaVu Sans, sans-serif" font-weight="900" font-size="17" text-anchor="middle" fill="#FFF3B0" stroke="#1A0C05" stroke-width="4" paint-order="stroke">${jp.label}</text>
    <text x="120" y="62" font-family="DejaVu Sans, sans-serif" font-weight="900" font-size="24" text-anchor="middle" fill="#FFFFFF" stroke="#1A0C05" stroke-width="5" paint-order="stroke">${jp.val}</text>
  </svg>`;
  saveAsset(`ui/jackpot_${jp.id}`, svg, 240);
}

// ============================================================================
// 6. SPIN BUTTON (IDLE, HOVER, PRESSED, SPINNING, WIN, DISABLED) & CONTROLS
// ============================================================================
const SPIN_STATES = [
  { id: 'idle', c1: '#38E54D', c2: '#0B7A20', ring: '#FFD100', glow: '#00F5D4' },
  { id: 'hover', c1: '#80FF72', c2: '#18A558', ring: '#FFF3B0', glow: '#80FF72' },
  { id: 'pressed', c1: '#18A558', c2: '#074F14', ring: '#FFB703', glow: '#00A8E8' },
  { id: 'spinning', c1: '#00F5D4', c2: '#0077B6', ring: '#FFD100', glow: '#00F5D4' },
  { id: 'win', c1: '#FFD100', c2: '#FF5400', ring: '#FFF3B0', glow: '#FFD100' },
  { id: 'disabled', c1: '#6C757D', c2: '#343A40', ring: '#ADB5BD', glow: '#495057' },
];

for (const st of SPIN_STATES) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" width="180" height="180">
    <defs>
      <radialGradient id="spinCrystal_${st.id}" cx="38%" cy="30%" r="70%">
        <stop offset="0%" stop-color="${st.c1}"/>
        <stop offset="100%" stop-color="${st.c2}"/>
      </radialGradient>
      <linearGradient id="spinGold_${st.id}" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#FFF8D6"/>
        <stop offset="50%" stop-color="${st.ring}"/>
        <stop offset="100%" stop-color="#9C4A00"/>
      </linearGradient>
    </defs>
    <!-- Outer Glow -->
    <circle cx="90" cy="90" r="84" fill="${st.glow}" opacity="0.28"/>
    <!-- Metallic / Fantasy Ring -->
    <circle cx="90" cy="90" r="76" fill="url(#spinGold_${st.id})" stroke="#1A0C05" stroke-width="7"/>
    <!-- Inner Crystal Orb -->
    <circle cx="90" cy="90" r="62" fill="url(#spinCrystal_${st.id})" stroke="#1A0C05" stroke-width="5"/>
    <!-- Top Glossy Highlight -->
    <ellipse cx="90" cy="56" rx="38" ry="18" fill="#FFFFFF" opacity="0.42"/>
    <!-- Circular Spin Arrows -->
    <path d="M54,78 A38,38 0 0,1 124,72" fill="none" stroke="#FFFFFF" stroke-width="9" stroke-linecap="round"/>
    <polygon points="132,82 114,76 128,60" fill="#FFFFFF"/>
    <path d="M126,102 A38,38 0 0,1 56,108" fill="none" stroke="#FFF3B0" stroke-width="9" stroke-linecap="round"/>
    <polygon points="48,98 66,104 52,120" fill="#FFF3B0"/>
    <!-- SPIN Label -->
    <text x="90" y="99" font-family="DejaVu Sans, sans-serif" font-weight="900" font-size="26" text-anchor="middle" fill="#FFFFFF" stroke="#1A0C05" stroke-width="6" paint-order="stroke">SPIN</text>
  </svg>`;
  saveAsset(`buttons/spin_button_${st.id}`, svg, 180);
}

// ============================================================================
// 7. PARTICLES & EFFECTS
// ============================================================================
const PARTICLES = [
  {
    id: 'sparkle_particle',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><polygon points="32,4 39,25 60,32 39,39 32,60 25,39 4,32 25,25" fill="#FFF3B0" stroke="#FFD100" stroke-width="2"/></svg>`,
  },
  {
    id: 'bubble_particle',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="24" fill="#72F6FF" fill-opacity="0.35" stroke="#00F5D4" stroke-width="3"/><circle cx="23" cy="22" r="6" fill="#FFFFFF" opacity="0.85"/></svg>`,
  },
  {
    id: 'leaf_particle',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M12,52 C12,20 40,10 54,12 C52,32 36,52 12,52 Z" fill="#38E54D" stroke="#0A2910" stroke-width="3"/><path d="M12,52 Q32,32 52,14" stroke="#80FF72" stroke-width="2.5" fill="none"/></svg>`,
  },
  {
    id: 'star_particle',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><polygon points="32,6 40,22 58,25 45,38 48,56 32,47 16,56 19,38 6,25 24,22" fill="#FFD100" stroke="#1A0C05" stroke-width="3"/></svg>`,
  },
  {
    id: 'water_droplet_particle',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M32,8 C46,28 50,38 50,45 A18,18 0 0,1 14,45 C14,38 18,28 32,8 Z" fill="#00B4D8" stroke="#062038" stroke-width="3"/><circle cx="26" cy="42" r="5" fill="#FFFFFF" opacity="0.8"/></svg>`,
  },
  {
    id: 'magical_dust_particle',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="18" fill="#00F5D4" opacity="0.5"/><circle cx="32" cy="32" r="8" fill="#FFFFFF"/></svg>`,
  },
  {
    id: 'virtual_coin_particle',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" fill="#FFD100" stroke="#1A0C05" stroke-width="4"/><circle cx="32" cy="32" r="19" fill="#FFB703" stroke="#FFF3B0" stroke-width="2"/><polygon points="32,17 36,27 47,27 38,34 41,45 32,38 23,45 26,34 17,27 28,27" fill="#FFF3B0"/></svg>`,
  },
  {
    id: 'glow_particle',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#FFF3B0"/><stop offset="50%" stop-color="#FFD100" stop-opacity="0.6"/><stop offset="100%" stop-color="#FFD100" stop-opacity="0"/></radialGradient><circle cx="32" cy="32" r="30" fill="url(#g)"/></svg>`,
  },
];

for (const p of PARTICLES) {
  saveAsset(`particles/${p.id}`, p.svg, 64);
}

// Win Rays Effect
const winRaysSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <radialGradient id="rayGrad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#FFF3B0" stop-opacity="0.9"/>
      <stop offset="50%" stop-color="#FFD100" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#FF5400" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="256" cy="256" r="240" fill="url(#rayGrad)"/>
</svg>`;
saveAsset('effects/win_rays_burst', winRaysSVG, 512);

// ============================================================================
// 8. LOGO VARIANTS (6 VARIANTS: FULL, HORIZONTAL, ICON, FAVICON, LIGHT, DARK)
// ============================================================================
function createLogoSVG(variant) {
  const isHorizontal = variant === 'horizontal';
  const isIcon = variant === 'icon' || variant === 'favicon';
  const isLight = variant === 'light';
  const isDark = variant === 'dark';

  if (isIcon) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
      <circle cx="64" cy="64" r="58" fill="#0B3B3C" stroke="#FFD100" stroke-width="6"/>
      <ellipse cx="64" cy="76" rx="40" ry="32" fill="#29D844" stroke="#0A2910" stroke-width="5"/>
      <circle cx="44" cy="46" r="16" fill="#FFFFFF" stroke="#0A2910" stroke-width="4.5"/>
      <circle cx="84" cy="46" r="16" fill="#FFFFFF" stroke="#0A2910" stroke-width="4.5"/>
      <circle cx="46" cy="46" r="8" fill="#090C10"/>
      <circle cx="82" cy="46" r="8" fill="#090C10"/>
      <circle cx="43" cy="42" r="3.5" fill="#FFFFFF"/>
      <circle cx="79" cy="42" r="3.5" fill="#FFFFFF"/>
      <path d="M44,76 Q64,92 84,76" fill="none" stroke="#0A2910" stroke-width="5" stroke-linecap="round"/>
      <polygon points="64,14 72,28 56,28" fill="#FFD100" stroke="#0A2910" stroke-width="3"/>
    </svg>`;
  }

  const textFillTop = isDark ? '#38E54D' : '#80FF72';
  const textFillBot = isLight ? '#FFFFFF' : '#FFD100';
  const strokeCol = isLight ? '#0B3B3C' : '#1A0C05';

  if (isHorizontal) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 120" width="560" height="120">
      <defs>
        <linearGradient id="logoWoodH" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="${isLight ? '#E0FBFc' : '#69381C'}"/>
          <stop offset="50%" stop-color="${isLight ? '#90E0EF' : '#3D1E0D'}"/>
          <stop offset="100%" stop-color="${isLight ? '#0077B6' : '#1F0D05'}"/>
        </linearGradient>
        <linearGradient id="logoGoldH" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#FFF8D6"/>
          <stop offset="50%" stop-color="#FFD100"/>
          <stop offset="100%" stop-color="#D97706"/>
        </linearGradient>
      </defs>
      <rect x="12" y="16" width="536" height="88" rx="30" fill="url(#logoWoodH)" stroke="url(#logoGoldH)" stroke-width="6"/>
      <path d="M18,36 C4,18 28,6 44,20 Z" fill="#38E54D" stroke="#1A0C05" stroke-width="3.5"/>
      <path d="M542,84 C556,102 532,114 516,100 Z" fill="#38E54D" stroke="#1A0C05" stroke-width="3.5"/>
      <!-- Cute Toad Emblem on Left -->
      <circle cx="68" cy="62" r="34" fill="#29D844" stroke="#1A0C05" stroke-width="4.5"/>
      <ellipse cx="68" cy="72" rx="20" ry="14" fill="#FFF9B0"/>
      <circle cx="54" cy="46" r="12" fill="#FFFFFF" stroke="#1A0C05" stroke-width="3.5"/>
      <circle cx="82" cy="46" r="12" fill="#FFFFFF" stroke="#1A0C05" stroke-width="3.5"/>
      <circle cx="55" cy="46" r="6" fill="#090C10"/>
      <circle cx="81" cy="46" r="6" fill="#090C10"/>
      <circle cx="53" cy="43" r="2.5" fill="#FFFFFF"/>
      <circle cx="79" cy="43" r="2.5" fill="#FFFFFF"/>
      <path d="M54,66 Q68,78 82,66" fill="none" stroke="#1A0C05" stroke-width="4" stroke-linecap="round"/>
      <text x="312" y="79" font-family="DejaVu Sans, sans-serif" font-weight="900" font-size="50" text-anchor="middle" fill="url(#logoGoldH)" stroke="${strokeCol}" stroke-width="11" paint-order="stroke">TINY TOADS</text>
    </svg>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 460 220" width="460" height="220">
    <defs>
      <linearGradient id="logoWoodF" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="${isLight ? '#72F6FF' : '#7A4424'}"/>
        <stop offset="50%" stop-color="${isLight ? '#00A8E8' : '#43220F'}"/>
        <stop offset="100%" stop-color="${isLight ? '#004E89' : '#210E05'}"/>
      </linearGradient>
      <linearGradient id="logoGoldF" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#FFF8D6"/>
        <stop offset="50%" stop-color="#FFD100"/>
        <stop offset="100%" stop-color="#D97706"/>
      </linearGradient>
      <linearGradient id="logoGreenF" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#B7FFBF"/>
        <stop offset="50%" stop-color="${textFillTop}"/>
        <stop offset="100%" stop-color="#0D7A22"/>
      </linearGradient>
    </defs>
    <!-- Lilypad Base & Lotus Petals -->
    <ellipse cx="230" cy="188" rx="196" ry="26" fill="#29D844" stroke="${strokeCol}" stroke-width="5.5"/>
    <path d="M52,182 C28,158 58,136 82,162 Z" fill="#FF4D6D" stroke="${strokeCol}" stroke-width="4"/>
    <path d="M408,182 C432,158 402,136 378,162 Z" fill="#FF4D6D" stroke="${strokeCol}" stroke-width="4"/>
    <!-- Carved Wooden Plaque -->
    <rect x="34" y="42" width="392" height="144" rx="38" fill="url(#logoWoodF)" stroke="url(#logoGoldF)" stroke-width="7"/>
    <rect x="44" y="52" width="372" height="124" rx="30" fill="none" stroke="#8C583A" stroke-width="2.5" opacity="0.6"/>
    <!-- Cute Frog Peeking Over Plaque with Crown & Hands -->
    <ellipse cx="230" cy="40" rx="44" ry="24" fill="#29D844" stroke="${strokeCol}" stroke-width="5"/>
    <polygon points="214,18 222,4 230,14 238,4 246,18" fill="#FFD100" stroke="${strokeCol}" stroke-width="3"/>
    <circle cx="206" cy="28" r="16" fill="#FFFFFF" stroke="${strokeCol}" stroke-width="4.5"/>
    <circle cx="254" cy="28" r="16" fill="#FFFFFF" stroke="${strokeCol}" stroke-width="4.5"/>
    <circle cx="207" cy="28" r="8" fill="#090C10"/>
    <circle cx="253" cy="28" r="8" fill="#090C10"/>
    <circle cx="204" cy="24" r="3.5" fill="#FFFFFF"/>
    <circle cx="250" cy="24" r="3.5" fill="#FFFFFF"/>
    <ellipse cx="176" cy="44" rx="14" ry="9" fill="#80FF72" stroke="${strokeCol}" stroke-width="4"/>
    <ellipse cx="284" cy="44" rx="14" ry="9" fill="#80FF72" stroke="${strokeCol}" stroke-width="4"/>
    <!-- TINY -->
    <text x="230" y="104" font-family="DejaVu Sans, sans-serif" font-weight="900" font-size="52" text-anchor="middle" fill="url(#logoGreenF)" stroke="${strokeCol}" stroke-width="12" paint-order="stroke" letter-spacing="2">TINY</text>
    <!-- TOADS -->
    <text x="230" y="164" font-family="DejaVu Sans, sans-serif" font-weight="900" font-size="68" text-anchor="middle" fill="url(#logoGoldF)" stroke="${strokeCol}" stroke-width="14" paint-order="stroke" letter-spacing="1">TOADS</text>
    <!-- Sparkles -->
    <polygon points="74,74 78,84 88,88 78,92 74,102 70,92 60,88 70,84" fill="#FFF3B0"/>
    <polygon points="386,74 390,84 400,88 390,92 386,102 382,92 372,88 382,84" fill="#00F5D4"/>
  </svg>`;
}

saveAsset('logo/tiny_toads_logo_full', createLogoSVG('full'), 460);
saveAsset('logo/tiny_toads_logo_horizontal', createLogoSVG('horizontal'), 560);
saveAsset('logo/tiny_toads_logo_icon', createLogoSVG('icon'), 128);
saveAsset('logo/favicon', createLogoSVG('favicon'), 64);
saveAsset('logo/tiny_toads_logo_light', createLogoSVG('light'), 460);
saveAsset('logo/tiny_toads_logo_dark', createLogoSVG('dark'), 460);

// ============================================================================
// 9. ICONS
// ============================================================================
const ICONS = [
  { id: 'icon_sound_on', label: '🔊' },
  { id: 'icon_sound_off', label: '🔇' },
  { id: 'icon_music_on', label: '🎵' },
  { id: 'icon_music_off', label: '✖' },
  { id: 'icon_info', label: 'i' },
  { id: 'icon_settings', label: '⚙' },
  { id: 'icon_coin_virtual', label: '★' },
];
for (const ic of ICONS) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
    <circle cx="32" cy="32" r="28" fill="#3D1E0D" stroke="#FFD100" stroke-width="4"/>
    <text x="32" y="42" font-family="DejaVu Sans, sans-serif" font-weight="900" font-size="28" text-anchor="middle" fill="#FFF3B0">${ic.label}</text>
  </svg>`;
  saveAsset(`icons/${ic.id}`, svg, 64);
}

// ============================================================================
// 10. ANIMATIONS MANIFEST
// ============================================================================
const animManifest = {
  game: 'TINY TOADS',
  baseResolution: { width: 1280, height: 720 },
  characters: TOADS.map((t) => ({
    id: t.id,
    name: t.name,
    states: TOAD_STATES,
    files: TOAD_STATES.reduce((acc, s) => {
      acc[s] = `assets/characters/tiny_toad_${t.id}_${s}.png`;
      return acc;
    }, {}),
  })),
  symbols: SYMBOLS.map((s) => ({
    id: s.id,
    type: s.type,
    states: SYMBOL_STATES,
    defaultFile: `assets/symbols/${s.id}.png`,
  })),
  reelPhysics: {
    columns: 5,
    rows: 3,
    accelerationMs: 160,
    steadySpinMs: 680,
    columnStaggerMs: 180,
    decelerationBounceMs: 260,
    bounceOvershootPx: 18,
  },
  winTiers: {
    SMALL_WIN: { minMultiplier: 1, maxMultiplier: 4, effects: ['glow', 'virtual_coins', 'sparkles'] },
    MEDIUM_WIN: { minMultiplier: 5, maxMultiplier: 14, effects: ['symbol_zoom', 'light_burst', 'bubbles_and_coins'] },
    BIG_WIN: { minMultiplier: 15, maxMultiplier: 39, effects: ['dim_background', 'camera_pulse', 'big_banner', 'gold_fountain'] },
    MEGA_WIN: { minMultiplier: 40, maxMultiplier: 999, effects: ['fullscreen_celebration', 'sunburst_rays', 'all_toads_jump', 'mega_fanfare'] },
  },
  visualSoundEvents: [
    'spin',
    'reel_stop',
    'symbol_land',
    'win',
    'big_win',
    'jackpot',
    'button_click',
  ],
};

fs.writeFileSync(
  path.join(ASSETS_DIR, 'animations', 'animations_manifest.json'),
  JSON.stringify(animManifest, null, 2),
  'utf8'
);

console.log('Successfully generated all TINY TOADS SVG + PNG assets!');
