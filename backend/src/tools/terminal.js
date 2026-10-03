import { spawn } from 'node:child_process';
import { z } from 'zod';
import { defineTool, cap, toolResult } from './base.js';
import { config } from '../config/env.js';
import { badRequest } from '../core/errors.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('tool:terminal');

const SHELL_META = /[|&;<>$`\\]|&&|\|\||\n/;

/** Tokenize a command line respecting single/double quotes (no shell involved). */
export function tokenize(cmd) {
  const out = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < cmd.length; i += 1) {
    const ch = cmd[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur) { out.push(cur); cur = ''; }
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** Basic command-injection guard: allow-listed binary + no shell metacharacters. */
export function validateCommand(cmd, allowlist = config.terminalAllowlist) {
  const trimmed = String(cmd || '').trim();
  if (!trimmed) throw badRequest('Empty command.');
  if (SHELL_META.test(trimmed)) {
    throw badRequest('Shell operators (|, &, ;, >, <, `, $, newlines) are not allowed by the terminal tool.');
  }
  const argv = tokenize(trimmed);
  if (!argv.length) throw badRequest('Empty command.');
  const bin = argv[0].split('/').pop();
  if (!allowlist.includes(bin)) {
    throw badRequest(`Command "${bin}" is not in the terminal allow-list (${allowlist.join(', ')}).`);
  }
  return argv;
}

export const runCommandTool = defineTool({
  name: 'run_command',
  description: 'Run an allow-listed command in the workspace (no shell, no operators). Dangerous: requires user confirmation.',
  permissions: ['EXECUTE_COMMANDS'],
  dangerous: true,
  schema: z.object({
    command: z.string().min(1).max(1000).describe('e.g. "npm test" or "ls -la"'),
    timeoutMs: z.number().int().min(500).max(120000).optional().default(30000),
  }),
  async execute({ command, timeoutMs = 30000 }, ctx) {
    const argv = validateCommand(command);
    log.info('executing command', { command, cwd: ctx.workspaceRoot });
    return await new Promise((resolve, reject) => {
      const child = spawn(argv[0], argv.slice(1), {
        cwd: ctx.workspaceRoot,
        shell: false,
        env: { ...process.env, FORCE_COLOR: '0' },
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(badRequest(`Command timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      child.stdout.on('data', (d) => { if (stdout.length < 40000) stdout += d.toString(); });
      child.stderr.on('data', (d) => { if (stderr.length < 20000) stderr += d.toString(); });
      child.on('error', (err) => { clearTimeout(timer); reject(badRequest(`Could not run command: ${err.message}`)); });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(toolResult(`Command exited with code ${code}`, {
          command, exitCode: code, stdout: cap(stdout), stderr: cap(stderr),
        }));
      });
    });
  },
});

export const terminalTools = [runCommandTool];
