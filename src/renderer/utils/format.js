/**
 * Formatting helpers. Every function is pure and locale-aware (Spanish).
 */

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(bytes, { decimals = null } = {}) {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = decimals ?? (value >= 100 ? 0 : value >= 10 ? 1 : 2);
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`;
}

export function formatDuration(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
  if (ms < 1000) return `${ms.toFixed(ms < 10 ? 2 : 1)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = ((ms % 60_000) / 1000).toFixed(1);
  return `${minutes} min ${seconds} s`;
}

export function formatUptime(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, '0')} min`;
  if (minutes > 0) return `${minutes} min ${String(seconds).padStart(2, '0')} s`;
  return `${seconds} s`;
}

export function formatNumber(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('es-ES').format(value);
}

export function formatTime(timestamp, { seconds = true } = {}) {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  const options = { hour: '2-digit', minute: '2-digit', hour12: false };
  if (seconds) options.second = '2-digit';
  return new Intl.DateTimeFormat('es-ES', options).format(date);
}

export function formatDateTime(timestamp) {
  if (!timestamp) return '—';
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}

export function formatRelative(timestamp, now = Date.now()) {
  if (!timestamp) return '—';
  const delta = now - timestamp;
  const absolute = Math.abs(delta);
  const future = delta < 0;
  const suffix = future ? 'dentro de' : 'hace';
  if (absolute < 5000) return 'ahora mismo';
  if (absolute < 60_000) {
    const seconds = Math.round(absolute / 1000);
    return `${suffix} ${seconds} s`;
  }
  if (absolute < 3_600_000) {
    const minutes = Math.round(absolute / 60_000);
    return `${suffix} ${minutes} min`;
  }
  if (absolute < 86_400_000) {
    const hours = Math.round(absolute / 3_600_000);
    return `${suffix} ${hours} h`;
  }
  const days = Math.round(absolute / 86_400_000);
  return `${suffix} ${days} d`;
}

export function formatPercent(value, decimals = 0) {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(decimals)} %`;
}

export function truncate(value, max = 60) {
  const string = String(value ?? '');
  return string.length <= max ? string : `${string.slice(0, Math.max(0, max - 1))}…`;
}

/** Escapes text for safe insertion into HTML when we build markup strings. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Renders a value (any type) as a compact, readable string for the console. */
export function describeValue(value, { depth = 0, maxDepth = 3 } = {}) {
  if (value === null || value === undefined) return 'nil';
  const type = typeof value;
  if (type === 'string') return value;
  if (type === 'number' || type === 'boolean' || type === 'bigint') return String(value);
  if (type === 'function') return `function ${value.name || 'anónima'}`;
  if (Array.isArray(value)) {
    if (depth >= maxDepth) return '{ … }';
    return `{ ${value.map((item) => describeValue(item, { depth: depth + 1, maxDepth })).join(', ')} }`;
  }
  if (type === 'object') {
    if (depth >= maxDepth) return '{ … }';
    const entries = Object.entries(value).slice(0, 20);
    const body = entries.map(([key, item]) => `${key} = ${describeValue(item, { depth: depth + 1, maxDepth })}`);
    if (Object.keys(value).length > entries.length) body.push('…');
    return `{ ${body.join(', ')} }`;
  }
  return String(value);
}

export function pluralize(count, singular, plural = null) {
  const word = count === 1 ? singular : plural ?? `${singular}s`;
  return `${formatNumber(count)} ${word}`;
}

export function slugify(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
