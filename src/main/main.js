#!/usr/bin/env node
/**
 * Lumen Studio — capa de escritorio (Electron, opcional).
 *
 * Arranca el mismo servidor que usa la versión de navegador (no hay una segunda implementación)
 * y abre una ventana que carga la interfaz desde `http://localhost:<puerto>`. El proceso de
 * renderer no recibe privilegios de Node: la única comunicación extra es la API de ventana
 * expuesta por `preload.js` (minimizar, maximizar, cerrar, estado y geometría).
 *
 * Si Electron no está instalado, este archivo lo dice con claridad y termina con código 1 en
 * lugar de fallar con una excepción confusa.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

let electron;
try {
  electron = await import('electron');
} catch (err) {
  process.stderr.write(
    '\n  ✖ Electron no está instalado.\n'
    + '    La aplicación funciona igualmente en el navegador:  npm start\n'
    + `    Para instalarlo:  npm install electron --save-optional   (detalle: ${err.message})\n\n`,
  );
  process.exit(1);
}

const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = electron;
const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? process.env.LUMEN_PORT ?? 4173);
const geometryFile = path.join(ROOT, 'data', 'meta', 'window.json');

/** Geometría recordada: se lee tal cual está en disco y se valida antes de usarla. */
function loadGeometry() {
  try {
    const raw = JSON.parse(fs.readFileSync(geometryFile, 'utf8'));
    const { x, y, width, height, maximized } = raw ?? {};
    const valid = [x, y, width, height].every((value) => value === undefined || Number.isFinite(value));
    if (!valid || typeof width !== 'number' || typeof height !== 'number') return null;
    return { x, y, width: Math.max(640, width), height: Math.max(420, height), maximized: maximized === true };
  } catch {
    return null;
  }
}

function saveGeometry(window) {
  try {
    fs.mkdirSync(path.dirname(geometryFile), { recursive: true });
    const bounds = window.isMaximized() ? window.getNormalBounds() : window.getBounds();
    const payload = { ...bounds, maximized: window.isMaximized(), savedAt: Date.now() };
    fs.writeFileSync(geometryFile, JSON.stringify(payload, null, 2), 'utf8');
    return { ok: true, path: geometryFile };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

let instance = null;
let mainWindow = null;

async function createWindow() {
  instance = await startServer({
    host: '127.0.0.1',
    port,
    dataDir: path.join(ROOT, 'data'),
    build: true,
    logLevel: 'INFO',
  });

  const geometry = loadGeometry();
  mainWindow = new BrowserWindow({
    width: geometry?.width ?? 1360,
    height: geometry?.height ?? 860,
    x: geometry?.x,
    y: geometry?.y,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0e1116' : '#f4f6f9',
    show: false,
    title: 'Lumen Studio',
    webPreferences: {
      preload: path.join(HERE, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  if (geometry?.maximized) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow.show());

  const url = `http://127.0.0.1:${port}/`;
  await mainWindow.loadURL(url);

  // Los enlaces externos se abren en el navegador del sistema, nunca dentro de la app.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target);
    return { action: 'deny' };
  });

  const report = () => {
    const result = saveGeometry(mainWindow);
    if (!result.ok) {
      // No se oculta: se informa por consola y por el registro del servidor.
      instance?.context?.logger?.warn(`No se pudo guardar la geometría de la ventana: ${result.error}`, { source: 'electron' });
    }
  };
  mainWindow.on('close', report);
  mainWindow.on('resize', debounce(report, 500));
  mainWindow.on('move', debounce(report, 500));

  return { url, window: mainWindow };
}

app.whenReady().then(async () => {
  try {
    await createWindow();
  } catch (err) {
    process.stderr.write(`\n  ✖ No se pudo iniciar la ventana: ${err.message}\n\n`);
    await instance?.close?.();
    app.exit(1);
  }
});

app.on('window-all-closed', async () => {
  await instance?.close?.();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) await createWindow();
});

/* ------------------------------------------------------------------ *
 * API de ventana (única superficie expuesta al renderer)
 * ------------------------------------------------------------------ */

ipcMain.handle('lumen:window:state', () => {
  if (!mainWindow) return null;
  const bounds = mainWindow.isMaximized() ? mainWindow.getNormalBounds() : mainWindow.getBounds();
  return {
    minimized: mainWindow.isMinimized(),
    maximized: mainWindow.isMaximized(),
    fullScreen: mainWindow.isFullScreen(),
    focused: mainWindow.isFocused(),
    bounds,
    maximizable: mainWindow.isMaximizable(),
    minimizable: mainWindow.isMinimizable(),
    resizable: mainWindow.isResizable(),
    platform: process.platform,
    version: app.getVersion(),
  };
});

ipcMain.handle('lumen:window:action', (_event, action) => {
  if (!mainWindow) return { ok: false, reason: 'no-window' };
  switch (action) {
    case 'minimize':
      if (!mainWindow.isMinimizable()) return { ok: false, reason: 'not-minimizable' };
      mainWindow.minimize();
      return { ok: true };
    case 'maximize':
      if (!mainWindow.isMaximizable()) return { ok: false, reason: 'not-maximizable' };
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
      return { ok: true, maximized: mainWindow.isMaximized() };
    case 'close':
      mainWindow.close();
      return { ok: true };
    case 'toggle-fullscreen':
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      return { ok: true, fullScreen: mainWindow.isFullScreen() };
    case 'center':
      mainWindow.center();
      return { ok: true };
    case 'reset-geometry':
      mainWindow.setBounds({ width: 1360, height: 860 });
      mainWindow.center();
      return { ok: true, ...saveGeometry(mainWindow) };
    default:
      return { ok: false, reason: `acción desconocida: ${action}` };
  }
});

ipcMain.handle('lumen:dialog:message', async (_event, options = {}) => {
  if (!mainWindow) return { response: -1 };
  const result = await dialog.showMessageBox(mainWindow, {
    type: options.type ?? 'question',
    title: options.title ?? 'Lumen Studio',
    message: String(options.message ?? ''),
    detail: options.detail ? String(options.detail) : undefined,
    buttons: Array.isArray(options.buttons) && options.buttons.length > 0 ? options.buttons.slice(0, 3).map(String) : ['Aceptar'],
    defaultId: Number.isInteger(options.defaultId) ? options.defaultId : 0,
    cancelId: Number.isInteger(options.cancelId) ? options.cancelId : -1,
    noLink: true,
  });
  return { response: result.response };
});

ipcMain.handle('lumen:path:forFile', (_event, name) => {
  try {
    const documents = app.getPath('documents');
    return { ok: true, path: path.join(documents, safeName(name ?? 'script.luau')) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

function safeName(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      args[token.slice(2)] = Number.isFinite(Number(next)) ? Number(next) : next;
      index += 1;
    } else {
      args[token.slice(2)] = true;
    }
  }
  return args;
}

function debounce(fn, ms) {
  let timer = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}
