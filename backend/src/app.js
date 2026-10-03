import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config/env.js';
import { createLogger } from './core/logger.js';
import { errorHandler, notFoundHandler } from './core/errors.js';
import { rateLimit } from './core/ratelimit.js';
import { authMiddleware } from './middleware/auth.js';
import { coreRoutes } from './routes/core.routes.js';
import { chatRoutes } from './routes/chat.routes.js';
import { providerRoutes } from './routes/provider.routes.js';
import { agentRoutes } from './routes/agent.routes.js';
import { pluginRoutes } from './routes/plugin.routes.js';
import { taskRoutes } from './routes/task.routes.js';
import { fileRoutes } from './routes/file.routes.js';
import { mediaRoutes } from './routes/media.routes.js';
import { githubRoutes } from './routes/github.routes.js';

const log = createLogger('http');

function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;
  const allowed = config.corsOrigins.includes('*') || (origin && config.corsOrigins.includes(origin.replace(/\/$/, '')));
  if (origin && allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    if (origin && allowed) {
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Max-Age', '600');
      res.status(204).end();
      return;
    }
    if (config.corsOrigins.includes('*')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.status(204).end();
      return;
    }
    res.status(403).json({ error: { code: 'CORS', message: 'Origin not allowed.' } });
    return;
  }
  next();
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  app.use(helmet({
    contentSecurityPolicy: false, // the SPA sets its own meta; local tool serves inline SVG previews
    crossOriginEmbedderPolicy: false,
  }));
  app.use(corsMiddleware);
  app.use(express.json({ limit: '8mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());

  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      if (req.path.startsWith('/api')) {
        log.debug(`${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - started}ms)`);
      }
    });
    next();
  });

  app.use('/api', rateLimit());
  app.use(authMiddleware);

  app.use('/api', coreRoutes);
  app.use('/api', chatRoutes);
  app.use('/api', providerRoutes);
  app.use('/api', agentRoutes);
  app.use('/api', pluginRoutes);
  app.use('/api', taskRoutes);
  app.use('/api', fileRoutes);
  app.use('/api', mediaRoutes);
  app.use('/api', githubRoutes);

  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}
