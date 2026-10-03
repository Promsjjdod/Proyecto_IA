#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { runMigrations } = await import(path.join(ROOT, 'backend', 'src', 'database', 'migrate.js'));
const { seed } = await import(path.join(ROOT, 'backend', 'src', 'database', 'seed.js'));
const { syncPlugins } = await import(path.join(ROOT, 'backend', 'src', 'plugins', 'manager.js'));
const result = runMigrations();
seed();
syncPlugins();
console.log(result.applied.length ? `Applied migrations: ${result.applied.join(', ')}` : 'Database already up to date.');
console.log('Seed + plugin sync complete.');
