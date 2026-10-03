import crypto from 'node:crypto';
import { config } from '../config/env.js';

const ALGO = 'aes-256-gcm';

function masterKey() {
  let key = config.secretKey;
  if (!key) {
    // Derive a stable dev key so local installs work out of the box.
    // Documented in docs/security.md - set FORGEAI_SECRET_KEY in production.
    key = crypto.createHash('sha256').update('forgeai-dev-master-key-v1').digest('hex');
  }
  return crypto.createHash('sha256').update(key).digest();
}

/** Encrypt a secret for storage at rest (GitHub tokens, provider API keys). */
export function encryptSecret(plain) {
  if (plain === null || plain === undefined || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, masterKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${enc.toString('base64url')}`;
}

export function decryptSecret(payload) {
  if (!payload) return null;
  const [ver, ivB64, tagB64, dataB64] = String(payload).split(':');
  if (ver !== 'v1') throw new Error('Unsupported secret format');
  const decipher = crypto.createDecipheriv(ALGO, masterKey(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
}

export function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function randomId(prefix = '') {
  const id = crypto.randomBytes(9).toString('base64url').replace(/[-_]/g, '').slice(0, 12);
  return prefix ? `${prefix}_${id}` : id;
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** HMAC-signed opaque token used for session cookies. */
export function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', masterKey()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', masterKey()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [algo, salt, hash] = String(stored).split(':');
    if (algo !== 'scrypt') return false;
    const calc = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(calc, 'hex'), Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

/** Mask a secret for safe display: keep first 4 / last 4 chars. */
export function maskSecret(secret) {
  const s = String(secret || '');
  if (s.length <= 8) return s ? '••••' : '';
  return `${s.slice(0, 4)}${'•'.repeat(Math.min(12, s.length - 8))}${s.slice(-4)}`;
}
