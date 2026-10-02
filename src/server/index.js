/**
 * Lumen Studio — server entry point.
 *
 * Boots the application context, mounts the REST API, the SSE stream and the static
 * interface, then reports the real state of every subsystem. It can also be imported
 * (`createServer`) so tests and the Electron shell can embed it.
 */

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP, ErrorKind, HttpStatus, LogLevel } from '../shared/constants.js';
import { toAppError } from '../shared/errors.js';
import { AppContext } from './AppContext.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {{ port?: number, host?: string, dataDir?: string, projectRoot?: string, build?: boolean, watch?: boolean, logLevel?: string, onFatal?: Function }} [options]
 */
export async function createServer(options = {}) {
  const context = new AppContext({ options });
  const initReport = await context.init({
    buildIfNeeded: options.build !== false,
    watch: options.watch === true,
  });

  const server = http.createServer((req, res) => {
    void handleRequest(context, req, res);
  });

  server.on('clientError', (err, socket) => {
    if (socket.destroyed) return;
    context.errorHandler.report(toAppError(err, {
      kind: ErrorKind.NETWORK,
      message: 'Petición HTTP inválida recibida',
    }), { source: 'http.clientError', silent: true });
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  return { context, server, initReport };
}

async function handleRequest(context, req, res) {
  const startedAt = Date.now();
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    // Server-Sent Events channel.
    if (url.pathname === '/api/events') {
      if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
        res.writeHead(HttpStatus.BAD_REQUEST, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: { message: 'El stream SSE solo admite GET' } }));
        return;
      }
      context.sse.open(req, res, { clientId: url.searchParams.get('client') ?? null });
      return;
    }

    // REST API.
    // (`router.handle` returns true when the request belonged to the API namespace.)
    const handled = await context.router.handle(req, res, { context });
    if (handled) return;

    // Static interface (build output, vendor WASM, SPA shell).
    const served = await context.static.serve(req, res, url.pathname);
    if (served) return;

    if (!res.headersSent) {
      res.writeHead(HttpStatus.NOT_FOUND, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: false,
        error: {
          message: `No se encontró ${req.method} ${url.pathname}`,
          hint: context.ready
            ? 'Comprueba la ruta o abre la raíz "/" para la interfaz.'
            : 'La aplicación aún no ha terminado de inicializarse.',
        },
      }));
    }
  } catch (err) {
    const appError = toAppError(err, { kind: ErrorKind.INTERNAL, message: 'Error no controlado atendiendo la petición' });
    context.errorHandler.report(appError, { source: 'http.handler' });
    if (!res.headersSent) {
      res.writeHead(HttpStatus.INTERNAL, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: appError.toJSON() }));
    } else {
      res.end();
    }
  } finally {
    const duration = Date.now() - startedAt;
    if (duration > 2000) {
      context.logger.log(LogLevel.WARNING, `Petición lenta: ${req.method} ${req.url} (${duration} ms)`, { source: 'http' });
    }
  }
}

/** Starts a server and resolves once the port is listening. */
export async function startServer(options = {}) {
  const { context, server, initReport } = await createServer(options);
  const port = resolvePort(options.port);
  const host = options.host ?? process.env[APP.hostEnvVar] ?? APP.defaultHost;

  await new Promise((resolve, reject) => {
    server.once('error', (err) => {
      reject(toAppError(err, {
        kind: ErrorKind.NETWORK,
        code: err.code === 'EADDRINUSE' ? 'E_ALREADY_EXISTS' : undefined,
        message: `No se pudo escuchar en ${host}:${port}`,
        detail: { host, port, errno: err.code ?? null },
      }));
    });
    server.listen(port, host, () => resolve());
  });

  const address = server.address();
  return {
    context,
    server,
    initReport,
    address: typeof address === 'object' && address !== null ? { host: address.address, port: address.port } : { host, port },
    close: async () => {
      await new Promise((resolve) => server.close(() => resolve()));
      return context.shutdown({ reason: 'server.close' });
    },
  };
}

/**
 * Resolves the listening port from (in order): explicit option, env var, default.
 * Returns a real integer, falling back to the default when the value is not a valid port.
 */
export function resolvePort(explicit) {
  const candidates = [explicit, process.env[APP.portEnvVar]];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null || candidate === '') continue;
    const parsed = typeof candidate === 'number' ? candidate : Number.parseInt(String(candidate), 10);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535) return parsed;
  }
  return APP.defaultPort;
}

/** CLI entry point. */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const port = resolvePort(args.port);
  const host = typeof args.host === 'string' ? args.host : process.env[APP.hostEnvVar] ?? APP.defaultHost;
  const dataDir = args['data-dir'] ?? process.env[APP.dataDirEnvVar] ?? null;

  let instance;
  try {
    instance = await startServer({
      port,
      host,
      dataDir: dataDir ? path.resolve(dataDir) : undefined,
      build: args['no-build'] !== true,
      watch: args.watch === true,
      logLevel: args.quiet ? LogLevel.INFO : LogLevel.TRACE,
    });
  } catch (err) {
    const appError = toAppError(err, { kind: ErrorKind.INTERNAL });
    // eslint-disable-next-line no-console
    console.error(`\n[${APP.name}] No se pudo iniciar el servidor: ${appError.message}`);
    if (appError.detail) console.error(JSON.stringify(appError.detail, null, 2));
    process.exit(1);
  }

  const { context, server, address, initReport, close } = instance;
  const banner = buildBanner(context, address, initReport, server);
  process.stdout.write(banner);

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`\n[${APP.name}] Cerrando (${signal})…\n`);
    const result = await close();
    const failed = result.results.filter((entry) => !entry.ok);
    if (failed.length > 0) {
      process.stdout.write(`[${APP.name}] Pasos de cierre con problemas: ${failed.map((entry) => entry.name).join(', ')}\n`);
    }
    process.stdout.write(`[${APP.name}] Cerrado.\n`);
    process.exit(failed.length > 0 ? 1 : 0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

function buildBanner(context, address, initReport, server) {
  const steps = initReport.steps ?? [];
  const ok = steps.filter((entry) => entry.ok).length;
  const capabilities = context.capabilities.snapshot();
  const available = capabilities.filter((entry) => entry.available);
  const unavailable = capabilities.filter((entry) => !entry.available && entry.scope === 'server');
  const engines = context.runtime.engines.map((engine) => engine.status());
  const lines = [];
  lines.push('');
  lines.push(`  ${APP.name} ${APP.version} — ${APP.description}`);
  lines.push('  ' + '─'.repeat(68));
  lines.push(`  Interfaz         http://${address.host === '0.0.0.0' ? 'localhost' : address.host}:${address.port}/`);
  lines.push(`  API              http://localhost:${address.port}/api/health`);
  lines.push(`  Eventos (SSE)    http://localhost:${address.port}/api/events`);
  lines.push(`  Datos            ${context.storage.root}`);
  lines.push(`  Log              ${context.logger.fileStatus.path ?? '(consola)'}`);
  lines.push('  ' + '─'.repeat(68));
  lines.push(`  Inicialización   ${ok}/${steps.length} pasos correctos en ${steps.reduce((sum, entry) => sum + (entry.ms ?? 0), 0)} ms`);
  for (const step of steps) {
    lines.push(`    ${step.ok ? '✔' : '✖'} ${step.name.padEnd(16)} ${step.ok ? `${step.ms} ms` : step.error?.message ?? 'falló'}`);
  }
  lines.push('  ' + '─'.repeat(68));
  lines.push(`  Scripts          ${context.scripts.stats().total} guardados`);
  lines.push(`  Plugins          ${context.plugins.stats().total} detectados (${context.plugins.stats().enabled} activos)`);
  lines.push(`  Motores          ${engines.map((engine) => `${engine.id}${engine.active > 0 ? ` (${engine.active} activos)` : ''}`).join(', ')}`);
  lines.push(`  Capacidades      ${available.length} disponibles · ${unavailable.length} no disponibles en el servidor`);
  for (const entry of unavailable.slice(0, 8)) {
    lines.push(`    · ${entry.id}: ${String(entry.detail ?? '').slice(0, 90)}`);
  }
  if (unavailable.length > 8) lines.push(`    · … y ${unavailable.length - 8} más (ver /api/capabilities)`);
  lines.push(`  Conexiones SSE   ${context.sse.clientCount} activas`);
  lines.push(`  Compilación      ${context.build.builtAt ? new Date(context.build.builtAt).toLocaleTimeString() : 'pendiente'}`);
  if (server.listening) lines.push('  ' + '─'.repeat(68));
  lines.push(`  Ctrl+C para detener.`);
  lines.push('');
  return lines.join('\n');
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      const numeric = Number(next);
      args[key] = Number.isFinite(numeric) && String(numeric) === next ? numeric : next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[${APP.name}] Error fatal:`, err);
    process.exit(1);
  });
}

export { HERE };
