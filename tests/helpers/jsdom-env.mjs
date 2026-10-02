/**
 * Entorno DOM real (jsdom) para probar la interfaz sin navegador.
 *
 * jsdom implementa lo suficiente para ejecutar CodeMirror 6 y el propio *shell* de la aplicación:
 * nodos, eventos, `MutationObserver`, medición (con rectángulos a cero) y temporizadores. Lo que
 * jsdom no trae —`matchMedia`, `ResizeObserver`, `IntersectionObserver`, `Worker`, portapapeles,
 * `scrollTo`— se declara aquí explícitamente, porque la aplicación debe detectarlos como
 * capacidades ausentes (y lo prueba `tests/ui.capabilities.test.mjs`), no fingir que existen.
 *
 * `fetch` se reescribe para resolver las rutas relativas (`/api/...`) contra el servidor local en
 * marcha, que es exactamente lo que hace el navegador con el servidor de la aplicación.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

/** Ejecuta el build una vez y devuelve las rutas de los artefactos. */
export async function buildRenderer({ force = false } = {}) {
  const appJs = path.join(REPO_ROOT, 'public', 'build', 'app.js');
  const appCss = path.join(REPO_ROOT, 'public', 'build', 'app.css');
  if (force || !(await exists(appJs))) {
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(process.execPath, ['scripts/build.mjs'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new Error(`El build falló (código ${result.status}):\n${result.stdout}\n${result.stderr}`);
    }
  }
  return { appJs, appCss, indexHtml: path.join(REPO_ROOT, 'public', 'index.html') };
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** Puerto libre elegido por el sistema operativo. */
export async function freePort() {
  const { createServer } = await import('node:net');
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Levanta el servidor real de Lumen Studio y espera a que `/api/health` responda.
 * Devuelve `{ port, url, dataDir, stop() }`.
 */
export async function startServer({ timeoutMs = 30_000 } = {}) {
  const { spawn } = await import('node:child_process');
  const port = await freePort();
  const dataDir = await fs.mkdtemp(path.join((await import('node:os')).tmpdir(), 'lumen-test-'));
  const child = spawn(
    process.execPath,
    ['scripts/start.mjs', '--port', String(port), '--data-dir', dataDir, '--no-open'],
    { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LUMEN_DATA_DIR: dataDir } },
  );
  const logs = [];
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => logs.push(chunk));
  child.stderr.on('data', (chunk) => logs.push(chunk));

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`El servidor terminó con código ${child.exitCode}:\n${logs.join('')}`);
    }
    try {
      const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        return {
          port,
          url,
          dataDir,
          logs,
          async stop() {
            if (child.exitCode === null) {
              child.kill('SIGTERM');
              await new Promise((resolve) => {
                const timer = setTimeout(() => {
                  child.kill('SIGKILL');
                  resolve();
                }, 4000);
                child.once('exit', () => {
                  clearTimeout(timer);
                  resolve();
                });
              });
            }
            await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
          },
        };
      }
      lastError = `HTTP ${response.status}`;
    } catch (err) {
      lastError = err.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill('SIGKILL');
  throw new Error(`El servidor no respondió en ${timeoutMs} ms (último error: ${lastError})\n${logs.join('')}`);
}

/** Stubs mínimos y honestos para lo que jsdom no implementa. */
function installMissingApis(window) {
  const absent = [];
  const stub = (name, factory) => {
    absent.push(name);
    return factory();
  };

  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    });
  }
  if (typeof window.ResizeObserver !== 'function') {
    window.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (typeof window.IntersectionObserver !== 'function') {
    window.IntersectionObserver = class IntersectionObserver {
      constructor() {
        this.root = null;
        this.rootMargin = '0px';
        this.thresholds = [];
      }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    };
  }
  // jsdom no implementa el portapapeles: se declara ausente a propósito para que la aplicación lo
  // detecte como capacidad no disponible en lugar de fallar al pulsar «Copiar».
  if (!window.navigator.clipboard) {
    Object.defineProperty(window.navigator, 'clipboard', { value: undefined, configurable: true });
    absent.push('clipboard');
  }
  if (typeof window.requestIdleCallback !== 'function') {
    window.requestIdleCallback = (callback) => window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 5 }), 1);
    window.cancelIdleCallback = (handle) => window.clearTimeout(handle);
  }
  // jsdom implementa la medición en Element pero no en nodos de texto ni en Range; CodeMirror usa
  // ambas rutas al calcular coordenadas. Se completan con rectángulos vacíos (el DOM del test no
  // tiene tamaño real, así que no se falsea ninguna medida).
  const emptyRectList = () => Object.assign([], { item: () => null });
  const emptyRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() { return {}; } });
  if (typeof window.Range.prototype.getClientRects !== 'function') {
    window.Range.prototype.getClientRects = emptyRectList;
    window.Range.prototype.getBoundingClientRect = emptyRect;
  }
  if (typeof window.Text.prototype.getClientRects !== 'function') {
    window.Text.prototype.getClientRects = emptyRectList;
    window.Text.prototype.getBoundingClientRect = emptyRect;
  }
  window.scrollTo = window.scrollTo ?? (() => {});
  window.HTMLElement.prototype.scrollTo = window.HTMLElement.prototype.scrollTo ?? function scrollTo() {};
  if (!stub.ignore) {
    // Deja constancia de la ausencia real de Worker (los motores de navegador deben reportarlo).
    absent.push('Worker');
  }
  return absent;
}

/**
 * Crea el DOM a partir del `index.html` real, instala los globales y ejecuta el bundle compilado.
 * Devuelve `{ dom, window, document, absentApis, waitForBoot(), evaluate(), dispose() }`.
 */
export async function loadApp({ serverUrl, bundlePath, timeoutMs = 40_000 } = {}) {
  const { appJs } = await buildRenderer();
  const html = await fs.readFile(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: serverUrl ? `${serverUrl}/` : 'http://localhost/',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const { window } = dom;
  const absentApis = installMissingApis(window);

  /*
   * Sólo se toman de jsdom los globales del DOM. Los que Node ya implementa nativamente
   * (`fetch`, `Blob`, `URL`, `performance`, `crypto`, `AbortSignal`…) se conservan: sustituirlos
   * por los de jsdom rompería la interoperabilidad con `fetch` de undici y, en el caso de
   * `performance`, provocaría recursión infinita (la implementación de jsdom delega en el global).
   */
  const globals = [
    'window', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage',
    'HTMLElement', 'HTMLDivElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLButtonElement',
    'HTMLAnchorElement', 'HTMLCanvasElement', 'HTMLSelectElement', 'HTMLOptionElement',
    'Element', 'Node', 'NodeList', 'DocumentFragment', 'Event', 'CustomEvent',
    'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'FocusEvent', 'DragEvent', 'InputEvent',
    'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'DOMParser', 'XMLSerializer',
    'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'CSS',
    // Clases que CodeMirror consulta por nombre global (`instanceof Window`, etc.).
    'Window', 'HTMLDocument', 'HTMLSpanElement', 'HTMLUListElement', 'HTMLLIElement',
    'HTMLTableElement', 'HTMLTableRowElement', 'HTMLTableCellElement', 'HTMLDivElement',
    'Selection', 'Range', 'Text', 'Comment',
  ];
  const saved = new Map();
  for (const key of globals) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === 'window' ? window : window[key];
    if (value === undefined) continue;
    try {
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    } catch {
      /* algunos globales de Node son sólo lectura; se conservan */
    }
  }

  // Las rutas relativas se resuelven contra el servidor real, como haría el navegador.
  const realFetch = globalThis.fetch;
  const fetchCalls = [];
  globalThis.fetch = (input, init) => {
    if (typeof input === 'string' && input.startsWith('/')) {
      const url = `${serverUrl}${input}`;
      fetchCalls.push({ method: init?.method ?? 'GET', url });
      return realFetch(url, init);
    }
    if (input instanceof URL) return realFetch(input, init);
    fetchCalls.push({ method: init?.method ?? 'GET', url: String(input) });
    return realFetch(input, init);
  };
  if (window !== globalThis.window) window.fetch = globalThis.fetch;

  let bundleError = null;
  try {
    await import(`${pathToFileURL(bundlePath ?? appJs).href}?t=${Date.now()}`);
  } catch (err) {
    bundleError = err;
  }

  const waitForBoot = async () => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (window.lumen) return window.lumen;
      if (window.lumenBootError) {
        const error = new Error(`Arranque fallido: ${window.lumenBootError.message}`);
        error.bootError = window.lumenBootError;
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(bundleError ? `El bundle no se ejecutó: ${bundleError.message}` : 'La aplicación no terminó de arrancar');
  };

  return {
    dom,
    window,
    document: window.document,
    absentApis,
    fetchCalls,
    bundleError,
    waitForBoot,
    async evaluate(code) {
      const fn = new Function('window', 'document', `return (async () => { ${code} })()`);
      return await fn(window, window.document);
    },
    async dispose() {
      try {
        await window.lumen?.app?.dispose?.();
      } catch {
        /* el apagado no debe enmascarar el resultado del test */
      }
      globalThis.fetch = realFetch;
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
      dom.window.close();
    },
  };
}
