import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { HOST, PORT, isProduction } from './config.js';
import { db, bootstrapAdminFromEnvironment } from './db.js';
import { mountAuthRoutes } from './auth.js';
import providerRoutes from './providers/routes.js';
import chatRoutes from './chats/routes.js';
import uploadRoutes, { cleanupUnreferencedAttachments } from './uploads.js';
import workspaceRoutes from './workspaces/routes.js';
import agentRoutes from './agents/routes.js';
import imageRoutes from './images/routes.js';
import workflowRoutes from './workflows/routes.js';
import adminRoutes from './admin.js';
import usageRoutes from './usage-routes.js';
import profileRoutes from './profile.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), payment=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'Nexus AI Workspace', time: new Date().toISOString() }));
  mountAuthRoutes(app);
  app.use('/api/providers', providerRoutes);
  app.use('/api/chats', chatRoutes);
  app.use('/api/uploads', uploadRoutes);
  app.use('/api/projects', workspaceRoutes);
  app.use('/api/agents', agentRoutes);
  app.use('/api/images', imageRoutes);
  app.use('/api/workflows', workflowRoutes);
  app.use('/api/usage', usageRoutes);
  app.use('/api/profile', profileRoutes);
  app.use('/api/admin', adminRoutes);

  const dist = path.resolve('dist');
  if (isProduction && fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h', setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    } }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((_req, res) => res.status(404).json({ error: 'Recurso no encontrado.' }));
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = Number(error?.status || error?.statusCode || 500);
    const safeStatus = status >= 400 && status < 600 ? status : 500;
    const raw = error instanceof Error ? error.message : 'Error interno del servidor.';
    const message = safeStatus >= 500 && !error?.status ? 'Error interno del servidor. Revisa la configuración e inténtalo de nuevo.' : raw;
    if (safeStatus >= 500) console.error(`[server] ${safeStatus}: ${raw.slice(0, 350)}`);
    res.status(safeStatus).json({ error: message });
  });
  return app;
}

export function startServer() {
  cleanupUnreferencedAttachments();
  bootstrapAdminFromEnvironment();
  db.prepare(`UPDATE workflow_runs SET status='interrupted',error='El servidor se reinició durante la ejecución.',finished_at=? WHERE status='running'`).run(new Date().toISOString());
  db.prepare('DELETE FROM sessions WHERE expires_at<?').run(new Date().toISOString());
  const app = createApp();
  const server = app.listen(PORT, HOST, () => console.log(`Nexus AI Workspace API listening on http://${HOST}:${PORT}`));
  server.requestTimeout = 120_000;
  server.headersTimeout = 30_000;
  return server;
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invoked) startServer();
