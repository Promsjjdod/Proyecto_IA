#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
console.log('\n== Backend tests ==\n');
const backend = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'tests/**/*.test.js'], { cwd: path.join(ROOT, 'backend'), stdio: 'inherit' });
console.log('\n== Frontend typecheck ==\n');
const frontend = spawnSync('npm', ['run', 'typecheck', '--workspace', 'frontend'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
process.exit((backend.status || 0) + (frontend.status || 0) === 0 ? 0 : 1);
