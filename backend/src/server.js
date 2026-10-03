import { config, lanAddresses } from './config/env.js';
import { createLogger } from './core/logger.js';
import { runMigrations } from './database/migrate.js';
import { seed } from './database/seed.js';
import { syncPlugins } from './plugins/manager.js';
import { ensureLocalUser } from './middleware/auth.js';
import { createApp } from './app.js';

const log = createLogger('server');

export function bootstrap() {
  runMigrations();
  seed();
  syncPlugins();
  ensureLocalUser();
}

export function startServer() {
  bootstrap();
  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    log.info(`ForgeAPI listening on http://${config.host}:${config.port} (env: ${config.env})`);
    if (config.lan) {
      for (const addr of lanAddresses()) {
        log.info(`LAN access enabled: http://${addr.address}:${config.port} (${addr.name})`);
      }
    } else {
      log.info('LAN access disabled (FORGEAI_LAN=true to enable on your local network only).');
    }
  });
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  return server;
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isDirectRun || process.env.FORGEAI_START === '1') {
  startServer();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      log.info(`received ${signal}, shutting down`);
      process.exit(0);
    });
  }
}
