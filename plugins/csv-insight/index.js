import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { defineTool, toolResult, cap } from '../../backend/src/tools/base.js';
import { resolveSafe } from '../../backend/src/tools/filesystem.js';

/** Minimal RFC-4180-ish CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i += 1; } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch === '\r') { /* skip */ }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ''));
}

function summarize(rows) {
  if (!rows.length) return { columns: [], rowCount: 0 };
  const header = rows[0].map((h) => h.trim() || `col${Math.random()}`);
  const body = rows.slice(1);
  const columns = header.map((name, idx) => {
    const values = body.map((r) => (r[idx] ?? '').trim()).filter((v) => v !== '');
    const nums = values.map((v) => Number(v.replace(/\s|€/g, ''))).filter((n) => Number.isFinite(n));
    const base = { name, nonEmpty: values.length, distinct: new Set(values).size };
    if (nums.length && nums.length >= values.length * 0.8) {
      const sorted = [...nums].sort((a, b) => a - b);
      return {
        ...base,
        type: 'number',
        min: sorted[0],
        max: sorted[sorted.length - 1],
        avg: +(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(4),
      };
    }
    const freq = new Map();
    for (const v of values) freq.set(v, (freq.get(v) || 0) + 1);
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([value, count]) => ({ value, count }));
    return { ...base, type: 'text', top };
  });
  return { rowCount: body.length, columns };
}

const analyzeCsvTool = defineTool({
  name: 'analyze_csv',
  description: 'Parse a CSV file from the workspace and return row count plus per-column statistics (numeric min/max/avg or top text values).',
  permissions: ['READ_FILES'],
  source: 'plugin',
  pluginId: 'csv-insight',
  schema: z.object({ path: z.string().min(1).max(500).describe('CSV path relative to the workspace root') }),
  async execute({ path: p }, ctx) {
    const { abs } = resolveSafe(ctx.workspaceRoot, p);
    if (!fs.existsSync(abs)) throw new Error(`File not found: ${p}`);
    const maxRows = Number(ctx.pluginConfig?.max_rows ?? 5000);
    const text = fs.readFileSync(abs, 'utf8').slice(0, 4_000_000);
    const rows = parseCsv(text).slice(0, maxRows + 1);
    const summary = summarize(rows);
    return toolResult(`Analyzed ${path.basename(p)}: ${summary.rowCount} data row(s), ${summary.columns.length} column(s).`, summary);
  },
});

export const tools = [analyzeCsvTool];
export function createTools() { return tools; }
