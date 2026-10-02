#!/usr/bin/env node
/**
 * `npm run build` — compila la interfaz (bundle del renderer + artefactos vendor + index.html)
 * y verifica que todos los archivos necesarios existan y no estén vacíos.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Logger } from '../src/server/core/Logger.js';
import { ErrorHandler } from '../src/server/core/ErrorHandler.js';
import { EventBus } from '../src/server/core/EventBus.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).filter((t) => t.startsWith('--')).map((t) => [t.slice(2), true]));

const bus = new EventBus({ label: 'build' });
const logger = new Logger({ directory: path.join(ROOT, 'data', 'logs'), label: 'build', mirrorToConsole: true });
const errorHandler = new ErrorHandler({ logger, bus });
await logger.openFile();

const { BuildService } = await import(pathToFileURL(path.join(ROOT, 'src/server/BuildService.js')).href);
const build = new BuildService({ logger, errorHandler, projectRoot: ROOT, publicDir: path.join(ROOT, 'public') });

const started = Date.now();
process.stdout.write('\n  Compilando Lumen Studio…\n');
const result = await build.build({ minify: args['no-minify'] !== true, sourcemap: args.sourcemap === true, watch: false });

if (!result.ok) {
  process.stderr.write(`\n  ✖ La compilación falló: ${result.error?.message ?? 'error desconocido'}\n`);
  if (result.error?.detail) process.stderr.write(`${JSON.stringify(result.error.detail, null, 2)}\n`);
  await logger.close();
  process.exit(1);
}

const verification = await build.verify();
process.stdout.write(`\n  ✔ Compilado en ${Date.now() - started} ms\n`);
for (const entry of verification.results) {
  process.stdout.write(`    ${entry.ok ? '✔' : '✖'} ${entry.name.padEnd(28)} ${formatBytes(entry.bytes)}\n`);
}
if (result.stats) {
  process.stdout.write(`    · duración del bundle: ${result.stats.durationMs ?? '—'} ms\n`);
}
await logger.close();

if (!verification.ok) {
  process.stderr.write('\n  ✖ Faltan artefactos; revisa los errores anteriores.\n\n');
  process.exit(1);
}
process.stdout.write('\n  Interfaz lista en public/\n\n');

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

void fs;
