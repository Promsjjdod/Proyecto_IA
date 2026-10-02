#!/usr/bin/env node
/**
 * `npm run doctor` — diagnóstico real del entorno.
 *
 * Arranca el contexto completo (los mismos servicios que usa la aplicación), recoge el informe
 * de diagnóstico y lo imprime de forma legible: capacidades disponibles y no disponibles con su
 * motivo, motores de ejecución, almacenamiento, analizador, plugins y errores registrados.
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = {};
for (let index = 2; index < process.argv.length; index += 1) {
  const token = process.argv[index];
  if (!token.startsWith('--')) continue;
  const next = process.argv[index + 1];
  if (next !== undefined && !next.startsWith('--')) {
    args[token.slice(2)] = Number.isFinite(Number(next)) ? Number(next) : next;
    index += 1;
  } else {
    args[token.slice(2)] = true;
  }
}

const { AppContext } = await import(pathToFileURL(path.join(ROOT, 'src/server/AppContext.js')).href);
const context = new AppContext({
  options: {
    projectRoot: ROOT,
    dataDir: args['data-dir'] ?? process.env.LUMEN_DATA_DIR ?? path.join(ROOT, 'data'),
    mirrorLogs: false,
    logLevel: 'WARNING',
  },
});

const init = await context.init({ buildIfNeeded: false, checkNetwork: args.network === true });
const diagnostics = await context.diagnostics();

const line = (label, value) => process.stdout.write(`  ${String(label).padEnd(22)} ${value}\n`);
const header = (title) => process.stdout.write(`\n  ${title}\n  ${'─'.repeat(64)}\n`);

process.stdout.write(`\n  Lumen Studio ${diagnostics.app.version} — diagnóstico\n`);

header('Entorno');
line('Node', diagnostics.health ? process.version : process.version);
line('Plataforma', `${process.platform} ${process.arch}`);
line('Directorio de datos', diagnostics.storage.root);
line('Escritura en disco', diagnostics.storage.writable ? 'sí' : `no (${diagnostics.storage.lastError?.message ?? 'motivo desconocido'})`);
line('Espacio libre', formatBytes(diagnostics.storage.freeBytes));

header('Arranque');
for (const step of init.steps) {
  line(step.name, step.ok ? `${step.ms} ms` : `✖ ${step.error?.message ?? 'falló'}`);
}

header('Capacidades');
const entries = diagnostics.capabilities.entries;
const available = entries.filter((entry) => entry.available);
const unavailable = entries.filter((entry) => !entry.available);
line('Disponibles', `${available.length} de ${entries.length}`);
for (const entry of available) line(`  ✔ ${entry.id}`, truncate(entry.detail, 70));
for (const entry of unavailable) line(`  ✖ ${entry.id}`, truncate(entry.detail ?? 'sin detalle', 70));
line('Resumen', JSON.stringify(diagnostics.capabilities.summary));

header('Ejecución y análisis');
for (const engine of diagnostics.engines) {
  line(engine.id, engine.available
    ? `disponible · ${engine.isolation ?? engine.scope ?? '—'}${engine.active > 0 ? ` · ${engine.active} en curso` : ''}`
    : `no disponible · ${truncate(engine.detail ?? '', 50)}`);
}
line('Analizador Luau', `${diagnostics.analysis.checks ?? 0} análisis realizados${diagnostics.analysis.available === false ? ' (no disponible)' : ''}`);

header('Datos y errores');
line('Scripts', `${diagnostics.health.scripts}`);
line('Plugins', `${diagnostics.plugins.total} detectados · ${diagnostics.plugins.enabled} activos`);
line('Errores (incidentes)', `${diagnostics.errors.total}${diagnostics.errors.last ? ` · último: ${truncate(diagnostics.errors.last.message, 44)}` : ''}`);
line('Rutas API', `${diagnostics.api.routes}`);

await context.shutdown({ reason: 'doctor' });

const failing = stepsFailed(init.steps);
process.stdout.write('\n');
if (failing.length > 0) {
  process.stdout.write(`  Resultado: ${failing.length} paso(s) con problemas: ${failing.join(', ')}\n\n`);
  process.exit(1);
}
process.stdout.write('  Resultado: el entorno está operativo.\n\n');
process.exit(0);

function stepsFailed(steps) {
  return steps.filter((step) => !step.ok).map((step) => step.name);
}

function truncate(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
