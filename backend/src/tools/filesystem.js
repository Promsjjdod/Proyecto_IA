import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { defineTool, cap, toolResult } from './base.js';
import { badRequest, notFound } from '../core/errors.js';

/** Resolve a user/agent path inside the workspace root, blocking traversal. */
export function resolveSafe(root, requested) {
  const clean = String(requested || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const abs = path.resolve(root, clean);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw badRequest(`Path escapes the workspace root: ${requested}`);
  }
  return { abs, rel: rel === '' ? '.' : rel };
}

const TEXT_EXT = /\.(txt|md|markdown|json|js|jsx|ts|tsx|py|html|css|scss|yml|yaml|toml|csv|env|sh|bat|sql|log|ini|cfg|xml|svg)$/i;

export function isProbablyText(name) {
  return TEXT_EXT.test(name);
}

export const readFileTool = defineTool({
  name: 'read_file',
  description: 'Read a text file from the ForgeAI workspace. Returns content (capped) and size.',
  permissions: ['READ_FILES'],
  schema: z.object({
    path: z.string().min(1).max(500).describe('Path relative to the workspace root'),
    maxBytes: z.number().int().min(1).max(500000).optional(),
  }),
  async execute({ path: p, maxBytes = 64000 }, ctx) {
    const { abs } = resolveSafe(ctx.workspaceRoot, p);
    if (!fs.existsSync(abs)) throw notFound(`File not found: ${p}`);
    const st = fs.statSync(abs);
    if (st.isDirectory()) throw badRequest(`Path is a directory: ${p}`);
    const buf = fs.readFileSync(abs);
    const slice = buf.subarray(0, maxBytes);
    return toolResult(`Read ${p} (${st.size} bytes)`, {
      path: p,
      size: st.size,
      truncated: st.size > maxBytes,
      content: cap(slice.toString('utf8')),
    });
  },
});

export const listDirTool = defineTool({
  name: 'list_dir',
  description: 'List files and folders inside the workspace (non-recursive by default).',
  permissions: ['READ_FILES'],
  schema: z.object({
    path: z.string().max(500).optional().default(''),
    recursive: z.boolean().optional().default(false),
  }),
  async execute({ path: p = '', recursive = false }, ctx) {
    const { abs } = resolveSafe(ctx.workspaceRoot, p);
    if (!fs.existsSync(abs)) throw notFound(`Directory not found: ${p || '.'}`);
    const out = [];
    const walk = (dir, prefix, depth) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        out.push({ path: rel, type: entry.isDirectory() ? 'dir' : 'file', size: entry.isFile() ? fs.statSync(path.join(dir, entry.name)).size : undefined });
        if (recursive && entry.isDirectory() && depth < 4) walk(path.join(dir, entry.name), rel, depth + 1);
      }
    };
    walk(abs, '', 0);
    return toolResult(`Listed ${p || '.'} (${out.length} entries)`, { entries: out.slice(0, 500) });
  },
});

export const writeFileTool = defineTool({
  name: 'write_file',
  description: 'Create or overwrite a text file inside the workspace. Dangerous: requires user confirmation.',
  permissions: ['WRITE_FILES'],
  dangerous: true,
  schema: z.object({
    path: z.string().min(1).max(500),
    content: z.string().max(500000),
    append: z.boolean().optional().default(false),
  }),
  async execute({ path: p, content, append = false }, ctx) {
    const { abs, rel } = resolveSafe(ctx.workspaceRoot, p);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (append) fs.appendFileSync(abs, content, 'utf8');
    else fs.writeFileSync(abs, content, 'utf8');
    return toolResult(`${append ? 'Appended to' : 'Wrote'} ${rel} (${content.length} chars)`, { path: rel, bytes: content.length });
  },
});

export const searchFilesTool = defineTool({
  name: 'search_files',
  description: 'Search file names and text content inside the workspace (case-insensitive).',
  permissions: ['READ_FILES'],
  schema: z.object({
    query: z.string().min(1).max(200),
    path: z.string().max(500).optional().default(''),
    content: z.boolean().optional().default(true),
  }),
  async execute({ query, path: p = '', content = true }, ctx) {
    const { abs } = resolveSafe(ctx.workspaceRoot, p);
    const needle = query.toLowerCase();
    const hits = [];
    const walk = (dir, prefix, depth) => {
      if (hits.length > 120 || depth > 5) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.arena')) continue;
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full, rel, depth + 1); continue; }
        if (entry.name.toLowerCase().includes(needle)) hits.push({ path: rel, match: 'filename' });
        else if (content && isProbablyText(entry.name)) {
          try {
            const st = fs.statSync(full);
            if (st.size > 1_500_000) continue;
            const text = fs.readFileSync(full, 'utf8');
            const idx = text.toLowerCase().indexOf(needle);
            if (idx >= 0) {
              const line = text.slice(0, idx).split('\n').length;
              hits.push({ path: rel, match: 'content', line, snippet: cap(text.slice(Math.max(0, idx - 80), idx + 160), 300) });
            }
          } catch { /* binary or unreadable */ }
        }
      }
    };
    walk(abs, '', 0);
    return toolResult(`Found ${hits.length} match(es) for "${query}"`, { hits: hits.slice(0, 60) });
  },
});

export const filesystemTools = [readFileTool, listDirTool, writeFileTool, searchFilesTool];
