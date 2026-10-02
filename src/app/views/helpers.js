/**
 * Shared view helpers — small builders reused by every view.
 *
 * Keeping them here avoids duplicating markup logic (and the CSS class names) across the seven
 * views, and guarantees the same structure everywhere.
 */

import { el } from '../../renderer/utils/dom.js';
import { icon } from '../../ui/icons.js';

export function panel({ title = null, subtitle = null, actions = [], body = null, footer = null, flush = false, className = null, iconName = null }) {
  const header = title || actions.length > 0 || subtitle
    ? el('div.panel__header', null, [
      iconName ? icon(iconName, { size: 'sm' }) : null,
      el('div', null, [
        title ? el('h2.panel__title', { text: title }) : null,
        subtitle ? el('p.panel__subtitle', { text: subtitle }) : null,
      ]),
      el('div.toolbar__spacer'),
      actions.length > 0 ? el('div.btn-group', null, actions) : null,
    ])
    : null;
  return el(`section.panel${className ? `.${className}` : ''}`, null, [
    header,
    el(`div.panel__body${flush ? '.panel__body--flush' : ''}`, null, body),
    footer ? el('div.panel__footer', null, footer) : null,
  ]);
}

export function statCard({ label, value, hint = null, tone = null, iconName = null }) {
  const valueNode = el('div.card__value', { text: value === null || value === undefined ? '—' : String(value) });
  const card = el(`div.card${tone ? `.card--${tone}` : ''}`, null, [
    el('div.card__label', null, [iconName ? icon(iconName, { size: 'sm' }) : null, el('span', { text: label })]),
    valueNode,
    hint ? el('div.card__hint', { text: hint }) : null,
  ]);
  card.setValue = (next, nextHint = undefined) => {
    valueNode.textContent = next === null || next === undefined ? '—' : String(next);
    if (nextHint !== undefined) {
      let hintNode = card.querySelector('.card__hint');
      if (!hintNode) {
        hintNode = el('div.card__hint');
        card.appendChild(hintNode);
      }
      hintNode.textContent = nextHint ?? '';
    }
  };
  return card;
}

export function emptyState({ title, message = null, action = null, iconName = 'info' }) {
  return el('div.empty', null, [
    icon(iconName, { size: 'lg' }),
    el('div.empty__title', { text: title }),
    message ? el('p', { text: message }) : null,
    action ? el('div', { style: { marginTop: '12px' } }, [action]) : null,
  ]);
}

export function field({ label, control, hint = null, error = null }) {
  return el('div.field', null, [
    el('label.field__label', { text: label }),
    control,
    hint ? el('div.card__hint', { text: hint }) : null,
    error ? el('div.field__error', { text: error }) : null,
  ]);
}

export function select({ options, value = null, on, name = null }) {
  const node = el('select.select', {
    attrs: name ? { name } : null,
    on,
  }, options.map((option) => el('option', {
    value: option.value,
    text: option.label,
    selected: value !== null && String(option.value) === String(value),
    disabled: option.disabled === true,
  })));
  node.value = value === null ? '' : String(value);
  return node;
}

export function searchInput({ placeholder = 'Buscar…', on, value = '' }) {
  return el('div.search-field', null, [
    icon('search', { size: 'sm' }),
    el('input.input.input--search', {
      attrs: { type: 'search', placeholder, spellcheck: 'false' },
      value,
      on: { input: on },
    }),
  ]);
}

export function kvList(entries) {
  return el('dl.kv', null, entries
    .filter(Boolean)
    .flatMap(([key, value]) => [
      el('dt', { text: key }),
      el('dd', { text: value === null || value === undefined ? '—' : String(value) }),
    ]));
}

export function badge(text, tone = null) {
  return el(`span.badge${tone ? `.badge--${tone}` : ''}`, { text });
}

export function toolbarGroup(...children) {
  return el('div.toolbar__group', null, children);
}

export function iconButton({ iconName, title, onClick, variant = 'ghost', size = 'md', active = false, disabled = false }) {
  return el(`button.btn.btn--${variant}.btn--icon${size === 'sm' ? '.btn--sm' : ''}${active ? '.is-active' : ''}`, {
    attrs: { type: 'button', title, 'aria-label': title, 'aria-pressed': active ? 'true' : 'false' },
    disabled,
    on: { click: onClick },
  }, [icon(iconName, { size: 'sm' })]);
}

export function labelledButton({ label, iconName = null, onClick, variant = 'ghost', size = 'md', disabled = false, title = null }) {
  return el(`button.btn.btn--${variant}${size === 'sm' ? '.btn--sm' : ''}`, {
    attrs: { type: 'button', title: title ?? label },
    disabled,
    on: { click: onClick },
  }, [iconName ? icon(iconName, { size: 'sm' }) : null, el('span', { text: label })]);
}

export function listRow({ title, meta = null, badges = [], actions = [], active = false, iconName = null, onDoubleClick = null, onClick = null }) {
  return el(`div.list__row${active ? '.is-active' : ''}`, {
    attrs: { role: 'option', 'aria-selected': active ? 'true' : 'false', tabindex: '0' },
    on: {
      click: onClick,
      dblclick: onDoubleClick,
      keydown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick?.(event);
        }
      },
    },
  }, [
    iconName ? icon(iconName, { size: 'sm' }) : null,
    el('div.list__main', null, [
      el('div.list__title', { text: title }),
      meta ? el('div.list__meta', { text: meta }) : null,
    ]),
    badges.length > 0 ? el('div.list__actions', null, badges) : null,
    actions.length > 0 ? el('div.list__actions', null, actions) : null,
  ]);
}
