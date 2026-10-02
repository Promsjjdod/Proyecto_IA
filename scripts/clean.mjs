#!/usr/bin/env node
/**
 * `npm run clean` — borra lo generado.
 *
 * Por defecto elimina la interfaz compilada (`public/build`, `public/vendor`). Con `--logs`
 * elimina también los registros, y con `--data` el directorio de datos completo (scripts,
 * ajustes, temas, historial). Nunca toca el código fuente y, sin `--yes`, pide confirmación
 * antes de borrar datos del usuario.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).filter((t) => t.startsWith('--')).map((t) => [t.slice(2), true]));

const targets = [
  { path: path.join(ROOT, 'public', 'build'), label: 'interfaz compilada (public/build)' },
  { path: path.join(ROOT, 'public', 'vendor'), label: 'artefactos vendor (public/vendor)' },
];
if (args.logs || args.data) targets.push({ path: path.join(ROOT, 'data', 'logs'), label: 'registros (data/logs)' });
if (args.data) targets.push({ path: path.join(ROOT, 'data'), label: 'datos del usuario (data/)' });

const existing = [];
for (const target of targets) {
  const stat = await fs.stat(target.path).catch(() => null);
  if (stat) existing.push({ ...target, bytes: await measure(target.path) });
}

if (existing.length === 0) {
  process.stdout.write('\n  No hay nada que borrar.\n\n');
  process.exit(0);
}

process.stdout.write('\n  Se eliminará:\n');
for (const entry of existing) {
  process.stdout.write(`    · ${entry.label.padEnd(38)} ${formatBytes(entry.bytes)}\n`);
}

const destructive = existing.some((entry) => entry.label.startsWith('datos') || entry.label.startsWith('registros'));
if (destructive && !args.yes) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('\n  Esto incluye datos guardados (scripts/ajustes/registros). ¿Continuar? [s/N] ');
  rl.close();
  if (!/^s|y$/i.test(answer.trim())) {
    process.stdout.write('\n  Cancelado. No se borró nada.\n\n');
    process.exit(0);
  }
}

let removed = 0;
const failures = [];
for (const entry of existing) {
  try {
    await fs.rm(entry.path, { recursive: true, force: true });
    removed += 1;
    process.stdout.write(`  ✔ Borrado: ${entry.label}\n`);
  } catch (err) {
    failures.push({ label: entry.label, message: err.message });
    process.stderr.write(`  ✖ No se pudo borrar ${entry.label}: ${err.message}\n`);
  }
}

process.stdout.write(`\n  ${removed}/${existing.length} elementos eliminados.\n\n`);
process.exit(failures.length > 0 ? 1 : 0);

async function measure(target) {
  const stat = await fs.stat(target).catch(() => null);
  if (!stat) return 0;
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  const entries = await fs.readdir(target, { withFileTypes: true });
  for (const entry of entries) {
    total += await measure(path.join(target, entry.name));
  }
  return total;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
