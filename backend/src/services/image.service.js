import fs from 'node:fs';
import path from 'node:path';
import { eq, desc } from 'drizzle-orm';
import { db, schema } from '../database/index.js';
import { config } from '../config/env.js';
import { randomId, decryptSecret } from '../core/crypto.js';
import { badRequest, notFound } from '../core/errors.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('images');

const DIMS = {
  '1:1': (r) => [r, r],
  '16:9': (r) => [r, Math.round((r * 9) / 16)],
  '9:16': (r) => [Math.round((r * 9) / 16), r],
  '4:3': (r) => [r, Math.round((r * 3) / 4)],
  '3:4': (r) => [Math.round((r * 3) / 4), r],
};

export function imageProviderStatus() {
  const baseUrl = process.env.IMAGE_PROVIDER_BASE_URL || '';
  if (baseUrl) return { configured: true, kind: 'openai-images', baseUrl };
  return {
    configured: false,
    kind: null,
    instructions: 'Set IMAGE_PROVIDER_BASE_URL / IMAGE_PROVIDER_API_KEY / IMAGE_PROVIDER_MODEL in .env (any OpenAI-compatible /images/generations endpoint), or enable DEMO mode to explore the gallery with clearly labelled placeholders.',
  };
}

/**
 * Generate images. Uses an OpenAI-compatible /images/generations endpoint when
 * configured; otherwise, in DEMO mode, renders a clearly labelled local SVG
 * placeholder so the gallery and its actions remain fully testable.
 */
export async function generateImages(request) {
  const status = imageProviderStatus();
  const rows = [];
  const [w, h] = (DIMS[request.aspect] || DIMS['1:1'])(Number(request.resolution) || 1024);

  for (let i = 0; i < request.count; i += 1) {
    const id = randomId('img');
    fs.mkdirSync(config.imagesDir, { recursive: true });
    if (status.configured) {
      const file = path.join(config.imagesDir, `${id}.png`);
      await callImageProvider(request, file, w, h);
      rows.push(insertRow(id, request, `generated/images/${path.basename(file)}`, w, h, null, false));
    } else if (config.demoMode) {
      const file = path.join(config.imagesDir, `${id}.svg`);
      fs.writeFileSync(file, demoSvg(request, w, h, id), 'utf8');
      rows.push(insertRow(id, request, `generated/images/${path.basename(file)}`, w, h, id, true));
    } else {
      throw badRequest('No image provider configured and DEMO mode is disabled. See Settings → Models → Image generation.');
    }
  }
  return rows;
}

function insertRow(id, req, relPath, w, h, seed, demo) {
  const now = Date.now();
  db.insert(schema.images).values({
    id,
    prompt: req.prompt,
    negativePrompt: req.negativePrompt || '',
    aspect: req.aspect,
    resolution: req.resolution,
    style: req.style,
    model: process.env.IMAGE_PROVIDER_MODEL || (demo ? 'forge-demo-image' : null),
    providerId: demo ? 'demo' : 'image-provider',
    path: relPath,
    width: w,
    height: h,
    seed,
    demo,
    createdAt: now,
  }).run();
  return get(id);
}

async function callImageProvider(request, file, width, height) {
  const baseUrl = String(process.env.IMAGE_PROVIDER_BASE_URL).replace(/\/+$/, '');
  const key = process.env.IMAGE_PROVIDER_API_KEY || '';
  const res = await fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({
      model: process.env.IMAGE_PROVIDER_MODEL || 'gpt-image-1',
      prompt: request.prompt + (request.negativePrompt ? `\nAvoid: ${request.negativePrompt}` : ''),
      n: 1,
      size: `${width}x${height}`,
      response_format: 'b64_json',
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw badRequest(`Image provider returned HTTP ${res.status}. ${text.slice(0, 300)}`);
  }
  const body = await res.json();
  const b64 = body?.data?.[0]?.b64_json;
  const url = body?.data?.[0]?.url;
  if (b64) {
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    return;
  }
  if (url) {
    const img = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!img.ok) throw badRequest('Could not download generated image from provider URL.');
    fs.writeFileSync(file, Buffer.from(await img.arrayBuffer()));
    return;
  }
  throw badRequest('Image provider response contained no image data.');
}

/** Deterministic, clearly-labelled DEMO artwork (no external model involved). */
function demoSvg(request, w, h, seed) {
  let hash = 0;
  const s = `${seed}:${request.prompt}`;
  for (let i = 0; i < s.length; i += 1) hash = (hash * 31 + s.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  const hue2 = (hue + 40) % 360;
  const shapes = [];
  for (let i = 0; i < 7; i += 1) {
    const r = (Math.abs(hash >> (i * 3)) % 1000) / 1000;
    const r2 = (Math.abs(hash >> (i * 5 + 1)) % 1000) / 1000;
    shapes.push(`<circle cx="${(r * w).toFixed(0)}" cy="${(r2 * h).toFixed(0)}" r="${(20 + r * 90).toFixed(0)}" fill="hsl(${(hue + i * 18) % 360} 70% ${35 + r2 * 30}% / 0.35)"/>`);
  }
  const label = request.prompt.length > 90 ? `${request.prompt.slice(0, 90)}…` : request.prompt;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="hsl(${hue} 45% 12%)"/><stop offset="1" stop-color="hsl(${hue2} 55% 22%)"/>
  </linearGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  ${shapes.join('\n  ')}
  <rect x="0" y="${h - 92}" width="${w}" height="92" fill="#000" opacity="0.55"/>
  <text x="24" y="${h - 56}" font-family="monospace" font-size="22" fill="#ffb27a">DEMO IMAGE — no provider configured</text>
  <text x="24" y="${h - 26}" font-family="monospace" font-size="18" fill="#e8e4da">${escapeXml(label)}</text>
</svg>`;
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function listImages({ limit = 200 } = {}) {
  return db.select().from(schema.images).orderBy(desc(schema.images.createdAt)).limit(limit).all();
}

export function get(id) {
  const row = db.select().from(schema.images).where(eq(schema.images.id, id)).get();
  if (!row) throw notFound('Image not found.');
  return row;
}

export function removeImage(id) {
  const row = get(id);
  const abs = path.join(config.imagesDir, path.basename(row.path));
  try { fs.rmSync(abs, { force: true }); } catch (err) { log.warn('could not delete image file', { error: err.message }); }
  db.delete(schema.images).where(eq(schema.images.id, id)).run();
}

export function absoluteImagePath(row) {
  return path.join(config.imagesDir, path.basename(row.path));
}
