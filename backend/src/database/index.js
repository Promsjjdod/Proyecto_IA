import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { config } from '../config/env.js';
import { schema } from './schema.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('db');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const sqlite = new Database(config.dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');

export const db = drizzle(sqlite, { schema });

export function nowMs() {
  return Date.now();
}

export function tx(fn) {
  return sqlite.transaction(fn)();
}

export function databaseStatus() {
  try {
    const row = sqlite.prepare('SELECT COUNT(*) AS n FROM settings').get();
    const file = fs.existsSync(config.dbPath) ? fs.statSync(config.dbPath).size : 0;
    return { connected: true, path: config.dbPath, sizeBytes: file, rowsSettings: row.n };
  } catch (err) {
    log.error('database status check failed', { error: err.message });
    return { connected: false, path: config.dbPath, error: err.message };
  }
}

export { schema };
