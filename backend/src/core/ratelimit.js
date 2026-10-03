import { tooMany } from './errors.js';
import { config } from '../config/env.js';

/**
 * Tiny in-memory sliding-window rate limiter (per IP + bucket).
 * Local-first: protects against runaway loops, not the Internet.
 */
const buckets = new Map();
const WINDOW_MS = 60_000;

export function rateLimit({ max = config.rateLimitMax, bucket = 'api' } = {}) {
  return (req, _res, next) => {
    const key = `${bucket}:${req.ip || 'unknown'}`;
    const now = Date.now();
    let entry = buckets.get(key);
    if (!entry || now - entry.start > WINDOW_MS) {
      entry = { start: now, count: 0 };
      buckets.set(key, entry);
      if (buckets.size > 5000) {
        for (const [k, v] of buckets) if (now - v.start > WINDOW_MS) buckets.delete(k);
      }
    }
    entry.count += 1;
    if (entry.count > max) {
      next(tooMany('Rate limit exceeded. Slow down and retry in a minute.'));
      return;
    }
    next();
  };
}

/** Stricter limiter for auth + expensive endpoints. */
export const strictLimit = rateLimit({ max: 30, bucket: 'strict' });
