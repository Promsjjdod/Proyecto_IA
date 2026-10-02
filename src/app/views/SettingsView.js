/**
 * SettingsView — every setting the application really has, generated from the shared schema.
 *
 * There is no duplicated list of options here: the categories, labels, descriptions, types, ranges
 * and `enabledWhen` conditions come from `SETTINGS_SCHEMA` (the same source the server validates
 * against), so a setting can never exist in the UI without existing in the backend, or vice versa.
 *
 * It also owns the two editors that need bespoke controls: the theme/accent picker (ThemeManager)
 * and the shortcut table (ShortcutManager + `shortcuts.bindings`).
 */

import { el } from '../../renderer/utils/dom.js';
import { createScheduler } from '../../renderer/utils/async.js';
import { icon, ICON_NAMES } from '../../ui/icons.js';
import { isSettingEnabled } from '../../shared/settings-schema.js';
import { badge, labelledButton, panel, searchInput } from './helpers.js';
import { ACCENT_PRESETS } from '../../renderer/utils/color.js';
import { ShortcutManager } from '../../renderer/shortcuts/ShortcutManager.js';

export class SettingsView {
  #app;
  #root = null;
  #nodes = {};
  #activeCategory = 'general';
  #searchTerm = '';
  #unsubscribers = [];
  #visible = false;
  #refresh = null;

  constructor(app) {
    this.#app = app;
    this.#refresh = createScheduler(() => this.#renderCategoryContent(), 120);
  }

  get id() {
    return 'settings';
  }

  get title() {
    return 'Ajustes';
  }

  mount() {
    this.#root = el('div.view.settings');
    const header = el('div.view__header', null, [
      el('span.view__title', { text: 'Ajustes' }),
      el('div.toolbar__spacer'),
      el('div.toolbar__group', null, [
        labelledButton({ label: 'Exportar', iconName: 'download', size: 'sm', onClick: () => void this.#export() }),
        labelledButton({ label: 'Importar', iconName: 'upload', size: 'sm', onClick: () => void this.#import() }),
        labelledButton({ label: 'Restaurar todo', iconName: 'undo', size: 'sm', variant: 'danger', onClick: () => void this.#resetAll() }),
      ]),
    ]);
    const nav = el('nav.settings__nav', { attrs: { 'aria-label': 'Categorías de ajustes' } });
    const content = el('div.settings__content.view__scroll');
    this.#nodes.nav = nav;
    this.#nodes.content = content;
    this.#nodes.header = header;
    this.#root.append(header, el('div.view__body', null, [nav, content]));
    return this.#root;
  }

  async activate() {
    this.#visible = true;
    this.#unsubscribers.push(
      this.#app.settings.subscribe(() => this.#refresh.schedule()),
      this.#app.theme.onChange?.(() => this.#refresh.schedule()) ?? (() => {}),
    );
    const startup = this.#app.settings.get('general.startupView');
    if (startup && startup !== 'settings' && this.#activeCategory === 'general') {
      // Keep the last visited category within the session; nothing to do on first activation.
    }
    this.#renderNav();
    this.#renderCategoryContent();
  }

  deactivate() {
    this.#visible = false;
    for (const unsubscribe of this.#unsubscribers.splice(0)) unsubscribe?.();
  }

  async reload() {
    this.#renderNav();
    this.#renderCategoryContent();
  }

  #renderNav() {
    const categories = this.#app.settings.categories ?? [];
    const counts = new Map();
    for (const definition of this.#app.settings.schema) {
      counts.set(definition.category, (counts.get(definition.category) ?? 0) + 1);
    }
    this.#nodes.nav.replaceChildren(...categories.map((category) => el(`button.settings__nav-item${category.id === this.#activeCategory ? '.is-active' : ''}`, {
      attrs: { type: 'button', 'aria-current': category.id === this.#activeCategory ? 'page' : null, title: category.description ?? category.label },
      on: {
        click: () => {
          this.#activeCategory = category.id;
          this.#searchTerm = '';
          this.#renderNav();
          this.#renderCategoryContent();
        },
      },
    }, [
      icon(ICON_NAMES.includes(category.icon) ? category.icon : 'settings', { size: 'sm' }),
      el('span', { text: category.label }),
      el('span.settings__nav-count', { text: String(counts.get(category.id) ?? 0) }),
    ])));
  }

  #renderCategoryContent() {
    if (!this.#visible) return;
    const content = this.#nodes.content;
    const schema = this.#app.settings.schema;
    const values = this.#app.settings.values;
    const category = (this.#app.settings.categories ?? []).find((entry) => entry.id === this.#activeCategory);

    const search = searchInput({
      placeholder: 'Buscar un ajuste…',
      value: this.#searchTerm,
      on: (event) => {
        this.#searchTerm = event.target.value.trim().toLowerCase();
        this.#renderCategoryContent();
      },
    });
    search.querySelector('input').dataset.role = 'settings-search';

    const definitions = schema
      .filter((definition) => definition.category === this.#activeCategory)
      .filter((definition) => this.#searchTerm === '' || `${definition.label} ${definition.description ?? ''} ${definition.key}`.toLowerCase().includes(this.#searchTerm))
      .filter((definition) => this.#app.settings.get('general.showAdvancedSettings') !== false || definition.advanced !== true);

    const sections = new Map();
    for (const definition of definitions) {
      const group = definition.section ?? 'General';
      if (!sections.has(group)) sections.set(group, []);
      sections.get(group).push(definition);
    }

    const nodes = [
      el('div.settings__group-header', null, [
        el('div', null, [
          el('h2.settings__group-title', { text: category?.label ?? this.#activeCategory }),
          el('p.settings__group-description', { text: category?.description ?? '' }),
        ]),
        el('div.toolbar__group', null, [
          labelledButton({
            label: 'Restaurar sección',
            iconName: 'undo',
            size: 'sm',
            onClick: () => void this.#resetSection(),
          }),
        ]),
      ]),
      search,
    ];

    if (this.#activeCategory === 'appearance') nodes.push(this.#renderThemeSection());
    if (this.#activeCategory === 'shortcuts') nodes.push(this.#renderShortcutSection());
    if (this.#activeCategory === 'general') nodes.push(this.#renderSessionSection());

    if (definitions.length === 0 && this.#searchTerm !== '') {
      nodes.push(el('div.empty', null, [el('div.empty__title', { text: `Ningún ajuste coincide con «${this.#searchTerm}»` })]));
    }

    for (const [group, list] of sections) {
      nodes.push(el('div.settings__group', null, [
        el('h3.settings__group-title', { text: group }),
        ...list.map((definition) => this.#renderSetting(definition, values)),
      ]));
    }

    const restart = this.#app.settings.pendingRestart;
    if (restart.length > 0) {
      nodes.push(el('div.card.card--warning', null, [
        el('div.card__label', { text: 'Requiere reinicio' }),
        el('div.card__hint', { text: `Estos ajustes se aplicarán al reiniciar la aplicación: ${restart.join(', ')}` }),
      ]));
    }

    const context = document.activeElement?.dataset?.role === 'settings-search' ? document.activeElement.selectionStart : null;
    content.replaceChildren(...nodes);
    if (context !== null) {
      const input = content.querySelector('[data-role="settings-search"]');
      input?.focus();
      input?.setSelectionRange(context, context);
    }
  }

  #renderSetting(definition, values) {
    const value = values[definition.key];
    const enabled = isSettingEnabled(definition, values);
    const modified = this.#app.settings.isModified(definition.key);
    const row = el(`div.setting${enabled ? '' : '.is-disabled'}`, null, [
      el('div.setting__info', null, [
        el('label.setting__label', { attrs: { for: `setting-${definition.key}` }, text: definition.label }),
        el('div.setting__description', { text: definition.description ?? '' }),
        el('div.setting__key', { text: definition.key }),
      ]),
      el('div.setting__control', null, [this.#buildControl(definition, value, enabled)]),
      modified
        ? el('button.setting__reset.btn.btn--ghost.btn--icon.btn--sm', {
          attrs: { type: 'button', title: 'Restaurar el valor por defecto' },
          on: { click: () => void this.#resetKey(definition.key, definition.label) },
        }, [icon('undo', { size: 'sm' })])
        : null,
    ]);
    if (definition.requiresRestart || ['storage.backend', 'performance.lowPerformanceMode'].includes(definition.key)) {
      row.querySelector('.setting__info')?.appendChild(badge('requiere reinicio', 'warning'));
    }
    return row;
  }

  #buildControl(definition, value, enabled) {
    const commit = (next) => void this.#apply(definition, next);
    switch (definition.type) {
      case 'boolean': {
        const input = el('input', {
          attrs: { id: `setting-${definition.key}`, type: 'checkbox', role: 'switch' },
          checked: value === true,
          disabled: !enabled,
          on: { change: () => commit(input.checked) },
        });
        return el('label.switch', { attrs: { title: definition.description ?? definition.label } }, [
          input,
          el('span.switch__track', null, [el('span.switch__thumb')]),
          el('span', { text: value === true ? 'Activado' : 'Desactivado' }),
        ]);
      }
      case 'number': {
        const input = el('input.range__input', {
          attrs: {
            id: `setting-${definition.key}`,
            type: 'range',
            min: definition.min ?? 0,
            max: definition.max ?? 100,
            step: definition.step ?? 1,
            'aria-valuetext': formatNumberValue(value),
          },
          value: String(value ?? definition.default ?? 0),
          disabled: !enabled,
        });
        const output = el('output.range__value', { text: `${formatNumberValue(value)}${definition.unit ? ` ${definition.unit}` : ''}` });
        input.addEventListener('input', () => {
          output.textContent = `${input.value}${definition.unit ? ` ${definition.unit}` : ''}`;
        });
        input.addEventListener('change', () => commit(Number(input.value)));
        return el('div.range', null, [input, output]);
      }
      case 'enum': {
        const select = el('select.select', {
          attrs: { id: `setting-${definition.key}` },
          disabled: !enabled,
          on: { change: () => commit(select.value) },
        }, (definition.options ?? []).map((option) => el('option', {
          value: option.value,
          text: option.label ?? option.value,
          title: option.description ?? null,
          selected: value === option.value,
        })));
        select.value = value ?? definition.default ?? '';
        return select;
      }
      case 'color': {
        const input = el('input', {
          attrs: { id: `setting-${definition.key}`, type: 'color' },
          value: /^#[0-9a-f]{6}$/i.test(String(value ?? '')) ? value : '#5b8dff',
          disabled: !enabled,
        });
        const clear = labelledButton({ label: 'Usar el del tema', size: 'sm', onClick: () => commit('') });
        input.addEventListener('change', () => commit(input.value));
        return el('div.color-field', null, [input, clear]);
      }
      case 'string':
      default: {
        const input = el('input.input', {
          attrs: { id: `setting-${definition.key}`, type: 'text', maxlength: definition.maxLength ?? 500, spellcheck: 'false' },
          value: value ?? '',
          disabled: !enabled,
        });
        input.addEventListener('change', () => commit(input.value));
        return input;
      }
    }
  }

  /* ------------------------------------------------------------------ *\
   * Themes and accent
   * \* ------------------------------------------------------------------ */

  #renderThemeSection() {
    const theme = this.#app.theme;
    const cards = el('div.theme-grid', null, theme.themes.map((entry) => el(`button.theme-card${entry.id === theme.active?.id ? '.is-active' : ''}`, {
      attrs: { type: 'button', 'aria-pressed': entry.id === theme.active?.id ? 'true' : 'false' },
      on: {
        click: async () => {
          const result = await theme.apply(entry.id);
          if (result?.ok === false) this.#app.notifications.error(result.error?.message ?? `No se pudo aplicar el tema ${entry.name}`);
          else this.#app.notifications.success(`Tema aplicado: ${entry.name}`);
        },
      },
    }, [
      el('div.theme-card__preview', { style: { background: entry.tokens?.['background-app'] ?? entry.tokens?.['bg-app'] ?? 'transparent' } }, [
        el('div.theme-card__swatch', { style: { background: entry.tokens?.['accent'] ?? 'transparent' } }),
      ]),
      el('div.theme-card__name', { text: entry.name }),
      el('div.theme-card__meta', { text: `${entry.builtin === false ? 'personalizado' : 'incluido'} · ${entry.mode === 'light' ? 'claro' : 'oscuro'}` }),
    ])));

    const accentSwatches = el('div.accent-swatches', null, ACCENT_PRESETS.map((preset) => el(`button.accent-swatch${theme.accent === preset.value ? '.is-active' : ''}`, {
      attrs: { type: 'button', title: `${preset.name} (${preset.value})`, 'aria-label': preset.name },
      style: { background: preset.value },
      on: {
        click: async () => {
          const result = await theme.applyAccent(preset.value);
          if (result?.ok === false) this.#app.notifications.error(result.error?.message ?? 'No se pudo aplicar el color de acento');
          else {
            this.#app.notifications.success(`Acento aplicado: ${preset.name}`);
            this.#renderCategoryContent();
          }
        },
      },
    })));

    const problems = theme.problems ?? [];
    return el('div.settings__group', null, [
      panel({
        title: 'Tema',
        iconName: 'palette',
        subtitle: 'Todos los colores de la interfaz provienen del tema activo',
        body: el('div', null, [
          cards,
          el('div', { style: { marginTop: '12px' } }, [
            el('div.card__hint', { text: 'Color de acento' }),
            accentSwatches,
          ]),
          problems.length > 0
            ? el('div.card.card--warning', { style: { marginTop: '10px' } }, [
              el('div.card__label', { text: 'Avisos del tema' }),
              ...problems.map((problem) => el('div.card__hint', { text: typeof problem === 'string' ? problem : `${problem.themeId ?? ''}: ${problem.message ?? ''}` })),
            ])
            : null,
        ]),
        actions: [labelledButton({
          label: 'Abrir carpeta de temas',
          iconName: 'folder',
          size: 'sm',
          onClick: () => this.#app.showDataFolder('themes'),
        })],
      }),
    ]);
  }

  /* ------------------------------------------------------------------ *\
   * Shortcuts
   * \* ------------------------------------------------------------------ */

  #renderShortcutSection() {
    const manager = this.#app.shortcuts;
    const rows = manager.describe();
    const conflicts = manager.detectConflicts();
    const table = el('table.table', null, [
      el('thead', null, [el('tr', null, [
        el('th', { text: 'Comando' }),
        el('th', { text: 'Categoría' }),
        el('th', { text: 'Combinación' }),
        el('th', { text: 'Origen' }),
        el('th', { text: '' }),
      ])]),
      el('tbody', null, rows.map((row) => el('tr', null, [
        el('td', { text: row.title }),
        el('td', { text: row.category }),
        el('td', null, [el('kbd', { text: row.label || '—' })]),
        el('td', null, [row.overridden ? badge('personalizado', 'accent') : badge('del esquema')]),
        el('td', null, [
          el('div.btn-group', null, [
            labelledButton({ label: 'Cambiar', size: 'sm', onClick: () => void this.#captureShortcut(row) }),
            row.overridden ? labelledButton({ label: 'Restaurar', size: 'sm', variant: 'ghost', onClick: () => void this.#resetShortcut(row) }) : null,
          ]),
        ]),
      ]))),
    ]);

    return el('div.settings__group', null, [
      panel({
        title: 'Atajos de teclado',
        iconName: 'keyboard',
        subtitle: `${rows.length} combinaciones activas · esquema «${manager.preset}» · ${conflicts.length} conflictos`,
        body: el('div', null, [
          conflicts.length > 0
            ? el('div.card.card--warning', null, [
              el('div.card__label', { text: 'Conflictos detectados' }),
              ...conflicts.map((conflict) => el('div.card__hint', { text: `${conflict.binding}: ${conflict.commands.join(' / ')}` })),
            ])
            : null,
          table,
        ]),
      }),
    ]);
  }

  async #captureShortcut(row) {
    const captured = await new Promise((resolve) => {
      const display = el('kbd.palette__item-detail', { text: 'Pulsa una combinación…' });
      const dialog = this.#app.dialogs.open({
        title: `Nuevo atajo para «${row.title}»`,
        body: el('div', null, [
          el('p', { text: 'Pulsa la combinación que quieras asignar. Se guardará sobre el esquema actual.' }),
          display,
          el('p.card__hint', { text: 'Esc cancela · Retroceso elimina el atajo' }),
        ]),
        actions: [{ label: 'Cancelar', variant: 'ghost', onClick: () => resolve(null) }],
        onClose: () => resolve(undefined),
      });
      const onKeydown = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'Escape') {
          window.removeEventListener('keydown', onKeydown, true);
          dialog.close();
          resolve(null);
          return;
        }
        if (event.key === 'Backspace' || event.key === 'Delete') {
          window.removeEventListener('keydown', onKeydown, true);
          dialog.close();
          resolve('');
          return;
        }
        const binding = ShortcutManager.captureFromEvent(event, this.#app.shortcuts.platform);
        if (!binding) return;
        display.textContent = binding.raw;
        window.removeEventListener('keydown', onKeydown, true);
        dialog.close();
        resolve(binding.raw);
      };
      window.addEventListener('keydown', onKeydown, true);
    });

    if (captured === null || captured === undefined) return;
    const overrides = { ...(this.#app.settings.get('shortcuts.bindings') ?? {}) };
    if (captured === '') delete overrides[row.commandId];
    else overrides[row.commandId] = captured;
    const result = await this.#app.settings.set({ 'shortcuts.bindings': overrides });
    if (result?.ok === false) {
      this.#app.notifications.error(result.error?.message ?? 'No se pudo guardar el atajo');
      return;
    }
    const conflict = captured ? this.#app.shortcuts.findConflict(row.commandId, (await import('../../renderer/shortcuts/ShortcutManager.js')).normalizeBinding(captured)) : null;
    if (conflict) {
      this.#app.notifications.warn(`«${captured}» también está asignado a ${conflict.commandId}`);
    } else {
      this.#app.notifications.success(captured === '' ? `Atajo eliminado de «${row.title}»` : `«${row.title}» → ${captured}`);
    }
    this.#renderCategoryContent();
  }

  async #resetShortcut(row) {
    const overrides = { ...(this.#app.settings.get('shortcuts.bindings') ?? {}) };
    delete overrides[row.commandId];
    await this.#app.settings.set({ 'shortcuts.bindings': overrides });
    this.#app.notifications.info(`Atajo restaurado al esquema para «${row.title}»`);
    this.#renderCategoryContent();
  }

  /* ------------------------------------------------------------------ *\
   * Session, apply and file operations
   * \* ------------------------------------------------------------------ */

  #renderSessionSection() {
    const session = this.#app.session;
    return el('div.settings__group', null, [
      panel({
        title: 'Sesión',
        iconName: 'clock',
        subtitle: 'Qué se recupera al volver a abrir la aplicación',
        body: el('div', null, [
          el('dl.kv', null, [
            el('dt', { text: 'Última sesión guardada' }),
            el('dd', { text: session?.lastSavedAt ? new Date(session.lastSavedAt).toLocaleString('es-ES') : 'todavía no se guardó ninguna sesión' }),
            el('dt', { text: 'Pestañas recordadas' }),
            el('dd', { text: String(session?.restorableTabs ?? 0) }),
            el('dt', { text: 'Vista recordada' }),
            el('dd', { text: session?.view ?? '—' }),
          ]),
          el('div.btn-group', { style: { marginTop: '10px' } }, [
            labelledButton({ label: 'Guardar la sesión ahora', iconName: 'save', size: 'sm', onClick: () => void this.#saveSession() }),
            labelledButton({ label: 'Borrar la sesión guardada', iconName: 'trash', size: 'sm', variant: 'danger', onClick: () => void this.#clearSession() }),
          ]),
        ]),
      }),
    ]);
  }

  async #saveSession() {
    const result = await this.#app.session.saveNow();
    if (result.ok) this.#app.notifications.success('Sesión guardada');
    else this.#app.notifications.error(result.error?.message ?? 'No se pudo guardar la sesión');
  }

  async #clearSession() {
    const result = await this.#app.session.clear();
    if (result.ok) this.#app.notifications.info('Sesión guardada eliminada');
    else this.#app.notifications.error(result.error?.message ?? 'No se pudo borrar la sesión');
  }

  async #apply(definition, value) {
    const result = await this.#app.settings.set({ [definition.key]: value });
    if (result?.ok === false) {
      this.#app.notifications.error(result.error?.message ?? `No se pudo guardar «${definition.label}»`);
      return;
    }
    const invalid = (result.invalid ?? []).find((entry) => entry.key === definition.key);
    if (invalid) {
      this.#app.notifications.warn(invalid.message ?? `El servidor rechazó «${definition.label}»`);
      return;
    }
    this.#app.logger.debug(`Ajuste ${definition.key} = ${JSON.stringify(value)}`, { source: 'SettingsView' });
    this.#renderCategoryContent();
  }

  async #resetKey(key, label) {
    const result = await this.#app.settings.resetKey(key);
    if (result?.ok === false) this.#app.notifications.error(result.error?.message ?? `No se pudo restaurar ${label}`);
    else this.#app.notifications.info(`«${label}» restaurado al valor por defecto`);
  }

  async #resetSection() {
    const category = this.#app.settings.categories.find((entry) => entry.id === this.#activeCategory);
    const confirmed = this.#app.settings.get('general.confirmDestructive') === false
      ? true
      : await this.#app.dialogs.confirm({
        title: `Restaurar «${category?.label ?? this.#activeCategory}»`,
        message: 'Todos los ajustes de esta sección volverán a sus valores por defecto.',
        confirmLabel: 'Restaurar',
        danger: true,
      });
    if (!confirmed) return;
    const result = await this.#app.settings.resetSection(this.#activeCategory);
    if (result?.ok === false) this.#app.notifications.error(result.error?.message ?? 'No se pudo restaurar la sección');
    else this.#app.notifications.success(`Sección «${category?.label ?? this.#activeCategory}» restaurada`);
  }

  async #resetAll() {
    const confirmed = await this.#app.dialogs.confirm({
      title: 'Restaurar toda la configuración',
      message: 'Se restaurarán todos los ajustes de todas las secciones. Los scripts no se tocan.',
      confirmLabel: 'Restaurar todo',
      danger: true,
    });
    if (!confirmed) return;
    for (const category of this.#app.settings.categories) {
      await this.#app.settings.resetSection(category.id);
    }
    this.#app.notifications.success('Configuración restaurada por defecto');
  }

  async #export() {
    const result = await this.#app.settings.exportToFile();
    if (result.ok) this.#app.notifications.success(`Configuración exportada: ${result.filename}`);
    else this.#app.notifications.error(result.error?.message ?? 'No se pudo exportar la configuración');
  }

  async #import() {
    const input = el('input', { attrs: { type: 'file', accept: '.json,application/json' } });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const content = await file.text();
        const result = await this.#app.settings.importFromContent(content);
        if (result.ok === false) this.#app.notifications.error(result.error?.message ?? 'No se pudo importar la configuración');
        else this.#app.notifications.success(`Configuración importada (${result.applied ?? 0} valores)`);
      } catch (err) {
        this.#app.notifications.error(`No se pudo leer el archivo: ${err.message}`);
      }
    });
    input.click();
  }

  async reloadSession() {
    this.#renderCategoryContent();
  }

  get element() {
    return this.#root;
  }
}

function formatNumberValue(value) {
  return Number.isFinite(value) ? String(value) : '—';
}
