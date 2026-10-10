import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { isProduction } from './config.js';

const DEV_ENCRYPTION_FALLBACK = 'local-development-only-do-not-deploy-nexus-ai';

function encryptionKey() {
  const configured = process.env.PROVIDER_ENCRYPTION_KEY;
  if (isProduction && (!configured || configured.length < 32)) {
    throw new Error('PROVIDER_ENCRYPTION_KEY must contain at least 32 characters in production.');
  }
  if (!configured && !isProduction) {
    console.warn('Using the development-only provider encryption key. Set PROVIDER_ENCRYPTION_KEY before storing production credentials.');
  }
  return createHash('sha256').update(configured || DEV_ENCRYPTION_FALLBACK).digest();
}

export function encryptSecret(value: string) {
  if (!value) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${ciphertext.toString('base64')}`;
}

export function decryptSecret(value: string) {
  if (!value) return '';
  const [iv, tag, ciphertext] = value.split('.');
  if (!iv || !tag || !ciphertext) throw new Error('No se pudo descifrar la credencial guardada. Reconfigura la clave del proveedor.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string) {
  const [scheme, saltText, hashText] = stored.split('$');
  if (scheme !== 'scrypt' || !saltText || !hashText) return false;
  const salt = Buffer.from(saltText, 'base64');
  const expected = Buffer.from(hashText, 'base64');
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function hashOpaqueToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function constantTimeStringEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function redactedError(message: string, secret = '') {
  let cleaned = message.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted]');
  if (secret) cleaned = cleaned.split(secret).join('[redacted]');
  return cleaned.slice(0, 600);
}
