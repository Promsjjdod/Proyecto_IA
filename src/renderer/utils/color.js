/**
 * Colour maths used by the theme system (accent derivation and contrast checks).
 * Pure functions, no DOM access, fully unit-testable.
 */

/** Parses `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()` and `hsl()` into `{ r, g, b, a }`. */
export function parseColor(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();
  const hexMatch = /^#([0-9a-f]{3,8})$/.exec(value);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) hex = hex.split('').map((char) => char + char).join('');
    if (hex.length === 4) hex = hex.split('').map((char) => char + char).join('');
    if (hex.length !== 6 && hex.length !== 8) return null;
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
    };
  }
  const rgbMatch = /^rgba?\(([^)]+)\)$/.exec(value);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(/[,/\s]+/).filter(Boolean).map((part) => part.trim());
    if (parts.length < 3) return null;
    const [r, g, b, a] = parts.map((part) => (part.endsWith('%') ? Number.parseFloat(part) * 2.55 : Number.parseFloat(part)));
    if ([r, g, b].some((channel) => !Number.isFinite(channel))) return null;
    return {
      r: clamp(Math.round(r), 0, 255),
      g: clamp(Math.round(g), 0, 255),
      b: clamp(Math.round(b), 0, 255),
      a: Number.isFinite(a) ? clamp(a, 0, 1) : 1,
    };
  }
  const hslMatch = /^hsla?\(([^)]+)\)$/.exec(value);
  if (hslMatch) {
    const parts = hslMatch[1].split(/[,/\s]+/).filter(Boolean).map((part) => Number.parseFloat(part.replace('%', '')));
    if (parts.length < 3) return null;
    const [h, s, l, a] = parts;
    const rgb = hslToRgb(h, s / 100, l / 100);
    return { ...rgb, a: Number.isFinite(a) ? clamp(a, 0, 1) : 1 };
  }
  return null;
}

export function toHex({ r, g, b, a = 1 }, { withAlpha = false } = {}) {
  const hex = [r, g, b].map((channel) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0')).join('');
  if (!withAlpha || a >= 1) return `#${hex}`;
  return `#${hex}${clamp(Math.round(a * 255), 0, 255).toString(16).padStart(2, '0')}`;
}

export function toRgba({ r, g, b, a = 1 }) {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${round(a, 3)})`;
}

export function toHslString({ r, g, b, a = 1 }) {
  const { h, s, l } = rgbToHsl(r, g, b);
  return a >= 1 ? `hsl(${h} ${s}% ${l}%)` : `hsl(${h} ${s}% ${l}% / ${round(a, 3)})`;
}

export function rgbToHsl(r, g, b) {
  const nr = r / 255;
  const ng = g / 255;
  const nb = b / 255;
  const max = Math.max(nr, ng, nb);
  const min = Math.min(nr, ng, nb);
  const lightness = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(lightness * 100) };
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue;
  switch (max) {
    case nr:
      hue = ((ng - nb) / delta + (ng < nb ? 6 : 0)) * 60;
      break;
    case ng:
      hue = ((nb - nr) / delta + 2) * 60;
      break;
    default:
      hue = ((nr - ng) / delta + 4) * 60;
  }
  return { h: Math.round(hue), s: Math.round(saturation * 100), l: Math.round(lightness * 100) };
}

export function hslToRgb(h, s, l) {
  const hue = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const value = Math.round(l * 255);
    return { r: value, g: value, b: value };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hueToRgb(p, q, hue + 1 / 3) * 255),
    g: Math.round(hueToRgb(p, q, hue) * 255),
    b: Math.round(hueToRgb(p, q, hue - 1 / 3) * 255),
  };
}

function hueToRgb(p, q, t) {
  let value = t;
  if (value < 0) value += 1;
  if (value > 1) value -= 1;
  if (value < 1 / 6) return p + (q - p) * 6 * value;
  if (value < 1 / 2) return q;
  if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
  return p;
}

/** Lightens (amount > 0) or darkens (amount < 0) a colour in HSL space. */
export function shade(input, amount) {
  const color = typeof input === 'string' ? parseColor(input) : input;
  if (!color) return null;
  const { h, s, l } = rgbToHsl(color.r, color.g, color.b);
  const lightness = clamp(l + amount * 100, 0, 100);
  const rgb = hslToRgb(h, s / 100, lightness / 100);
  return { ...rgb, a: color.a };
}

export function withAlpha(input, alpha) {
  const color = typeof input === 'string' ? parseColor(input) : input;
  if (!color) return null;
  return toRgba({ ...color, a: clamp(alpha, 0, 1) });
}

/** Relative luminance (WCAG 2.1). */
export function luminance(input) {
  const color = typeof input === 'string' ? parseColor(input) : input;
  if (!color) return 0;
  const channels = [color.r, color.g, color.b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** WCAG contrast ratio between two colours (1 … 21). */
export function contrastRatio(a, b) {
  const first = luminance(a);
  const second = luminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Picks black or white text for a background, based on measured contrast. */
export function readableTextColor(background, { light = '#ffffff', dark = '#0b0f16' } = {}) {
  const lightContrast = contrastRatio(background, light);
  const darkContrast = contrastRatio(background, dark);
  return lightContrast >= darkContrast ? light : dark;
}

/** Minimal contrast ratio for accessible text (WCAG AA for large text). */
export function meetsContrast(foreground, background, { min = 4.5 } = {}) {
  return contrastRatio(foreground, background) >= min;
}

/** Derives every accent-dependent token from the user's accent colour. */
export function deriveAccentTokens(accent, { themeType = 'dark' } = {}) {
  const color = parseColor(accent);
  if (!color) return null;
  const isDark = themeType === 'dark';
  return {
    accent: toHex(color),
    'accent-hover': toHex(shade(color, isDark ? 0.08 : 0.06)),
    'accent-active': toHex(shade(color, isDark ? -0.08 : -0.07)),
    'accent-subtle': toRgba({ ...color, a: isDark ? 0.16 : 0.13 }),
    'accent-contrast': readableTextColor(color),
    'accent-ring': toRgba({ ...color, a: 0.4 }),
    'border-focus': toHex(color),
    'selected-bg': toRgba({ ...color, a: isDark ? 0.18 : 0.13 }),
    'editor-selection': toRgba({ ...color, a: isDark ? 0.26 : 0.2 }),
    'editor-bracket-match': toRgba({ ...color, a: 0.3 }),
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Palette offered in Settings → Apariencia. */
export const ACCENT_PRESETS = Object.freeze([
  { name: 'Azul', value: '#5b8dff' },
  { name: 'Índigo', value: '#4f46e5' },
  { name: 'Cian', value: '#22d3ee' },
  { name: 'Verde', value: '#2ea043' },
  { name: 'Ámbar', value: '#e0a83a' },
  { name: 'Naranja', value: '#f97316' },
  { name: 'Rosa', value: '#ec4899' },
  { name: 'Violeta', value: '#a855f7' },
  { name: 'Rojo', value: '#ef4444' },
  { name: 'Grafito', value: '#8b949e' },
]);
