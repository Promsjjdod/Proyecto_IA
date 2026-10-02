/**
 * Icon set — a single, consistent outline family (24×24 grid, 1.7 stroke, `currentColor`).
 *
 * Icons are plain SVG markup kept in one place so every surface uses the same symbol for the
 * same concept. `icon()` builds an element; `installIconHydration()` fills any
 * `<span class="icon" data-icon="name">` that a renderer produced (used by toasts, menus and
 * list rows) and keeps working for nodes added later through a MutationObserver.
 */

import { el } from '../renderer/utils/dom.js';
import { createScheduler } from '../renderer/utils/async.js';

export const ICONS = Object.freeze({
  // Sections
  dashboard: '<path d="M4 4h7v7H4z"/><path d="M13 4h7v4h-7z"/><path d="M13 10h7v10h-7z"/><path d="M4 13h7v7H4z"/>',
  editor: '<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 9l-2 3 2 3"/><path d="M14 9l2 3-2 3"/>',
  scripts: '<path d="M4 5a2 2 0 0 1 2-2h6l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M12 3v5h5"/>',
  console: '<path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M7 9l3 3-3 3"/><path d="M13 15h4"/>',
  plugins: '<path d="M10 3h4v4a2 2 0 1 0 4 0V3h3v7h-4a2 2 0 1 0 0 4h4v7h-7v-4a2 2 0 1 0-4 0v4H3v-7h4a2 2 0 1 0 0-4H3V3h7z"/>',
  settings: '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M4 12H2m20 0h-2M12 4V2m0 20v-2M6.3 6.3 4.9 4.9m14.2 14.2-1.4-1.4M17.7 6.3l1.4-1.4M4.9 19.1l1.4-1.4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',

  // Actions
  play: '<path d="M7 4.8v14.4L19 12z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  save: '<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M8 3v6h7V3"/><path d="M8 21v-7h8v7"/>',
  'save-as': '<path d="M5 3h9l4 4v5"/><path d="M3 5v14a2 2 0 0 0 2 2h7"/><path d="M19 14l2 2-5 5h-2v-2z"/>',
  open: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  'file-plus': '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M12 12v6M9 15h6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M4.5 12.5 9 17 19.5 6.5"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="M8 12.5 11 15.5 16.5 9.5"/>',
  'x-circle': '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4 7h16"/><path d="M10 4h4"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M10 11v7M14 11v7"/>',
  edit: '<path d="M4 20h4l10-10-4-4L4 16z"/><path d="M14 6l4 4"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  cut: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 8l12 10M8 16 20 6"/>',
  paste: '<path d="M9 4h6v3H9z"/><path d="M7 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>',
  undo: '<path d="M9 7H5v4"/><path d="M5 11a7 7 0 1 1 7 7H8"/>',
  redo: '<path d="M15 7h4v4"/><path d="M19 11a7 7 0 1 0-7 7h4"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M15.5 15.5 20 20"/>',
  replace: '<path d="M4 7h10a4 4 0 0 1 4 4v1"/><path d="M4 7l3-3M4 7l3 3"/><path d="M20 17H10a4 4 0 0 1-4-4v-1"/><path d="M20 17l-3 3M20 17l-3-3"/>',
  format: '<path d="M4 6h16M4 11h11M4 16h16M4 21h7"/>',
  download: '<path d="M12 4v11"/><path d="M7.5 11 12 15.5 16.5 11"/><path d="M5 19h14"/>',
  upload: '<path d="M12 20V9"/><path d="M7.5 13 12 8.5 16.5 13"/><path d="M5 5h14"/>',
  export: '<path d="M14 4h5a1 1 0 0 1 1 1v5"/><path d="M20 4l-9 9"/><path d="M9 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"/>',
  import: '<path d="M10 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4"/><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M12 8v8"/><path d="M9 12l3 4 3-4"/>',
  'more-vertical': '<circle cx="12" cy="5.5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="18.5" r="1.4"/>',
  'more-horizontal': '<circle cx="5.5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.5" cy="12" r="1.4"/>',
  star: '<path d="M12 4.5l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4L4.2 10.2l5.4-.8z"/>',
  tag: '<path d="M20 12.5 12.5 20a2 2 0 0 1-2.8 0L4 14.3V5a1 1 0 0 1 1-1h9.3l5.7 5.7a2 2 0 0 1 0 2.8z"/><path d="M8.5 8.5h.01"/>',
  filter: '<path d="M4 6h16l-6 7v6l-4-2v-4z"/>',
  sort: '<path d="M7 5v14"/><path d="M4 8l3-3 3 3"/><path d="M17 19V5"/><path d="M14 16l3 3 3-3"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 5v4h4"/><path d="M12 8v4.5l3 1.8"/>',
  activity: '<path d="M3 12h4l2.5-6 4 12 2.5-6h5"/>',
  bug: '<circle cx="12" cy="13" r="5"/><path d="M12 6v2"/><path d="M6 10l2 1.5M18 10l-2 1.5M6 17l2-1.5M18 17l-2-1.5"/><path d="M8 5.5 12 8l4-2.5"/>',
  'alert-triangle': '<path d="M10.3 4.3 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/><path d="M12 9v4.5"/><path d="M12 17h.01"/>',
  'alert-octagon': '<path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z"/><path d="M12 8v5"/><path d="M12 16h.01"/>',
  shield: '<path d="M12 3l7 3v6c0 4-3 7.2-7 9-4-1.8-7-5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
  cpu: '<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M4 10h3M4 14h3M17 10h3M17 14h3M10 4v3M14 4v3M10 17v3M14 17v3"/>',
  memory: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 17v3M12 17v3M17 17v3M7 11h10"/>',
  database: '<ellipse cx="12" cy="6.5" rx="7" ry="3"/><path d="M5 6.5v11c0 1.7 3.1 3 7 3s7-1.3 7-3v-11"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
  terminal: '<path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/><path d="M7 10l2.5 2L7 14"/><path d="M12.5 15H17"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M6 14h7M16 14h2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>',
  palette: '<path d="M12 3a9 9 0 0 0 0 18h1.5a2 2 0 0 0 0-4H13a2 2 0 0 1 0-4h5a3 3 0 0 0 3-3 7 7 0 0 0-7-7z"/><circle cx="8" cy="10" r="1"/><circle cx="10.5" cy="6.5" r="1"/><circle cx="15" cy="7.5" r="1"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  'panel-left': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  'zoom-in': '<circle cx="11" cy="11" r="6"/><path d="M15.5 15.5 20 20"/><path d="M11 9v4M9 11h4"/>',
  'zoom-out': '<circle cx="11" cy="11" r="6"/><path d="M15.5 15.5 20 20"/><path d="M9 11h4"/>',
  'chevron-down': '<path d="M6 9.5 12 15.5 18 9.5"/>',
  'chevron-right': '<path d="M9.5 6 15.5 12 9.5 18"/>',
  'chevron-left': '<path d="M14.5 6 8.5 12 14.5 18"/>',
  'chevron-up': '<path d="M6 14.5 12 8.5 18 14.5"/>',
  'corner-down-left': '<path d="M9 10l-4 4 4 4"/><path d="M5 14h9a5 5 0 0 0 5-5V5"/>',
  'external-link': '<path d="M14 4h6v6"/><path d="M20 4l-8 8"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  link: '<path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V8a4 4 0 0 1 8 0v2"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h5v18H6a2 2 0 0 1-2-2z"/><path d="M20 5a2 2 0 0 0-2-2h-5v18h5a2 2 0 0 0 2-2z"/>',
  sparkles: '<path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z"/><path d="M18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8z"/>',
  rocket: '<path d="M13 4c3.5 1 6 3.5 7 7-2.5 4.5-6.5 7-11 7l-3-3c0-4.5 2.5-8.5 7-11z"/><circle cx="13.5" cy="10.5" r="1.8"/><path d="M6 15l-2 5 5-2"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  package: '<path d="M12 3 4 7v10l8 4 8-4V7z"/><path d="M4 7l8 4 8-4M12 11v10"/>',
  layers: '<path d="M12 3 3 8l9 5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  'file-code': '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M10 12.5 8 15l2 2.5M14 12.5 16 15l-2 2.5"/>',
  'message-square': '<path d="M20 5v9a2 2 0 0 1-2 2h-6l-4 4v-4H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/>',
  eye: '<path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.5"/>',
  wand: '<path d="M5 19 17 7"/><path d="M15 5l1 1"/><path d="M18 8l1 1"/><path d="M13 3l.8 1.7L15.5 5.5 13.8 6.3 13 8l-.8-1.7L10.5 5.5l1.7-.8z"/>',
  'git-branch': '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="9" r="2.5"/><path d="M6 8.5v7"/><path d="M18 11.5c0 3-3 3.5-6 4"/>',
  puzzle: '<path d="M10 3h4v3a2 2 0 1 0 4 0V3h3v7h-3a2 2 0 1 0 0 4h3v7h-7v-3a2 2 0 1 0-4 0v3H3v-7h3a2 2 0 1 0 0-4H3V3h7z"/>',
  lightbulb: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 1 4 10.5V15H8v-1.5A6 6 0 0 1 12 3z"/>',
});

export const ICON_NAMES = Object.freeze(Object.keys(ICONS));

/** Returns the SVG markup for an icon, or `null` when the name is unknown. */
export function iconSvg(name) {
  return ICONS[name] ?? null;
}

/**
 * Creates an icon element.
 * @param {string} name
 * @param {{ size?: 'sm'|'md'|'lg', className?: string|null, title?: string|null }} [options]
 */
export function icon(name, { size = 'md', className = null, title = null } = {}) {
  const markup = ICONS[name];
  const node = el(`span.icon${size === 'sm' ? '.icon--sm' : size === 'lg' ? '.icon--lg' : ''}`, {
    class: className,
    dataset: markup ? { icon: name } : {},
    attrs: { 'aria-hidden': title ? 'false' : 'true', role: title ? 'img' : null, 'aria-label': title },
  });
  if (markup) node.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${markup}</svg>`;
  else node.textContent = '•';
  return node;
}

/** Replaces the glyph of an existing icon element. */
export function setIcon(node, name) {
  if (!node) return null;
  const markup = ICONS[name];
  if (!markup) return null;
  node.dataset.icon = name;
  node.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${markup}</svg>`;
  return node;
}

/** Fills every `.icon[data-icon]` without SVG content inside `root`. */
export function hydrateIcons(root = document) {
  let count = 0;
  for (const node of root.querySelectorAll('.icon[data-icon]')) {
    if (node.firstElementChild) continue;
    const markup = ICONS[node.dataset.icon];
    if (!markup) continue;
    node.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${markup}</svg>`;
    count += 1;
  }
  return count;
}

/**
 * Keeps `data-icon` elements hydrated, including ones added later. Returns a disposer.
 * Batched through a frame scheduler so a burst of DOM insertions costs one pass.
 */
export function installIconHydration(root = document.body) {
  const schedule = createScheduler(() => hydrateIcons(document));
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        schedule();
        return;
      }
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  hydrateIcons(document);
  return () => observer.disconnect();
}
