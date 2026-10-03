import { z } from 'zod';
import { defineTool, cap, toolResult } from './base.js';
import { badRequest } from '../core/errors.js';

function assertHttpUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw badRequest('Invalid URL.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw badRequest('Only http/https URLs are allowed.');
  // SSRF guard: block loopback / link-local / private ranges unless explicitly allowed.
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const blocked =
    host === 'localhost' ||
    host === '0.0.0.0' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    host === '::1';
  if (blocked) throw badRequest('Requests to local/private network addresses are blocked by the network tool.');
  return parsed;
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export const fetchUrlTool = defineTool({
  name: 'fetch_url',
  description: 'Fetch a public web page and return readable text (HTML stripped). External network only.',
  permissions: ['NETWORK_ACCESS'],
  schema: z.object({
    url: z.string().min(1).max(2000),
    maxChars: z.number().int().min(100).max(20000).optional().default(6000),
  }),
  async execute({ url, maxChars = 6000 }, ctx = {}) {
    assertHttpUrl(url);
    const cfg = ctx.pluginConfig || {};
    const limit = Number(cfg.max_chars) || maxChars;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': cfg.user_agent || 'ForgeAI/0.1 (+local workspace)' },
    });
    const type = res.headers.get('content-type') || '';
    const raw = await res.text();
    const text = type.includes('html') ? htmlToText(raw) : raw;
    return toolResult(`Fetched ${url} (HTTP ${res.status})`, {
      url, status: res.status, contentType: type, text: cap(text, limit),
    });
  },
});

export const httpRequestTool = defineTool({
  name: 'http_request',
  description: 'Perform an HTTP request (GET/POST/PUT/PATCH/DELETE) to an external API and return status + body.',
  permissions: ['NETWORK_ACCESS'],
  schema: z.object({
    url: z.string().min(1).max(2000),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional().default('GET'),
    headers: z.record(z.string(), z.string()).optional().default({}),
    body: z.string().max(100000).optional(),
  }),
  async execute({ url, method = 'GET', headers = {}, body }) {
    assertHttpUrl(url);
    const res = await fetch(url, {
      method,
      headers: { 'User-Agent': 'ForgeAI/0.1', ...headers },
      ...(body ? { body } : {}),
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    return toolResult(`${method} ${url} -> HTTP ${res.status}`, {
      status: res.status, headers: Object.fromEntries(res.headers.entries()), body: cap(text, 8000),
    });
  },
});

export const networkTools = [fetchUrlTool, httpRequestTool];
