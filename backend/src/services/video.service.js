import { eq, desc } from 'drizzle-orm';
import { db, schema } from '../database/index.js';
import { randomId } from '../core/crypto.js';
import { notFound } from '../core/errors.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('video');

/**
 * Video generation architecture.
 *
 * The queue, states (queued / generating / completed / failed) and the
 * provider interface are fully implemented; no bundled provider implements
 * video synthesis yet, so jobs are created as `queued` and immediately moved
 * to `failed` with an explicit, honest reason. Plug a real provider by
 * implementing `VideoProvider` below and registering it in VIDEO_PROVIDERS.
 */

/**
 * @typedef {Object} VideoProvider
 * @property {string} id
 * @property {(job: object, onUpdate: (patch: object) => void) => Promise<{ path: string }>} generate
 */
const VIDEO_PROVIDERS = new Map();

export function registerVideoProvider(provider) {
  VIDEO_PROVIDERS.set(provider.id, provider);
  log.info('video provider registered', { id: provider.id });
}

export function videoProviderStatus() {
  if (VIDEO_PROVIDERS.size) return { configured: true, providers: [...VIDEO_PROVIDERS.keys()] };
  return {
    configured: false,
    providers: [],
    instructions: 'No video synthesis provider is registered yet. The queue, states and API are ready: implement VideoProvider (see backend/src/services/video.service.js) and register it to enable real generation.',
  };
}

export function enqueueVideo(request) {
  const id = randomId('vid');
  const now = Date.now();
  db.insert(schema.videos).values({
    id,
    prompt: request.prompt,
    duration: request.duration,
    resolution: request.resolution,
    aspect: request.aspect,
    style: request.style,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  }).run();
  setImmediate(() => processJob(id));
  return get(id);
}

async function processJob(id) {
  const row = get(id);
  if (row.status !== 'queued') return;
  const status = videoProviderStatus();
  if (!status.configured) {
    db.update(schema.videos).set({
      status: 'failed',
      error: 'Not configured: no video synthesis provider is registered. The queue is ready - see Settings → Models → Video generation for how to plug one in.',
      updatedAt: Date.now(),
    }).where(eq(schema.videos.id, id)).run();
    log.info('video job failed: no provider registered', { id });
    return;
  }
  db.update(schema.videos).set({ status: 'generating', updatedAt: Date.now() }).where(eq(schema.videos.id, id)).run();
  const provider = [...VIDEO_PROVIDERS.values()][0];
  try {
    const result = await provider.generate(row, (patch) => {
      db.update(schema.videos).set({ ...patch, updatedAt: Date.now() }).where(eq(schema.videos.id, id)).run();
    });
    db.update(schema.videos).set({ status: 'completed', path: result.path, updatedAt: Date.now() }).where(eq(schema.videos.id, id)).run();
  } catch (err) {
    db.update(schema.videos).set({ status: 'failed', error: err.message, updatedAt: Date.now() }).where(eq(schema.videos.id, id)).run();
  }
}

export function listVideos() {
  return db.select().from(schema.videos).orderBy(desc(schema.videos.createdAt)).all();
}

export function get(id) {
  const row = db.select().from(schema.videos).where(eq(schema.videos.id, id)).get();
  if (!row) throw notFound('Video job not found.');
  return row;
}

export function remove(id) {
  get(id);
  db.delete(schema.videos).where(eq(schema.videos.id, id)).run();
}
