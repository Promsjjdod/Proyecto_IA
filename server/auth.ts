import { Router, type NextFunction, type Request, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import { db, createUserDefaults } from './db.js';
import { hashOpaqueToken, hashPassword, verifyPassword, constantTimeStringEqual } from './security.js';
import { isProduction, PROJECT_DIR } from './config.js';
import fs from 'node:fs';
import path from 'node:path';
import { MODE_POLICIES } from './config.js';

export type AuthUser = { id: string; email: string; name: string; role: 'admin' | 'user'; credits: number; daily_limit: number; monthly_limit: number; preferences_json: string; created_at: string; password_hash?: string };
export type AuthRequest = Omit<Request, 'params'> & { params: Record<string, string>; user?: AuthUser; csrfToken?: string };

const authRouter = Router();
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const SESSION_DAYS = 14;
const cookieName = 'nexus_session';

function nowIso() { return new Date().toISOString(); }
function getCookie(req: Request, name: string) {
  const entry = (req.headers.cookie || '').split(';').map((v) => v.trim()).find((v) => v.startsWith(`${name}=`));
  if (!entry) return '';
  try { return decodeURIComponent(entry.slice(name.length + 1)); } catch { return ''; }
}
function setSessionCookie(res: Response, token: string) {
  const secure = isProduction ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${cookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 24 * 60 * 60}${secure}`);
}
function clearSessionCookie(res: Response) {
  const secure = isProduction ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}
function rateLimit(req: Request, res: Response) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const state = loginAttempts.get(ip);
  if (!state || state.resetAt < now) { loginAttempts.set(ip, { count: 1, resetAt: now + 10 * 60_000 }); return false; }
  state.count += 1;
  if (state.count > 25) { res.status(429).json({ error: 'Demasiados intentos. Inténtalo de nuevo en unos minutos.' }); return true; }
  return false;
}

function publicUser(user: AuthUser) {
  let preferences: Record<string, unknown> = {};
  try { preferences = JSON.parse(user.preferences_json || '{}'); } catch { /* ignore corrupt old setting */ }
  return { id: user.id, email: user.email, name: user.name, role: user.role, credits: user.credits,
    dailyLimit: user.daily_limit, monthlyLimit: user.monthly_limit, preferences, createdAt: user.created_at,
    plan: 'FREE', plans: [{ name: 'FREE', status: 'current' }, { name: 'PRO', status: 'coming-soon' }, { name: 'MAX', status: 'coming-soon' }] };
}

function issueSession(userId: string, res: Response) {
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(24).toString('base64url');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60_000).toISOString();
  db.prepare('INSERT INTO sessions(token_hash,user_id,csrf_hash,expires_at,created_at) VALUES(?,?,?,?,?)')
    .run(hashOpaqueToken(token), userId, hashOpaqueToken(csrf), expires, now.toISOString());
  setSessionCookie(res, token);
  return csrf;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = getCookie(req, cookieName);
  if (!token) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
  const session = db.prepare(`SELECT s.user_id,s.csrf_hash,s.expires_at,u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`)
    .get(hashOpaqueToken(token)) as (AuthUser & { csrf_hash: string; expires_at: string }) | undefined;
  if (!session || Date.parse(session.expires_at) <= Date.now()) {
    if (session) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashOpaqueToken(token));
    clearSessionCookie(res);
    return res.status(401).json({ error: 'La sesión expiró. Vuelve a iniciar sesión.' });
  }
  req.user = session;
  const csrf = req.header('x-csrf-token') || '';
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    if (!csrf || !constantTimeStringEqual(hashOpaqueToken(csrf), session.csrf_hash)) {
      return res.status(403).json({ error: 'Token CSRF inválido. Recarga la sesión e inténtalo de nuevo.' });
    }
  }
  req.csrfToken = csrf;
  next();
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Esta acción requiere permisos de administración.' });
  next();
}

function seedProjectDirectory(userId: string, projectId: string) {
  const dir = path.join(PROJECT_DIR, userId, projectId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

// Auth endpoints are intentionally outside the authenticated API router.
authRouter.post('/register', (req: Request, res: Response) => {
  if (rateLimit(req, res)) return;
  const email = String(req.body?.email || '').trim().toLowerCase();
  const name = String(req.body?.name || '').trim();
  const password = String(req.body?.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Introduce un correo válido.' });
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'El nombre debe tener entre 2 y 80 caracteres.' });
  if (password.length < 12 || password.length > 200) return res.status(400).json({ error: 'La contraseña debe tener al menos 12 caracteres.' });
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return res.status(409).json({ error: 'Ya existe una cuenta con ese correo.' });
  const id = crypto.randomUUID();
  try {
    db.prepare(`INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)`)
      .run(id, email, name, hashPassword(password), 'user', nowIso());
    const firstProjectId = createUserDefaults(id);
    seedProjectDirectory(id, firstProjectId);
    const csrfToken = issueSession(id, res);
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(id) as AuthUser;
    return res.status(201).json({ user: publicUser(user), csrfToken });
  } catch (error) {
    console.error('Registration failed:', error instanceof Error ? error.message : 'unknown error');
    return res.status(500).json({ error: 'No se pudo crear la cuenta. Inténtalo de nuevo.' });
  }
});

authRouter.post('/login', (req: Request, res: Response) => {
  if (rateLimit(req, res)) return;
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email) as (AuthUser & { password_hash: string }) | undefined;
  if (!user || !verifyPassword(password, user.password_hash)) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  const csrfToken = issueSession(user.id, res);
  return res.json({ user: publicUser(user), csrfToken });
});

authRouter.get('/me', requireAuth, (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const sessionToken = getCookie(req, cookieName);
  const session = db.prepare('SELECT csrf_hash FROM sessions WHERE token_hash=?').get(hashOpaqueToken(sessionToken)) as { csrf_hash: string };
  // The raw CSRF token is not stored. Issue a fresh token in the current session row.
  const csrfToken = randomBytes(24).toString('base64url');
  db.prepare('UPDATE sessions SET csrf_hash=? WHERE token_hash=?').run(hashOpaqueToken(csrfToken), hashOpaqueToken(sessionToken));
  return res.json({ user: publicUser(user), csrfToken, modes: Object.entries(MODE_POLICIES).map(([id, mode]) => ({ id, ...mode })) });
});

authRouter.post('/logout', requireAuth, (req: AuthRequest, res: Response) => {
  const token = getCookie(req, cookieName);
  db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashOpaqueToken(token));
  clearSessionCookie(res);
  res.json({ ok: true });
});

export function mountAuthRoutes(app: import('express').Express) { app.use('/api/auth', authRouter); }
export function setProjectFolderPermissions(userId: string, projectId: string) { seedProjectDirectory(userId, projectId); }
