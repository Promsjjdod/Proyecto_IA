/**
 * Theme system — a single source of truth for every colour in the application.
 *
 * A theme is a flat map of design tokens. No component ever hardcodes a colour: the UI reads
 * CSS custom properties (`--lumen-<token>`) written on `:root` by the ThemeManager, and the
 * editor maps the syntax tokens to CodeMirror's highlight tags. Themes are validated before
 * being applied or saved, so a hand-edited JSON file can never break the interface: missing
 * tokens fall back to the base dark theme and the problem is reported instead of hidden.
 */

/** Token catalogue grouped for the theme editor. Every token here must exist in every theme. */
export const THEME_TOKEN_GROUPS = Object.freeze([
  {
    id: 'surfaces',
    label: 'Superficies',
    tokens: [
      { key: 'bg-app', label: 'Fondo de la aplicación' },
      { key: 'bg-panel', label: 'Fondo de paneles' },
      { key: 'bg-elevated', label: 'Fondo elevado (tarjetas, menús)' },
      { key: 'bg-input', label: 'Fondo de campos' },
      { key: 'bg-hover', label: 'Fondo al pasar el cursor' },
      { key: 'bg-active', label: 'Fondo activo / pulsado' },
      { key: 'bg-selected', label: 'Fondo seleccionado' },
      { key: 'bg-overlay', label: 'Velo de superposición' },
      { key: 'bg-code', label: 'Fondo de bloques de código' },
    ],
  },
  {
    id: 'borders',
    label: 'Bordes',
    tokens: [
      { key: 'border-subtle', label: 'Borde sutil' },
      { key: 'border-default', label: 'Borde normal' },
      { key: 'border-strong', label: 'Borde marcado' },
      { key: 'border-focus', label: 'Borde de foco' },
    ],
  },
  {
    id: 'text',
    label: 'Texto',
    tokens: [
      { key: 'text-primary', label: 'Texto principal' },
      { key: 'text-secondary', label: 'Texto secundario' },
      { key: 'text-muted', label: 'Texto atenuado' },
      { key: 'text-disabled', label: 'Texto deshabilitado' },
      { key: 'text-inverse', label: 'Texto sobre acento' },
      { key: 'text-link', label: 'Enlaces' },
    ],
  },
  {
    id: 'accent',
    label: 'Acento',
    tokens: [
      { key: 'accent', label: 'Color de acento' },
      { key: 'accent-hover', label: 'Acento (cursor)' },
      { key: 'accent-active', label: 'Acento (activo)' },
      { key: 'accent-subtle', label: 'Acento atenuado' },
      { key: 'accent-contrast', label: 'Contraste sobre acento' },
    ],
  },
  {
    id: 'status',
    label: 'Estados',
    tokens: [
      { key: 'success', label: 'Éxito' },
      { key: 'success-bg', label: 'Fondo de éxito' },
      { key: 'warning', label: 'Aviso' },
      { key: 'warning-bg', label: 'Fondo de aviso' },
      { key: 'error', label: 'Error' },
      { key: 'error-bg', label: 'Fondo de error' },
      { key: 'info', label: 'Información' },
      { key: 'info-bg', label: 'Fondo de información' },
    ],
  },
  {
    id: 'syntax',
    label: 'Resaltado de sintaxis',
    tokens: [
      { key: 'syn-keyword', label: 'Palabras clave' },
      { key: 'syn-string', label: 'Cadenas' },
      { key: 'syn-number', label: 'Números' },
      { key: 'syn-comment', label: 'Comentarios' },
      { key: 'syn-function', label: 'Funciones' },
      { key: 'syn-variable', label: 'Variables' },
      { key: 'syn-constant', label: 'Constantes' },
      { key: 'syn-type', label: 'Tipos' },
      { key: 'syn-property', label: 'Propiedades y campos' },
      { key: 'syn-operator', label: 'Operadores' },
      { key: 'syn-punctuation', label: 'Puntuación' },
      { key: 'syn-global', label: 'Globales de la librería estándar' },
      { key: 'syn-invalid', label: 'Tokens inválidos' },
    ],
  },
  {
    id: 'editor',
    label: 'Editor',
    tokens: [
      { key: 'editor-bg', label: 'Fondo del editor' },
      { key: 'editor-gutter-bg', label: 'Fondo del margen' },
      { key: 'editor-gutter-text', label: 'Números de línea' },
      { key: 'editor-active-line', label: 'Línea activa' },
      { key: 'editor-selection', label: 'Selección' },
      { key: 'editor-cursor', label: 'Cursor' },
      { key: 'editor-bracket-match', label: 'Par de paréntesis' },
      { key: 'editor-search-match', label: 'Coincidencia de búsqueda' },
      { key: 'editor-search-active', label: 'Coincidencia activa' },
      { key: 'editor-indent-guide', label: 'Guías de indentación' },
      { key: 'editor-error-line', label: 'Línea con error' },
      { key: 'editor-warning-line', label: 'Línea con aviso' },
    ],
  },
  {
    id: 'effects',
    label: 'Efectos',
    tokens: [
      { key: 'shadow-1', label: 'Sombra nivel 1' },
      { key: 'shadow-2', label: 'Sombra nivel 2' },
      { key: 'shadow-3', label: 'Sombra nivel 3' },
      { key: 'scrollbar-thumb', label: 'Barra de desplazamiento' },
      { key: 'scrollbar-thumb-hover', label: 'Barra de desplazamiento (cursor)' },
      { key: 'focus-ring', label: 'Anillo de foco' },
    ],
  },
]);

/** Flat list of every token key (order preserved, used by the validators and the editor). */
export const THEME_TOKENS = Object.freeze(THEME_TOKEN_GROUPS.flatMap((group) => group.tokens.map((token) => token.key)));

/** Human label for a token key (falls back to the key itself). */
export const THEME_TOKEN_LABELS = Object.freeze(Object.fromEntries(
  THEME_TOKEN_GROUPS.flatMap((group) => group.tokens.map((token) => [token.key, token.label])),
));

export const THEME_TOKEN_GROUP_OF = Object.freeze(Object.fromEntries(
  THEME_TOKEN_GROUPS.flatMap((group) => group.tokens.map((token) => [token.key, group.id])),
));

const dark = {
  'bg-app': '#0e1116',
  'bg-panel': '#151a21',
  'bg-elevated': '#1b222b',
  'bg-input': '#11161d',
  'bg-hover': '#1f2732',
  'bg-active': '#26303d',
  'bg-selected': '#1d2b3a',
  'bg-overlay': 'rgba(6, 9, 13, 0.66)',
  'bg-code': '#0b0f14',
  'border-subtle': '#1e2836',
  'border-default': '#2a3644',
  'border-strong': '#3b4a5c',
  'border-focus': '#3d7dd8',
  'text-primary': '#e6edf3',
  'text-secondary': '#b3c0cd',
  'text-muted': '#7c8896',
  'text-disabled': '#556070',
  'text-inverse': '#0b0f14',
  'text-link': '#6cb2ff',
  accent: '#3d7dd8',
  'accent-hover': '#4d8de8',
  'accent-active': '#2f6ec4',
  'accent-subtle': 'rgba(61, 125, 216, 0.16)',
  'accent-contrast': '#ffffff',
  success: '#3fb950',
  'success-bg': 'rgba(63, 185, 80, 0.14)',
  warning: '#d29922',
  'warning-bg': 'rgba(210, 153, 34, 0.15)',
  error: '#f0554a',
  'error-bg': 'rgba(240, 85, 74, 0.15)',
  info: '#58a6ff',
  'info-bg': 'rgba(88, 166, 255, 0.14)',
  'syn-keyword': '#ff7b72',
  'syn-string': '#a5d6ff',
  'syn-number': '#f2cc60',
  'syn-comment': '#7d8794',
  'syn-function': '#d2a8ff',
  'syn-variable': '#e6edf3',
  'syn-constant': '#79c0ff',
  'syn-type': '#7ee787',
  'syn-property': '#ffa657',
  'syn-operator': '#ff7b72',
  'syn-punctuation': '#9aa7b4',
  'syn-global': '#79c0ff',
  'syn-invalid': '#ff5c5c',
  'editor-bg': '#0e1116',
  'editor-gutter-bg': '#0e1116',
  'editor-gutter-text': '#4d5866',
  'editor-active-line': 'rgba(61, 125, 216, 0.09)',
  'editor-selection': 'rgba(61, 125, 216, 0.28)',
  'editor-cursor': '#6cb2ff',
  'editor-bracket-match': 'rgba(110, 168, 254, 0.28)',
  'editor-search-match': 'rgba(210, 153, 34, 0.28)',
  'editor-search-active': 'rgba(210, 153, 34, 0.55)',
  'editor-indent-guide': 'rgba(124, 136, 150, 0.22)',
  'editor-error-line': 'rgba(240, 85, 74, 0.14)',
  'editor-warning-line': 'rgba(210, 153, 34, 0.14)',
  'shadow-1': '0 1px 2px rgba(0, 0, 0, 0.35)',
  'shadow-2': '0 6px 16px rgba(0, 0, 0, 0.42)',
  'shadow-3': '0 16px 40px rgba(0, 0, 0, 0.5)',
  'scrollbar-thumb': 'rgba(124, 136, 150, 0.34)',
  'scrollbar-thumb-hover': 'rgba(124, 136, 150, 0.55)',
  'focus-ring': 'rgba(61, 125, 216, 0.55)',
};

const light = {
  'bg-app': '#f4f6f9',
  'bg-panel': '#ffffff',
  'bg-elevated': '#ffffff',
  'bg-input': '#ffffff',
  'bg-hover': '#eef1f6',
  'bg-active': '#e3e8ef',
  'bg-selected': '#dceafc',
  'bg-overlay': 'rgba(23, 32, 45, 0.35)',
  'bg-code': '#f6f8fa',
  'border-subtle': '#e4e8ee',
  'border-default': '#d0d7e2',
  'border-strong': '#a9b4c2',
  'border-focus': '#1f6feb',
  'text-primary': '#1b2532',
  'text-secondary': '#485466',
  'text-muted': '#6b7787',
  'text-disabled': '#9aa5b1',
  'text-inverse': '#ffffff',
  'text-link': '#1f6feb',
  accent: '#1f6feb',
  'accent-hover': '#2f7ef5',
  'accent-active': '#175bc0',
  'accent-subtle': 'rgba(31, 111, 235, 0.12)',
  'accent-contrast': '#ffffff',
  success: '#1a7f37',
  'success-bg': 'rgba(26, 127, 55, 0.12)',
  warning: '#9a6700',
  'warning-bg': 'rgba(154, 103, 0, 0.12)',
  error: '#cf222e',
  'error-bg': 'rgba(207, 34, 46, 0.12)',
  info: '#0969da',
  'info-bg': 'rgba(9, 105, 218, 0.12)',
  'syn-keyword': '#cf222e',
  'syn-string': '#0a3069',
  'syn-number': '#953800',
  'syn-comment': '#6e7781',
  'syn-function': '#8250df',
  'syn-variable': '#1b2532',
  'syn-constant': '#0550ae',
  'syn-type': '#116329',
  'syn-property': '#953800',
  'syn-operator': '#cf222e',
  'syn-punctuation': '#57606a',
  'syn-global': '#0550ae',
  'syn-invalid': '#cf222e',
  'editor-bg': '#ffffff',
  'editor-gutter-bg': '#ffffff',
  'editor-gutter-text': '#8c96a3',
  'editor-active-line': 'rgba(31, 111, 235, 0.06)',
  'editor-selection': 'rgba(31, 111, 235, 0.18)',
  'editor-cursor': '#1f6feb',
  'editor-bracket-match': 'rgba(31, 111, 235, 0.18)',
  'editor-search-match': 'rgba(154, 103, 0, 0.2)',
  'editor-search-active': 'rgba(154, 103, 0, 0.4)',
  'editor-indent-guide': 'rgba(107, 119, 135, 0.25)',
  'editor-error-line': 'rgba(207, 34, 46, 0.1)',
  'editor-warning-line': 'rgba(154, 103, 0, 0.1)',
  'shadow-1': '0 1px 2px rgba(27, 37, 50, 0.08)',
  'shadow-2': '0 6px 16px rgba(27, 37, 50, 0.12)',
  'shadow-3': '0 16px 40px rgba(27, 37, 50, 0.16)',
  'scrollbar-thumb': 'rgba(107, 119, 135, 0.32)',
  'scrollbar-thumb-hover': 'rgba(107, 119, 135, 0.5)',
  'focus-ring': 'rgba(31, 111, 235, 0.45)',
};

const contrast = {
  ...dark,
  'bg-app': '#000000',
  'bg-panel': '#0a0c10',
  'bg-elevated': '#12161c',
  'bg-input': '#080a0e',
  'bg-hover': '#1c222b',
  'bg-active': '#262e39',
  'bg-selected': '#0f2d4d',
  'border-subtle': '#2a323d',
  'border-default': '#3d4854',
  'border-strong': '#5b6a7a',
  'text-primary': '#ffffff',
  'text-secondary': '#dbe3ec',
  'text-muted': '#a3aebc',
  'text-disabled': '#6b7684',
  accent: '#58a6ff',
  'accent-hover': '#79b8ff',
  'accent-active': '#388bfd',
  'accent-subtle': 'rgba(88, 166, 255, 0.22)',
  'syn-keyword': '#ff9492',
  'syn-string': '#a5d6ff',
  'syn-comment': '#a8b3c1',
  'syn-number': '#ffd66b',
  success: '#56d364',
  warning: '#e3b341',
  error: '#ff7b72',
  info: '#79c0ff',
  'editor-active-line': 'rgba(88, 166, 255, 0.14)',
  'editor-selection': 'rgba(88, 166, 255, 0.4)',
};

const ocean = {
  ...dark,
  'bg-app': '#071a24',
  'bg-panel': '#0b2431',
  'bg-elevated': '#0f2c3b',
  'bg-input': '#0a2130',
  'bg-hover': '#123544',
  'bg-active': '#164054',
  'bg-selected': '#123f57',
  'border-subtle': '#12303f',
  'border-default': '#1b4152',
  'border-strong': '#2b5b70',
  'border-focus': '#38bdf8',
  'text-primary': '#e2f2fa',
  'text-secondary': '#a8cbd9',
  'text-muted': '#6f97a8',
  'text-disabled': '#4d7284',
  'text-link': '#67e8f9',
  accent: '#0ea5e9',
  'accent-hover': '#38bdf8',
  'accent-active': '#0284c7',
  'accent-subtle': 'rgba(14, 165, 233, 0.18)',
  'accent-contrast': '#04202c',
  success: '#34d399',
  'success-bg': 'rgba(52, 211, 153, 0.15)',
  warning: '#fbbf24',
  'warning-bg': 'rgba(251, 191, 36, 0.15)',
  error: '#fb7185',
  'error-bg': 'rgba(251, 113, 133, 0.16)',
  info: '#60a5fa',
  'info-bg': 'rgba(96, 165, 250, 0.15)',
  'syn-keyword': '#f97583',
  'syn-string': '#7dd3fc',
  'syn-number': '#fcd34d',
  'syn-comment': '#5f8496',
  'syn-function': '#c4b5fd',
  'syn-constant': '#67e8f9',
  'syn-type': '#6ee7b7',
  'syn-property': '#fdba74',
  'syn-global': '#7dd3fc',
  'editor-bg': '#071a24',
  'editor-gutter-bg': '#071a24',
  'editor-gutter-text': '#4d7284',
  'editor-active-line': 'rgba(14, 165, 233, 0.1)',
  'editor-selection': 'rgba(14, 165, 233, 0.3)',
  'editor-cursor': '#67e8f9',
  'editor-bracket-match': 'rgba(14, 165, 233, 0.28)',
};

/** Every built-in theme, complete (no token is left undefined). */
export const BUILTIN_THEMES = Object.freeze([
  {
    id: 'lumen-dark',
    name: 'Lumen Oscuro',
    type: 'dark',
    author: 'Lumen Studio',
    description: 'Tema oscuro por defecto, con contraste equilibrado para sesiones largas.',
    builtin: true,
    tokens: Object.freeze({ ...dark }),
  },
  {
    id: 'lumen-light',
    name: 'Lumen Claro',
    type: 'light',
    author: 'Lumen Studio',
    description: 'Tema claro de alto contraste para entornos luminosos.',
    builtin: true,
    tokens: Object.freeze({ ...light }),
  },
  {
    id: 'obsidian-contrast',
    name: 'Obsidiana (contraste alto)',
    type: 'dark',
    author: 'Lumen Studio',
    description: 'Fondos negros y texto puro para máxima legibilidad.',
    builtin: true,
    tokens: Object.freeze({ ...contrast }),
  },
  {
    id: 'ocean-dusk',
    name: 'Océano Nocturno',
    type: 'dark',
    author: 'Lumen Studio',
    description: 'Paleta azul profunda con acentos cian.',
    builtin: true,
    tokens: Object.freeze({ ...ocean }),
  },
]);

export const DEFAULT_THEME_ID = 'lumen-dark';

/** The base theme used to fill gaps (and the colours the boot screen uses). */
export const FALLBACK_THEME = BUILTIN_THEMES[0];

/** Tokens derived automatically from `accent` when the user picks a custom accent colour. */
export const ACCENT_DERIVED_TOKENS = Object.freeze({
  'border-focus': 'accent',
  'editor-cursor': 'accent',
  'editor-selection': 'accent@28',
  'editor-bracket-match': 'accent@30',
  'focus-ring': 'accent@55',
  'accent-subtle': 'accent@18',
  'text-link': 'accent@110',
});

export function getBuiltinTheme(id) {
  return BUILTIN_THEMES.find((theme) => theme.id === id) ?? null;
}

/** True when the value looks like a CSS colour we are willing to write into the document. */
export function isColorValue(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed === '') return false;
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return true;
  if (/^(rgb|rgba|hsl|hsla)\([0-9.,%\s/+-]*\)$/.test(trimmed)) return true;
  if (/^[a-zA-Z]+$/.test(trimmed)) return true;
  return false;
}

/**
 * Validates a theme definition.
 * Missing tokens are filled from the fallback theme and reported; unknown tokens are dropped
 * and reported. The returned theme is always safe to apply.
 */
export function validateTheme(candidate, { base = FALLBACK_THEME } = {}) {
  const problems = [];
  const missing = [];
  const unknown = [];
  const tokens = {};

  if (!candidate || typeof candidate !== 'object') {
    return {
      ok: false,
      theme: cloneTheme(base),
      problems: ['La definición del tema no es un objeto'],
      missing: [...THEME_TOKENS],
      unknown: [],
    };
  }

  const source = candidate.tokens && typeof candidate.tokens === 'object' ? candidate.tokens : candidate;
  for (const key of THEME_TOKENS) {
    const value = source[key];
    if (typeof value === 'string' && isColorValue(value)) tokens[key] = value.trim();
    else {
      tokens[key] = base.tokens[key];
      missing.push(key);
      if (value !== undefined) problems.push(`El token «${key}» no es un color válido: ${JSON.stringify(value)}`);
    }
  }
  for (const key of Object.keys(source)) {
    if (!THEME_TOKENS.includes(key)) {
      unknown.push(key);
      problems.push(`Token desconocido «${key}» (se ignora)`);
    }
  }

  const id = typeof candidate.id === 'string' && /^[a-z0-9][a-z0-9._-]{1,63}$/i.test(candidate.id) ? candidate.id : null;
  if (!id) problems.push('El tema necesita un id válido (letras, números, punto, guion)');
  if (missing.length > 0 && candidate.tokens) {
    problems.push(`${missing.length} token(s) ausentes se completaron desde «${base.name}»: ${missing.join(', ')}`);
  }

  const type = candidate.type === 'light' ? 'light' : 'dark';
  return {
    ok: problems.length === 0,
    theme: {
      id: id ?? `tema-${Date.now().toString(36)}`,
      name: typeof candidate.name === 'string' && candidate.name.trim() !== '' ? candidate.name.trim().slice(0, 60) : (id ?? 'Tema personalizado'),
      type,
      author: typeof candidate.author === 'string' && candidate.author.trim() !== '' ? candidate.author.trim().slice(0, 60) : 'Personalizado',
      description: typeof candidate.description === 'string' ? candidate.description.slice(0, 240) : '',
      builtin: false,
      updatedAt: Number.isFinite(candidate.updatedAt) ? candidate.updatedAt : Date.now(),
      tokens,
    },
    problems: [...new Set(problems)],
    missing,
    unknown,
  };
}

/** A theme definition with every token present (used by the editor preview). */
export function cloneTheme(theme) {
  return {
    id: theme.id,
    name: theme.name,
    type: theme.type,
    author: theme.author,
    description: theme.description,
    builtin: theme.builtin === true,
    updatedAt: theme.updatedAt ?? null,
    tokens: { ...theme.tokens },
  };
}

/** `--lumen-<token>` custom property name for a token key. */
export function cssVarName(token) {
  return `--lumen-${token}`;
}

/** All custom properties of a theme, ready to be written on `:root`. */
export function themeToCssVariables(theme) {
  const variables = {};
  for (const token of THEME_TOKENS) variables[cssVarName(token)] = theme.tokens[token];
  return variables;
}

export function themeToCssText(theme, selector = ':root') {
  const body = THEME_TOKENS.map((token) => `  ${cssVarName(token)}: ${theme.tokens[token]};`).join('\n');
  return `${selector} {\n${body}\n}`;
}
