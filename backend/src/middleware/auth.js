import { eq } from 'drizzle-orm';
import { config } from '../config/env.js';
import { db, schema } from '../database/index.js';
import { verifyToken, signToken, sha256, randomId, verifyPassword } from '../core/crypto.js';
import { unauthorized } from '../core/errors.js';

const COOKIE = 'forgeai_session';
const SESSION_DAYS = 30;

export function ensureLocalUser() {
  let user = db.select().from(schema.users).where(eq(schema.users.role, 'owner')).get();
  if (!user) {
    user = {
      id: 'local',
      name: 'Local User',
      email: null,
      passwordHash: config.authPassword ? null : null,
      role: 'owner',
      createdAt: Date.now(),
    };
    db.insert(schema.users).values(user).run();
  }
  if (config.authPassword && !user.passwordHash) {
    import('../core/crypto.js').then(({ hashPassword }) => {
      db.update(schema.users).set({ passwordHash: hashPassword(config.authPassword) }).where(eq(schema.users.id, user.id)).run();
    });
  }
  return user;
}

export function authRequired() {
  return Boolean(config.authPassword);
}

function setSessionCookie(res, userId) {
  const token = signToken({ uid: userId, iat: Date.now() });
  const hash = sha256(token);
  const id = randomId('ses');
  db.insert(schema.sessions).values({
    id,
    userId,
    tokenHash: hash,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_DAYS * 86400000,
  }).run();
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`);
  return token;
}

export function login(res, user) {
  return setSessionCookie(res, user.id);
}

export function logout(req, res) {
  const token = req.cookies?.[COOKIE];
  if (token) {
    db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(token))).run();
  }
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function resolveUser(req) {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload?.uid) return null;
  const session = db.select().from(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(token))).get();
  if (!session || session.expiresAt < Date.now()) return null;
  const user = db.select().from(schema.users).where(eq(schema.users.id, payload.uid)).get();
  return user || null;
}

/**
 * Local-first auth:
 *  - when FORGEAI_AUTH_PASSWORD is set -> real login flow with sessions
 *  - when empty -> trusted single-user local app, auto session on first request
 */
export function authMiddleware(req, res, next) {
  const open = ['/api/health', '/api/auth/login', '/api/github/oauth/callback', '/api/system/branding'];
  if (open.some((p) => req.path === p || req.path.startsWith(`${p}?`))) return next();

  let user = resolveUser(req);
  if (!user && !authRequired()) {
    user = ensureLocalUser();
    setSessionCookie(res, user.id);
  }
  if (user) req.user = user;
  if (!user) {
    if (req.path.startsWith('/api/')) return next(unauthorized());
    return next();
  }
  req.user = user;
  next();
}

export function checkPassword(password) {
  const user = ensureLocalUser();
  if (!config.authPassword) return true;
  return verifyPassword(password, user.passwordHash || '') || password === config.authPassword;
}
