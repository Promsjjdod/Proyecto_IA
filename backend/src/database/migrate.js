import fs from 'node:fs';
import path from 'node:path';
import { sqlite } from './index.js';
import { config } from '../config/env.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('migrate');

const MIGRATIONS_DIR = path.join(config.dataDir, '..', 'database', 'migrations');

export function pendingMigrations() {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS forge_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at INTEGER NOT NULL
  )`);
  const applied = new Set(
    sqlite.prepare('SELECT name FROM forge_migrations').all().map((r) => r.name),
  );
  const files = fs.existsSync(MIGRATIONS_DIR)
    ? fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
    : [];
  return files.filter((f) => !applied.has(f));
}

export function runMigrations() {
  const pending = pendingMigrations();
  if (pending.length === 0) {
    log.debug('database up to date');
    return { applied: [] };
  }
  const applied = [];
  for (const file of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    log.info(`applying migration ${file}`);
    const run = sqlite.transaction(() => {
      sqlite.exec(sql);
      sqlite.prepare('INSERT INTO forge_migrations (name, applied_at) VALUES (?, ?)').run(file, Date.now());
    });
    run();
    applied.push(file);
  }
  return { applied };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv.includes('--run')) {
  const { applied } = runMigrations();
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database already up to date.');
}
