import { Router } from 'express';
import { z } from 'zod';
import { config, PERMISSIONS, lanAddresses } from '../config/env.js';
import { db, schema, databaseStatus } from '../database/index.js';
import { parse } from '../core/validate.js';
import { checkPassword, login, logout, authRequired, ensureLocalUser } from '../middleware/auth.js';
import { recentLogs, createLogger } from '../core/logger.js';
import { getSettings, updateSettings, DEFAULT_SETTINGS } from '../services/settings.service.js';
import { searchAll } from '../services/search.service.js';
import * as memory from '../services/memory.service.js';
import * as providers from '../providers/registry.js';
import * as github from '../services/github.service.js';
import * as images from '../services/image.service.js';
import * as videos from '../services/video.service.js';
import { strictLimit } from '../core/ratelimit.js';
import { badRequest } from '../core/errors.js';

const log = createLogger('routes:core');
export const coreRoutes = Router();

// ------------------------------------------------------------------- health
coreRoutes.get('/health', (_req, res) => {
  const dbStatus = databaseStatus();
  res.json({
    status: dbStatus.connected ? 'ok' : 'degraded',
    version: config.version,
    name: config.app.name,
    database: dbStatus.connected ? 'connected' : 'error',
    uptimeSec: Math.round(process.uptime()),
    env: config.env,
  });
});

coreRoutes.get('/system/branding', (_req, res) => {
  res.json({ name: config.app.name, tagline: config.app.tagline, version: config.version, authRequired: authRequired() });
});

// --------------------------------------------------------------------- auth
coreRoutes.post('/auth/login', strictLimit, (req, res) => {
  const { password } = parse(z.object({ password: z.string().max(500) }), req.body, 'credentials');
  if (!checkPassword(password)) {
    log.warn('failed login attempt', { ip: req.ip });
    throw badRequest('Invalid password.');
  }
  const user = ensureLocalUser();
  login(res, user);
  res.json({ ok: true, user: { id: user.id, name: user.name, role: user.role } });
});

coreRoutes.post('/auth/logout', (req, res) => {
  logout(req, res);
  res.json({ ok: true });
});

coreRoutes.get('/auth/me', (req, res) => {
  if (!req.user) {
    res.json({ authenticated: false, authRequired: authRequired() });
    return;
  }
  res.json({ authenticated: true, authRequired: authRequired(), user: { id: req.user.id, name: req.user.name, role: req.user.role } });
});

// ------------------------------------------------------------------- system
coreRoutes.get('/system/status', async (_req, res) => {
  const dbStatus = databaseStatus();
  const providerRecords = providers.listProviderRecords().filter((p) => p.enabled && p.kind !== 'demo');
  const probes = await Promise.all(providerRecords.slice(0, 6).map(async (p) => {
    const probe = await providers.probeProvider(p);
    return { id: p.id, name: p.name, kind: p.kind, ok: probe.ok, message: probe.message, models: probe.models.length };
  }));
  const ollama = providers.listProviderRecords().find((p) => p.kind === 'ollama');
  let ollamaStatus = { configured: false };
  if (ollama) {
    const probe = await providers.probeProvider(ollama);
    ollamaStatus = { configured: true, ok: probe.ok, message: probe.message, models: probe.models };
  }
  res.json({
    frontend: { ok: true, port: config.frontendPort, lan: config.lan, addresses: lanAddresses() },
    backend: { ok: true, port: config.port, version: config.version, env: config.env, host: config.host },
    database: dbStatus,
    providers: probes,
    demoMode: config.demoMode,
    ollama: ollamaStatus,
    github: github.status(),
    images: images.imageProviderStatus(),
    video: videos.videoProviderStatus(),
    storage: { uploads: config.uploadsDir, generated: config.generatedDir },
  });
});

coreRoutes.get('/system/logs', (req, res) => {
  const level = typeof req.query.level === 'string' ? req.query.level.toUpperCase() : undefined;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json({ logs: recentLogs(limit, level) });
});

// ----------------------------------------------------------------- settings
coreRoutes.get('/settings', (_req, res) => {
  res.json({ settings: getSettings(), defaults: DEFAULT_SETTINGS, permissions: PERMISSIONS });
});

coreRoutes.patch('/settings', (req, res) => {
  const patch = parse(z.record(z.string(), z.unknown()), req.body, 'settings');
  res.json({ settings: updateSettings(patch) });
});

// ------------------------------------------------------------------- search
coreRoutes.get('/search', (req, res) => {
  const q = String(req.query.q || '').slice(0, 200);
  if (!q) { res.json({ results: {} }); return; }
  res.json({ results: searchAll(q) });
});

// ------------------------------------------------------------------- memory
coreRoutes.get('/memory', (req, res) => {
  res.json({ memories: memory.listMemories({ scope: req.query.scope, ownerId: String(req.query.ownerId || '') }) });
});

coreRoutes.post('/memory', (req, res) => {
  const body = parse(z.object({
    scope: z.enum(['conversation', 'agent', 'workspace']),
    ownerId: z.string().max(64).optional().default(''),
    kind: z.enum(['fact', 'summary', 'preference']).optional().default('fact'),
    content: z.string().min(1).max(4000),
  }), req.body, 'memory');
  const id = memory.remember(body);
  res.status(201).json({ id });
});

coreRoutes.delete('/memory/:id', (req, res) => {
  memory.forget(req.params.id);
  res.json({ ok: true });
});

coreRoutes.delete('/memory', (req, res) => {
  memory.clearScope({ scope: String(req.query.scope || 'workspace'), ownerId: String(req.query.ownerId || '') });
  res.json({ ok: true });
});
