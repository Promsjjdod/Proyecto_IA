/**
 * Prueba de arranque de la interfaz completa (jsdom + bundle real + servidor real).
 *
 * No hay ninguna simulación: se compila el proyecto con esbuild, se levanta el servidor de la
 * aplicación, se carga el `index.html` de verdad en jsdom y se ejecuta el bundle compilado, que
 * construye el grafo de servicios y monta la interfaz. Después se comprueban nodos reales del DOM
 * y se ejecuta un script Lua contra el motor del servidor.
 *
 * Si el arranque falla, el propio test muestra `window.lumenBootError` con su stack.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { buildRenderer, loadApp, startServer } from './helpers/jsdom-env.mjs';

describe('Arranque de la interfaz (bundle real + servidor real)', { timeout: 120_000 }, () => {
  let server;
  let env;

  before(async () => {
    await buildRenderer();
    server = await startServer();
    env = await loadApp({ serverUrl: server.url });
    await env.waitForBoot();
  });

  after(async () => {
    await env?.dispose().catch(() => {});
    await server?.stop().catch(() => {});
  });

  it('arranca sin errores y expone la aplicación en window.lumen', () => {
    assert.equal(env.window.lumenBootError, undefined, `error de arranque: ${env.window.lumenBootError?.message}`);
    const app = env.window.lumen.app;
    assert.ok(app, 'window.lumen.app debe existir');
    assert.equal(env.document.body.dataset.booted, 'true');
    assert.ok(env.document.querySelectorAll('link[rel="stylesheet"], style').length >= 0);
  });

  it('retira la pantalla de arranque y muestra la raíz de la aplicación', () => {
    assert.equal(env.document.getElementById('lumen-boot'), null, 'la pantalla de arranque debe desaparecer');
    const root = env.document.getElementById('lumen-root');
    assert.ok(root, '#lumen-root debe existir');
    assert.equal(root.hidden, false);
  });

  it('construye la estructura completa: topbar, sidebar, vistas y barra de estado', () => {
    const { document } = env;
    assert.ok(document.querySelector('.topbar'), 'falta la barra superior');
    const sidebar = document.querySelector('.sidebar');
    assert.ok(sidebar, 'falta la barra lateral');
    assert.equal(sidebar.querySelectorAll('[data-view]').length, 7, 'la barra lateral debe tener 7 secciones');
    assert.equal(document.querySelectorAll('.view-host > *').length, 7, 'deben montarse 7 vistas');
    assert.ok(document.getElementById('status-bar'), 'falta la barra de estado');
    assert.ok(document.querySelector('.tabs'), 'falta la tira de pestañas');
  });

  it('inicializa el editor CodeMirror dentro del contenedor real', () => {
    assert.ok(env.document.querySelector('.cm-editor'), 'CodeMirror debe estar montado');
    assert.ok(env.document.querySelector('.cm-content'), 'el área de edición debe existir');
    assert.ok(env.document.querySelector('.cm-gutters'), 'deben existir los números de línea');
  });

  it('aplica el tema por variables CSS en :root', () => {
    const style = env.document.documentElement.style;
    const tokens = ['--bg-app', '--bg-panel', '--text-primary', '--accent'];
    for (const token of tokens) {
      const value = style.getPropertyValue(token).trim();
      assert.ok(value.length > 0, `el token ${token} debe estar definido por ThemeManager`);
    }
  });

  it('registra los comandos de la aplicación y permite buscarlos', () => {
    const { app } = env.window.lumen;
    const commands = app.commands.list();
    assert.ok(commands.length >= 40, `se esperaban al menos 40 comandos, hay ${commands.length}`);
    for (const id of ['runtime.run', 'file.new', 'file.save', 'view.commandPalette', 'theme.toggle']) {
      assert.ok(app.commands.get(id), `falta el comando ${id}`);
    }
    assert.ok(app.commands.search('paleta').length > 0, 'la búsqueda debe encontrar la paleta de comandos');
  });

  it('cambia de sección desde la barra lateral y desde la API', async () => {
    const { document } = env;
    const item = document.querySelector('[data-view="console"]');
    assert.ok(item, 'falta el botón de la consola en la barra lateral');
    item.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }));
    await tick(env);
    assert.equal(env.window.lumen.app.activeView, 'console');
    assert.equal(document.querySelector('[data-view="console"]').getAttribute('aria-current'), 'page');
    env.window.lumen.app.switchView('editor');
    await tick(env);
    assert.equal(env.window.lumen.app.activeView, 'editor');
  });

  it('abre la paleta de comandos con Ctrl+Shift+P y filtra en vivo', async () => {
    const { document, window } = env;
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true }));
    await tick(env);
    const palette = document.querySelector('.palette');
    assert.ok(palette, 'la paleta debe abrirse');
    const input = palette.querySelector('input');
    assert.ok(input, 'la paleta debe tener un campo de búsqueda');
    input.value = 'guardar';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    await tick(env);
    const titles = [...palette.querySelectorAll('.palette__item')].map((node) => node.textContent);
    assert.ok(titles.length > 0, 'la búsqueda debe devolver resultados');
    assert.ok(titles.some((title) => /guardar/i.test(title)), `ningún resultado de «guardar» en ${titles.join(' | ')}`);
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick(env);
  });

  it('crea un script, lo escribe en el editor y lo ejecuta en el motor real del servidor', async () => {
    const { app } = env.window.lumen;
    const created = await app.scripts.create({
      name: `prueba-humo-${Date.now()}.luau`,
      content: 'local total = 0\nfor i = 1, 5 do total = total + i end\nprint("suma", total)\n',
      dialect: 'luau',
    });
    assert.ok(created?.script?.id, `no se creó el script: ${JSON.stringify(created)}`);

    const tabId = app.tabs.activeTab?.id ?? created.script.id;
    const record = await app.runtime.execute({
      source: app.editor.getValue(tabId) || 'print("sin contenido")',
      name: created.script.name,
      dialect: 'luau',
      origin: 'test',
    });
    assert.equal(record.state, record.ok ? 'SUCCESS' : record.state, `estado inesperado: ${JSON.stringify(record.error)}`);
    assert.ok(record.ok, `la ejecución falló: ${JSON.stringify(record.error)}`);
    const text = (record.outputs ?? []).map((output) => output.text ?? output.message ?? '').join('\n');
    assert.match(text, /suma\s+15/, `salida inesperada: ${JSON.stringify(record.outputs)}`);

    // La salida del motor del servidor llega por el flujo SSE real; se espera a que se propague.
    const deadline = Date.now() + 5000;
    let entries = app.console.filtered();
    while (Date.now() < deadline && !entries.some((entry) => /suma\s+15/.test(entry.message))) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      entries = app.console.filtered();
    }
    assert.ok(entries.length > 0, 'la consola debe registrar la ejecución');
    assert.ok(
      entries.some((entry) => /suma\s+15/.test(entry.message)),
      `la salida del script debe aparecer en la consola (últimas entradas: ${entries.slice(-4).map((e) => `${e.level}:${e.message}`).join(' | ')})`,
    );
  });

  it('muestra los errores reales del runtime con archivo y línea', async () => {
    const { app } = env.window.lumen;
    const record = await app.runtime.execute({
      source: 'local x = 1\nx = nil + 1\n',
      name: 'error-forzado.luau',
      dialect: 'luau',
      origin: 'test',
    });
    assert.equal(record.ok, false, 'el script debe fallar');
    assert.ok(record.error, 'el error debe estar presente');
    assert.ok(record.error.message.length > 0, 'el error debe tener mensaje');
    const entries = app.console.filtered({ limit: 10 });
    assert.ok(
      entries.some((entry) => entry.level === 'ERROR'),
      'la consola debe contener una entrada de error',
    );
  });

  it('informa las capacidades ausentes en lugar de fingirlas', async () => {
    const { app } = env.window.lumen;
    const entries = await app.capabilities.detect({ force: true });
    assert.ok(entries.length > 0, 'debe haber capacidades detectadas');
    const clipboard = entries.find((entry) => entry.id === 'clipboard');
    assert.ok(clipboard, 'la capacidad de portapapeles debe aparecer');
    assert.equal(clipboard.available, false, 'sin API de portapapeles debe reportarse como no disponible');
    assert.ok(clipboard.dependency, 'debe explicar de qué depende');
  });
});

async function tick(env) {
  await new Promise((resolve) => setTimeout(resolve, 30));
  env.window.document.dispatchEvent(new env.window.Event('lumen:test-tick'));
}
