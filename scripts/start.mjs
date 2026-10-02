#!/usr/bin/env node
/**
 * `npm start` — arranca Lumen Studio.
 *
 * Comprueba el entorno (versión de Node y dependencias instaladas), arranca el servidor real
 * (`src/server/index.js`), muestra el informe de arranque y se queda en primer plano atendiendo
 * la interfaz, la API y el stream de eventos. Ctrl+C cierra de forma ordenada.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      const numeric = Number(next);
      args[key] = Number.isFinite(numeric) && String(numeric) === next ? numeric : next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function fail(message, detail = null) {
  process.stderr.write(`\n  ✖ ${message}\n`);
  if (detail) process.stderr.write(`${detail}\n`);
  process.stderr.write('\n');
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));

// 1. Node lo bastante nuevo para node:fs/promises, worker_threads y fetch.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 20 || (major === 20 && minor < 10)) {
  fail(
    `Se necesita Node 20.10 o superior (tienes ${process.version}).`,
    '  Descarga una versión actual en https://nodejs.org/ (LTS) y vuelve a intentarlo.',
  );
}

// 2. Dependencias realmente instaladas (no se asume nada).
const required = ['codemirror', '@codemirror/view', '@luau-rs/luau', 'wasmoon', 'esbuild'];
const missing = required.filter((name) => !fs.existsSync(path.join(ROOT, 'node_modules', name)));
if (missing.length > 0) {
  fail(
    `Faltan dependencias: ${missing.join(', ')}`,
    `  Instálalas con:\n\n    cd "${ROOT}"\n    npm install\n`,
  );
}

const { startServer } = await import(pathToFileURL(path.join(ROOT, 'src/server/index.js')).href);

const port = args.port ?? Number(process.env.LUMEN_PORT ?? 4173);
const host = args.host ?? process.env.LUMEN_HOST ?? '0.0.0.0';
const dataDir = args['data-dir'] ?? process.env.LUMEN_DATA_DIR ?? path.join(ROOT, 'data');

let instance;
try {
  instance = await startServer({
    host,
    port,
    dataDir: path.resolve(dataDir),
    build: args['no-build'] !== true,
    watch: args.watch === true,
    logLevel: args.verbose === true ? 'TRACE' : 'INFO',
  });
} catch (err) {
  const detail = err?.detail ? JSON.stringify(err.detail, null, 2) : null;
  if (err?.detail?.errno === 'EADDRINUSE') {
    fail(
      `El puerto ${port} ya está en uso.`,
      `  Prueba con otro puerto:\n\n    npm start -- --port ${Number(port) + 1}\n`,
    );
  }
  fail(err?.message ?? String(err), detail);
}

const { context, address, initReport, close } = instance;
const url = `http://localhost:${address.port}/`;
process.stdout.write('\n  La interfaz está disponible en ' + url + '\n');
process.stdout.write('  (la primera carga compila la interfaz; el servidor ya está escuchando)\n\n');

const steps = initReport?.steps ?? [];
const failedSteps = steps.filter((step) => !step.ok);
if (failedSteps.length > 0) {
  process.stdout.write('  Pasos de arranque con problemas:\n');
  for (const step of failedSteps) {
    process.stdout.write(`    · ${step.name}: ${step.error?.message ?? 'error'}\n`);
  }
  process.stdout.write('\n');
}

let closing = false;
const shutdown = async (signal) => {
  if (closing) return;
  closing = true;
  process.stdout.write(`\n  Cerrando (${signal})…\n`);
  try {
    await close();
  } catch (err) {
    process.stderr.write(`  Aviso: ${err.message}\n`);
  }
  process.stdout.write('  Cerrado.\n');
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

void context;
