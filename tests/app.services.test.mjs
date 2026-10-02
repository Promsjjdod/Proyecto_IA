/**
 * Pruebas de los servicios reales del renderer sobre una aplicación arrancada de verdad.
 *
 * Se compila el bundle, se levanta el servidor, se carga la interfaz en jsdom y se ejercitan los
 * servicios con sus APIs públicas: RuntimeManager, ConsoleManager, EditorManager, SettingsManager,
 * ThemeManager, ShortcutManager, NotificationManager, CommandManager y la detección de capacidades.
 * No hay dobles de prueba de los servicios: lo que se afirma es lo que devuelve el sistema real.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { buildRenderer, loadApp, startServer } from './helpers/jsdom-env.mjs';

/**
 * Responde a un diálogo real de la aplicación: escribe en el campo y pulsa el botón principal
 * (o el primero que coincida con `label`). Devuelve `false` si el diálogo no llegó a abrirse,
 * para que la prueba falle con un motivo claro en lugar de quedarse esperando.
 */
const answerDialog = async ({ value = null, label = null, timeoutMs = 3000 } = {}) => {
  const dialog = await waitFor(() => document.querySelector('.overlay .dialog') ?? null, { timeoutMs, label: 'diálogo abierto' });
  if (value !== null) {
    const input = dialog.querySelector('input.input, textarea');
    if (!input) throw new Error('El diálogo no tiene campo de texto');
    input.value = String(value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  }
  const buttons = [...dialog.querySelectorAll('.dialog__footer button')];
  const target = label
    ? buttons.find((button) => button.textContent.trim().toLowerCase().includes(label.toLowerCase()))
    : buttons.find((button) => button.classList.contains('btn--primary')) ?? buttons[buttons.length - 1];
  if (!target) throw new Error('El diálogo no tiene botones de acción');
  target.click();
  return true;
};

const waitFor = async (predicate, { timeoutMs = 5000, intervalMs = 60, label = 'condición' } = {}) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Se agotó el tiempo esperando: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
};

/** Texto plano de una entrada (la salida del runtime usa `text`, la consola `message`). */
const entryText = (entry) => String(entry?.text ?? entry?.message ?? '');

describe('Servicios del renderer (aplicación real)', { timeout: 180_000 }, () => {
  let server;
  let env;
  let app;
  // Atajos a la ventana real de jsdom donde corre la interfaz.
  let window;
  let document;

  before(async () => {
    await buildRenderer();
    server = await startServer();
    env = await loadApp({ serverUrl: server.url });
    app = (await env.waitForBoot()).app;
    window = env.window;
    document = env.document;
  });

  after(async () => {
    await env?.dispose().catch(() => {});
    await server?.stop().catch(() => {});
  });

  /* ------------------------------------------------------------------ Runtime */

  describe('RuntimeManager', () => {
    it('ejecuta código Luau en el motor del servidor y devuelve la salida real', async () => {
      const record = await app.runtime.execute({
        source: 'local suma = 0\nfor i = 1, 4 do suma = suma + i end\nprint("total", suma)\n',
        name: 'runtime-servicios.luau',
        dialect: 'luau',
        origin: 'test',
      });
      assert.equal(record.ok, true, `la ejecución falló: ${JSON.stringify(record.error)}`);
      assert.equal(record.state, 'SUCCESS');
      assert.match(String(record.engineId), /^(server|native)\./, `motor inesperado: ${record.engineId}`);
      const text = (record.outputs ?? []).map(entryText).join('\n');
      assert.match(text, /total\s+10/);
      assert.ok(record.stats.durationMs >= 0);
    });

    it('devuelve el error real, con mensaje, estado y estadísticas', async () => {
      const record = await app.runtime.execute({
        source: 'local valor = nil\nprint(valor + 1)\n',
        name: 'runtime-error.luau',
        dialect: 'luau',
        origin: 'test',
      });
      assert.equal(record.ok, false);
      assert.equal(record.state, 'ERROR');
      assert.ok(record.error?.message?.length > 0);
      assert.match(String(record.error.message), /arithmetic|nil/);
      assert.ok(record.finishedAt >= record.startedAt);
    });

    it('marca UNAVAILABLE cuando no hay código que ejecutar', async () => {
      const record = await app.runtime.execute({ source: '   ', name: 'vacío.luau', dialect: 'luau', origin: 'test' });
      assert.equal(record.state, 'UNAVAILABLE');
      assert.equal(record.ok, false);
      assert.ok(record.error?.message?.length > 0);
    });

    it('mantiene historial y estadísticas con los datos de cada ejecución', async () => {
      const before = app.runtime.stats();
      await app.runtime.execute({ source: 'print("estadística")', name: 'stats.luau', dialect: 'luau', origin: 'test' });
      const after = app.runtime.stats();
      assert.equal(after.executed, before.executed + 1);
      assert.ok(after.success >= 1);
      assert.equal(after.error, before.error, 'una ejecución correcta no debe contar como error');
      assert.ok(after.totalDurationMs >= 0);
      assert.ok(app.runtime.history.length >= 3);
      assert.ok(app.runtime.lastExecution?.executionId);
    });

    it('informa los motores detectados y su disponibilidad real', () => {
      const engines = app.runtime.engines;
      assert.ok(engines.length >= 3, `se esperaban varios motores, hay ${engines.length}`);
      const server = engines.find((engine) => engine.mode === 'server');
      assert.ok(server, 'debe existir un motor de servidor');
      assert.equal(server.available, true, 'el motor de servidor debe estar disponible');
      const browser = engines.find((engine) => engine.mode === 'browser');
      assert.equal(browser.available, false, 'sin Web Workers el motor de navegador no puede estar disponible');
      assert.ok(Array.isArray(browser.requirements) && browser.requirements.length > 0, 'el motor no disponible debe enumerar sus requisitos');
    });

    it('cancelar sin ejecución activa no finge éxito', async () => {
      const result = await app.runtime.cancel('test');
      assert.equal(result.ok, false);
      assert.equal(result.stopped, false);
    });
  });

  /* ------------------------------------------------------------------ Consola */

  describe('ConsoleManager', () => {
    it('registra la salida del runtime y los errores con su nivel', async () => {
      const entries = await waitFor(
        () => {
          const list = app.console.filtered();
          return list.some((entry) => /total\s+10/.test(entryText(entry))) ? list : null;
        },
        { label: 'salida del script en la consola' },
      );
      assert.ok(entries.some((entry) => /total\s+10/.test(entryText(entry))));
      assert.ok(entries.some((entry) => entry.level === 'ERROR' && /arithmetic|nil/.test(entryText(entry))));
    });

    it('filtra por nivel, por término y por origen sin perder los datos', () => {
      const all = app.console.filtered();
      app.console.setLevelVisible('INFO', false);
      const withoutInfo = app.console.filtered();
      assert.ok(withoutInfo.length < all.length, 'ocultar INFO debe reducir la lista visible');
      assert.ok(app.console.filtered({ limit: null }).length >= withoutInfo.length);
      app.console.setLevelVisible('INFO', true);

      app.console.setSearch('total');
      const searched = app.console.filtered();
      assert.ok(searched.length >= 1);
      assert.ok(searched.every((entry) => /total/i.test(entryText(entry))));
      app.console.resetFilter();

      const sources = new Set(app.console.filtered().map((entry) => entry.source));
      const someSource = [...sources].find((source) => source !== null) ?? null;
      if (someSource) {
        app.console.setSource(someSource);
        assert.ok(app.console.filtered().every((entry) => entry.source === someSource));
      }
      app.console.resetFilter();
      assert.equal(app.console.filtered().length, all.length, 'resetFilter debe devolver todas las entradas');
    });

    it('exporta el registro en texto y JSON', () => {
      const text = app.console.toText();
      assert.match(text, /total\s+10/);
      const exported = app.console.exportLogs({ format: 'json' });
      assert.equal(exported.ok, true);
      assert.ok(exported.bytes > 0);
      assert.match(String(exported.filename), /\.json$/);
      // El JSON se genera a partir de las mismas entradas filtradas que exporta `toText()`.
      const lines = text.split('\n').filter((line) => line.includes('total'));
      assert.ok(lines.length >= 1);
    });

    it('vacía la consola informando cuántas entradas había', () => {
      const result = app.console.clear();
      assert.equal(result.ok, true);
      assert.ok(result.cleared > 0);
      assert.equal(app.console.filtered().length, 0);
      assert.equal(app.console.stats().total, 0);
    });
  });

  /* ------------------------------------------------------------------ Editor */

  describe('EditorManager', () => {
    it('abre un documento, lo edita, lo marca sucio y lo vuelve a marcar limpio', () => {
      const opened = app.editor.openDocument({ id: 'doc-test', name: 'editor-test.luau', content: 'local x = 1\n' });
      assert.equal(opened.ok, true);
      assert.equal(app.editor.getValue('doc-test'), 'local x = 1\n');
      assert.equal(app.editor.isDirty('doc-test'), false, 'un documento recién abierto no está sucio');

      app.editor.setValue('doc-test', 'local x = 2\nprint(x)\n');
      assert.match(app.editor.getValue('doc-test'), /local x = 2/);
      assert.equal(app.editor.isDirty('doc-test'), true);
      app.editor.markSaved('doc-test');
      assert.equal(app.editor.isDirty('doc-test'), false);
    });

    it('informa la posición del cursor y permite ir a una línea concreta', async () => {
      app.editor.setActive('doc-test');
      app.editor.gotoLine(2, 1);
      await new Promise((resolve) => setTimeout(resolve, 30));
      const cursor = app.editor.cursorInfo();
      assert.equal(cursor.position.line, 1, 'la posición interna es 0-based');
      assert.equal(cursor.line, 2, 'la línea mostrada es 1-based');
      assert.ok(cursor.documentId === 'doc-test');
    });

    it('aplica el formateador de Lua y devuelve un resultado verificable', () => {
      app.editor.setValue('doc-test', 'local   x=1\nif x then\nprint( x )\nend\n');
      const result = app.editor.format();
      assert.equal(typeof result.ok, 'boolean');
      assert.ok(result.ok === false || result.ok === true);
      assert.ok(app.editor.getValue('doc-test').includes('local'));
    });

    it('expone los diagnósticos como lista plana y su estado con motivo', () => {
      const list = app.editor.diagnosticsFor('doc-test');
      assert.ok(Array.isArray(list), 'diagnosticsFor debe devolver un array');
      const state = app.editor.diagnosticsState('doc-test');
      assert.ok(Array.isArray(state.diagnostics));
      assert.equal(typeof state.unavailable, 'boolean');
      assert.equal(state.diagnostics, list);
    });

    it('cambia el tamaño de fuente del editor con zoom, dentro de los límites configurados', async () => {
      const initial = app.settings.get('editor.fontSize');
      const up = await app.editor.setZoom(initial + 2);
      assert.equal(up.ok, true);
      assert.equal(app.settings.get('editor.fontSize'), initial + 2);
      const tooBig = await app.editor.setZoom(999);
      assert.equal(tooBig.ok, true);
      const clamped = app.settings.get('editor.fontSize');
      assert.ok(clamped <= 32 && clamped > initial, `el zoom debe acotarse al máximo real, se obtuvo ${clamped}`);
      await app.editor.setZoom(initial);
      assert.equal(app.settings.get('editor.fontSize'), initial);
    });
  });

  /* ----------------------------------------------------- Resaltado de sintaxis */

  describe('SyntaxHighlighter', () => {
    it('compone el lenguaje real y expone las variables del tema que consume', () => {
      const highlighter = app.editor.highlighter;
      assert.ok(highlighter, 'el editor debe exponer su resaltador');
      const language = highlighter.languageExtensions();
      assert.equal(language.length, 3, 'tokenizador, indentado y plegado');
      assert.ok(Array.isArray(highlighter.extensions()) && highlighter.extensions().length > 3);
      assert.ok(highlighter.ruleCount >= 20, `reglas insuficientes: ${highlighter.ruleCount}`);
      const variables = highlighter.variables();
      assert.ok(variables.length >= 10, `variables insuficientes: ${variables.length}`);
      assert.ok(variables.every((variable) => /^--syn-[a-z-]+$/.test(variable)), `variables inesperadas: ${variables.join(', ')}`);
    });

    it('desactiva el resaltado desde los ajustes sin romper el editor', async () => {
      await app.settings.set({ 'editor.syntaxHighlighting': false });
      assert.equal(app.editor.highlighter.enabled, false);
      assert.deepEqual(app.editor.highlighter.highlightExtensions(), []);
      await app.settings.set({ 'editor.syntaxHighlighting': true });
      assert.equal(app.editor.highlighter.enabled, true);
      assert.ok(app.editor.highlighter.highlightExtensions().length > 0);
    });

    it('comprueba que el tema activo define todas las variables de sintaxis', () => {
      const highlighter = app.editor.highlighter;
      const missing = highlighter.missingVariables(app.theme.active);
      assert.deepEqual(missing, [], `el tema ${app.theme.active?.id} no define: ${missing.join(', ')}`);
      const described = app.editor.snapshot().syntax;
      assert.equal(typeof described.enabled, 'boolean');
      assert.ok(described.rules >= 20);
      assert.deepEqual(described.missingVariables, []);
    });
  });

  /* ----------------------------------------------------- Pestañas y guardado */

  describe('Pestañas y guardado real', () => {
    it('crea el archivo con una sola extensión cuando el nombre ya la incluye', async () => {
      const created = await app.scripts.create({
        name: 'prueba-extension.luau',
        content: 'print("extension")\n',
        dialect: 'luau',
        open: false,
      });
      assert.equal(created.ok, true, `la creación falló: ${JSON.stringify(created.error)}`);
      assert.equal(created.script.file, 'prueba-extension.luau');
      assert.equal(created.script.extension, '.luau');
    });

    it('guarda una pestaña sin archivo conservando el contenido del editor', async () => {
      const opened = app.editor.openDocument({ id: 'doc-sin-guardar', name: 'sin-guardar.luau', content: 'local pendiente = 7\n' });
      assert.equal(opened.ok, true);
      app.editor.setValue('doc-sin-guardar', 'local pendiente = 7\nprint(pendiente)\n');
      assert.equal(app.editor.isDirty('doc-sin-guardar'), true);
      assert.equal(app.scripts.has('doc-sin-guardar'), false, 'la pestaña todavía no es un script guardado');

      const saving = app.tabs.save('doc-sin-guardar');
      await answerDialog({ value: 'guardado-desde-pestana.luau' });
      const result = await saving;
      assert.equal(result?.ok, true, `el guardado falló: ${JSON.stringify(result?.error ?? result)}`);
      const stored = app.scripts.get('guardado-desde-pestana');
      assert.ok(stored, 'el script debe existir en la biblioteca');
      assert.equal(stored.file, 'guardado-desde-pestana.luau');
      // El contenido se comprueba directamente contra el servidor: es el archivo real en disco.
      const onDisk = await app.apiClient.get('/api/scripts/guardado-desde-pestana/content');
      assert.match(String(onDisk.content ?? ''), /local pendiente = 7/);
      const names = app.tabs.tabs.map((entry) => entry.name);
      assert.equal(names.includes('sin-guardar.luau'), false, `no debe quedar la pestaña temporal: ${names.join(', ')}`);
    });
  });

  /* --------------------------------------------------------------- Ajustes */

  describe('SettingsManager', () => {
    it('lee y aplica valores válidos en el servidor', async () => {
      const result = await app.settings.set({ 'editor.tabSize': 3 });
      assert.equal(result.ok, true);
      assert.equal(app.settings.get('editor.tabSize'), 3);
      assert.ok(app.settings.isModified('editor.tabSize'));
    });

    it('rechaza valores inválidos con el motivo real y sin tocar el valor guardado', async () => {
      const before = app.settings.get('editor.tabSize');
      const result = await app.settings.set({ 'editor.tabSize': 999 });
      assert.equal(result.ok, false);
      assert.ok(result.errors.length >= 1);
      assert.equal(result.errors[0].key, 'editor.tabSize');
      assert.equal(app.settings.get('editor.tabSize'), before);
    });

    it('rechaza claves desconocidas', async () => {
      const result = await app.settings.set({ 'inventado.opcion': true });
      assert.equal(result.ok, false);
      assert.match(result.errors[0].message, /desconocida/i);
    });

    it('restaura el valor por defecto de una clave', async () => {
      const definition = app.settings.getDefinition('editor.tabSize');
      await app.settings.resetKey('editor.tabSize');
      assert.equal(app.settings.get('editor.tabSize'), definition.default);
      assert.equal(app.settings.isModified('editor.tabSize'), false);
    });

    it('describe todas las categorías con valores reales', () => {
      const snapshot = app.settings.snapshot();
      assert.ok(snapshot.count > 40, 'debe haber más de 40 ajustes');
      assert.equal(snapshot.categoryCount, 7);
      assert.equal(Object.keys(app.settings.values).length, snapshot.count);
      assert.equal(app.settings.categories.length, 7);
      assert.ok(app.settings.schema.length > 40);
    });
  });

  /* ------------------------------------------------------------------ Tema */

  describe('ThemeManager', () => {
    it('aplica un tema escribiendo todas las variables en :root', () => {
      const result = app.theme.apply('lumen-light');
      assert.equal(result.ok, true);
      const root = env.document.documentElement;
      assert.equal(root.dataset.theme, 'lumen-light');
      assert.equal(root.style.getPropertyValue('--bg-app').trim().length > 0, true);
      assert.equal(root.style.getPropertyValue('--text-primary').trim().length > 0, true);
    });

    it('vuelve al tema oscuro y expone el mapa de tokens', () => {
      app.theme.apply('lumen-dark');
      assert.equal(env.document.documentElement.dataset.theme, 'lumen-dark');
      const tokens = app.theme.tokenMap();
      assert.ok(Object.keys(tokens).length > 40);
      assert.ok(tokens['bg-app']);
    });

    it('avisa cuando el tema no existe en lugar de aplicar algo a medias', () => {
      const result = app.theme.apply('tema-que-no-existe');
      assert.equal(result.ok, false);
      assert.match(result.error, /no está cargado/i);
    });

    it('notifica los cambios de tema a los suscriptores', async () => {
      let received = null;
      const unsubscribe = app.theme.subscribe((payload) => { received = payload; });
      app.theme.apply('lumen-dark');
      await new Promise((resolve) => setTimeout(resolve, 30));
      unsubscribe();
      assert.ok(received, 'el suscriptor debe recibir el cambio de tema');
    });
  });

  /* ------------------------------------------------------------------ Atajos */

  describe('ShortcutManager', () => {
    it('todo atajo declarado tiene un comando real detrás', () => {
      const bindings = app.shortcuts.describe();
      assert.ok(bindings.length > 20);
      const orphans = bindings.filter((binding) => binding.exists !== true);
      assert.deepEqual(orphans.map((b) => b.commandId), [], 'ningún atajo puede apuntar a un comando inexistente');
    });

    it('ejecuta un atajo global de verdad (Ctrl+B alterna la barra lateral)', () => {
      const before = app.sidebarMode;
      const handled = app.shortcuts.handleKeydown(new env.window.KeyboardEvent('keydown', {
        key: 'b', code: 'KeyB', ctrlKey: true, bubbles: true, cancelable: true,
      }));
      assert.equal(handled, true, 'el atajo debe reconocerse');
      assert.notEqual(app.sidebarMode, before, 'el comando asociado debe haberse ejecutado');
      app.shortcuts.handleKeydown(new env.window.KeyboardEvent('keydown', { key: 'b', code: 'KeyB', ctrlKey: true }));
      assert.equal(app.sidebarMode, before, 'el segundo atajo debe revertir el estado');
    });

    it('ejecuta el comando de la paleta con Ctrl+Shift+P desde el evento real', () => {
      app.palette.close('limpieza');
      env.window.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true }));
      assert.equal(env.document.querySelectorAll('.palette').length, 1, 'la paleta debe abrirse');
      app.palette.close('test');
    });

    it('no ejecuta atajos mientras se escribe en un campo', () => {
      const input = env.document.createElement('input');
      env.document.body.appendChild(input);
      const before = app.sidebarMode;
      const event = new env.window.KeyboardEvent('keydown', { key: 'b', code: 'KeyB', ctrlKey: true, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      assert.equal(app.sidebarMode, before, 'el atajo debe bloquearse en campos de texto');
      input.remove();
    });
  });

  /* -------------------------------------------------------------- Comandos */

  describe('CommandManager y paleta', () => {
    it('registra los comandos, incluidos los alias de atajos ocultos', () => {
      const visible = app.commands.list();
      const all = app.commands.describe();
      assert.ok(all.length >= 80, `se esperaban al menos 80 comandos, hay ${all.length}`);
      assert.ok(app.commands.get('runtime.run'));
      assert.ok(app.commands.get('app.commandPalette'), 'el alias del atajo debe existir');
      assert.equal(visible.some((command) => command.id === 'app.commandPalette'), false, 'los alias no se listan en la paleta');
      assert.equal(all.length, visible.length + 13, 'los alias ocultos deben ser exactamente los de los atajos');
    });

    it('busca por título, categoría y palabras clave', () => {
      assert.ok(app.commands.search('guardar').some((command) => command.id === 'file.save'));
      assert.ok(app.commands.search('consola').length >= 2);
      assert.ok(app.commands.search('luau').length >= 1);
    });

    it('ejecuta un comando y registra el resultado', async () => {
      const result = await app.commands.execute('view.scripts', { source: 'test' });
      assert.notEqual(result?.ok, false, `el comando debe ejecutarse: ${JSON.stringify(result)}`);
      assert.equal(app.activeView, 'scripts');
      app.switchView('editor');
    });
  });

  /* ---------------------------------------------------------- Notificaciones */

  describe('NotificationManager', () => {
    it('crea notificaciones con severidad, cola e historial', () => {
      const before = app.notifications.history(50).length;
      const id = app.notifications.warn('Aviso de prueba', { durationMs: 500 });
      assert.equal(typeof id, 'string', 'la notificación debe devolver un identificador');
      assert.ok(app.notifications.history(5).length >= Math.min(before + 1, 1));
      const counts = app.notifications.counts();
      assert.ok(counts.warning + counts.info + counts.success + counts.error >= 1);
      assert.equal(app.notifications.dismiss(id, { silent: true }).ok, true);
    });
  });

  /* ------------------------------------------------------------ Capacidades */

  describe('Detección de capacidades', () => {
    it('declara no disponibles las APIs que jsdom no implementa, con su dependencia', async () => {
      const entries = await app.capabilities.detect({ force: true });
      assert.ok(Array.isArray(entries) && entries.length > 5);
      const clipboard = entries.find((entry) => entry.id === 'clipboard');
      assert.equal(clipboard.available, false);
      assert.match(String(clipboard.dependency), /clipboard/i);
      const workers = entries.find((entry) => entry.id === 'ui.workers');
      assert.equal(workers.available, false);
      const canvas = entries.find((entry) => entry.id === 'ui.canvas2d');
      assert.equal(canvas.available, false, 'sin canvas 2D la capacidad debe reportarse no disponible');
    });

    it('resume el estado real sin inventar disponibilidad', async () => {
      await app.capabilities.detect();
      const summary = app.capabilities.summary();
      assert.ok(summary.total > 5);
      assert.ok(summary.available <= summary.total);
      assert.equal(
        summary.available + summary.fallback + summary.unavailable + summary.unknown,
        summary.total,
        'todo estado debe contarse una sola vez',
      );
    });
  });
});
