#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv.includes('--yes')) {
  console.error('This DELETES the local ForgeAI database (chats, agents, settings).');
  console.error('Re-run with --yes to confirm:  npm run db:reset -- --yes');
  process.exit(1);
}
const dbPath = process.env.FORGEAI_DB_PATH || 'data/forgeai.db';
const abs = path.isAbsolute(dbPath) ? dbPath : path.join(ROOT, dbPath);
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  fs.rmSync(abs + suffix, { force: true });
}
console.log(`Removed ${abs}. Run npm run migrate to recreate.`);
