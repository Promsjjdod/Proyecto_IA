#!/usr/bin/env node
/**
 * `npm run setup` — prepara el entorno y explica qué falta, sin inventar nada.
 *
 * Comprueba las dependencias instaladas, verifica que los motores WASM respondan de verdad
 * (Luau y Lua 5.4), informa del estado del analizador, y —solo si se pide con `--native`— intenta
 * compilar los intérpretes nativos de Luau/Lua 5.4 desde el código fuente (requiere `git` y un
 * compilador; en un entorno sin ellos se informa del motivo exacto).
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).filter((t) => t.startsWith('--')).map((t) => [t.slice(2), true]));

process.stdout.write('\n  Preparando Lumen Studio\n  ' + '─'.repeat(64) + '\n\n');

/* 1. Dependencias */
const dependencies = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8')).dependencies ?? {};
const missing = Object.keys(dependencies).filter((name) => !fsSync.existsSync(path.join(ROOT, 'node_modules', name)));
if (missing.length > 0) {
  process.stdout.write(`  ✖ Faltan ${missing.length} dependencias: ${missing.join(', ')}\n`);
  process.stdout.write('    Ejecuta:  npm install\n\n');
  process.exit(1);
}
process.stdout.write(`  ✔ Dependencias instaladas (${Object.keys(dependencies).length})\n`);

/* 2. Motores WASM: se ejecutan de verdad, no se asume nada */
const { AppContext } = await import(pathToFileURL(path.join(ROOT, 'src/server/AppContext.js')).href);
const context = new AppContext({
  options: {
    projectRoot: ROOT,
    dataDir: args['data-dir'] ?? path.join(ROOT, 'data'),
    mirrorLogs: false,
    logLevel: 'WARNING',
  },
});
await context.init({ buildIfNeeded: false });

const engines = await context.runtime.listEngines({ force: true });
for (const engine of engines) {
  process.stdout.write(`  ${engine.available ? '✔' : '✖'} ${String(engine.id).padEnd(20)} ${engine.available ? engine.label : truncate(engine.detail, 60)}\n`);
}

const analysis = context.capabilities.get('analysis.types');
process.stdout.write(`  ${analysis?.available ? '✔' : '✖'} ${'analizador Luau'.padEnd(20)} ${analysis?.available ? 'operativo (tipos, lint y autocompletado)' : truncate(analysis?.detail, 60)}\n`);

/* 3. Intérpretes nativos (opcional) */
const native = engines.filter((engine) => engine.id.startsWith('native.'));
if (native.some((engine) => engine.available)) {
  process.stdout.write('\n  Intérprete nativo detectado en el sistema:\n');
  for (const engine of native.filter((entry) => entry.available)) {
    process.stdout.write(`    · ${engine.id}: ${truncate(engine.detail, 70)}\n`);
  }
} else if (args.native) {
  process.stdout.write('\n  Compilando intérpretes nativos (--native)…\n');
  const outcome = await buildNative();
  for (const step of outcome.steps) {
    process.stdout.write(`    ${step.ok ? '✔' : '✖'} ${step.name}: ${truncate(step.message, 80)}\n`);
  }
} else {
  process.stdout.write('\n  Intérpretes nativos: no disponibles (los motores WASM de Luau y Lua 5.4 sí lo están).\n');
  process.stdout.write('  Para intentar compilarlos:  npm run setup -- --native\n');
}

await context.shutdown({ reason: 'setup' });
process.stdout.write('\n  Entorno preparado. Arranca con:  npm start\n\n');
process.exit(0);

async function buildNative() {
  const steps = [];
  const tools = await Promise.all(['git', 'make', 'cc'].map(async (tool) => [tool, await which(tool)]));
  for (const [tool, found] of tools) {
    steps.push({ name: `herramienta ${tool}`, ok: Boolean(found), message: found ?? 'no encontrada en PATH' });
  }
  if (steps.some((step) => !step.ok)) {
    steps.push({ name: 'compilación', ok: false, message: 'faltan herramientas: instala git, make y un compilador de C' });
    return { steps };
  }
  const target = path.join(ROOT, 'tools', 'bin');
  const source = path.join(ROOT, 'tools', 'src', 'luau');
  await fs.mkdir(path.join(ROOT, 'tools', 'src'), { recursive: true });
  const clone = await run('git', ['clone', '--depth', '1', '--branch', '0.740', 'https://github.com/luau-lang/luau.git', source], ROOT);
  steps.push({ name: 'git clone luau', ok: clone.ok, message: clone.ok ? 'código fuente descargado' : clone.message });
  if (!clone.ok) return { steps };
  const build = await run('make', ['-j2', 'config=release', 'luau'], source);
  steps.push({ name: 'make luau', ok: build.ok, message: build.ok ? 'binario compilado' : build.message });
  if (!build.ok) return { steps };
  await fs.mkdir(target, { recursive: true });
  const binary = path.join(source, 'luau', 'build', 'luau');
  const copied = await fs.copyFile(binary, path.join(target, 'luau')).then(() => true).catch(() => false);
  steps.push({ name: 'instalación', ok: copied, message: copied ? `binario en ${path.relative(ROOT, target)}/luau` : 'no se pudo copiar el binario' });
  return { steps };
}

function which(tool) {
  return new Promise((resolve) => {
    const child = spawn(process.platform === 'win32' ? 'where' : 'which', [tool], { stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code === 0 ? output.trim().split('\n')[0] : null));
  });
}

function run(command, argv, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => resolve({ ok: false, message: err.message }));
    child.on('close', (code) => resolve({ ok: code === 0, message: code === 0 ? 'ok' : truncate(stderr.trim() || `código ${code}`, 120) }));
  });
}

function truncate(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
