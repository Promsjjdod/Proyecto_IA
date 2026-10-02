/**
 * SseHub — Server-Sent Events fan-out with real back-pressure handling.
 *
 * SSE is used instead of WebSockets on purpose: it is a plain HTTP response, survives proxies
 * that do not upgrade connections, reconnects automatically in the browser, and is all the app
 * needs (server → client push; commands travel over the REST API). Channels are named
 * (`log`, `runtime.output`, `settings.changed`, …) and each client keeps a small per-channel
 * backlog with its `Last-Event-ID`, so a reconnect does not lose the events that mattered.
 */

import { SseEvent } from '../../shared/constants.js';

const HEARTBEAT_MS = 20_000;
const BACKLOG_PER_CHANNEL = 50;

export class SseHub {
  #clients = new Map();
  #nextId = 1;
  #backlog = new Map();
  #heartbeat = null;
  #stats = { connections: 0, totalConnections: 0, sent: 0, dropped: 0, reconnects: 0 };

  constructor({ logger, bus = null, errorHandler = null, heartbeatMs = HEARTBEAT_MS } = {}) {
    this.logger = logger;
    this.bus = bus;
    this.errorHandler = errorHandler;
    this.heartbeatMs = heartbeatMs;
  }

  /** Alias used by the HTTP layer (`context.sse.open(req, res, …)`). */
  open(req, res, options = {}) {
    return this.add(req, res, options);
  }

  /**
   * Mirrors real application events onto the SSE channels.
   * Only events that correspond to something that actually happened are forwarded.
   */
  subscribeToBus() {
    if (!this.bus) return { subscribed: false, reason: 'sin bus de eventos' };
    const channels = [];
    const mirror = (busEvent, channel, mapper = null) => {
      this.bus.on(busEvent, (payload) => {
        this.broadcast(channel, mapper ? mapper(payload) : (payload ?? {}));
      });
      channels.push(busEvent);
    };

    mirror('log:entry', SseEvent.LOG);
    mirror('runtime:queued', SseEvent.RUNTIME_STATE, (payload) => ({ phase: 'queued', ...payload }));
    mirror('runtime:started', SseEvent.RUNTIME_STATE, (payload) => ({ phase: 'started', ...payload }));
    mirror('runtime:output', SseEvent.RUNTIME_OUTPUT);
    mirror('runtime:finished', SseEvent.RUNTIME_FINISHED);
    mirror('runtime:cancel-requested', SseEvent.RUNTIME_STATE, (payload) => ({ phase: 'cancel-requested', ...payload }));
    mirror('script:changed', SseEvent.SCRIPT_CHANGED);
    mirror('scripts:changed', SseEvent.SCRIPT_CHANGED);
    mirror('settings:changed', SseEvent.SETTINGS_CHANGED, (payload) => ({ changed: payload?.changed ?? [], reason: payload?.reason ?? null }));
    mirror('themes:changed', SseEvent.THEME_CHANGED);
    mirror('plugins:changed', SseEvent.PLUGIN_CHANGED);
    mirror('capabilities:changed', SseEvent.CAPABILITIES, (payload) => ({ entries: [payload] }));
    mirror('app:error', SseEvent.ERROR);

    this.logger?.debug?.(`SSE suscrito a ${channels.length} eventos del bus`, { source: 'SseHub' });
    return { subscribed: true, channels };
  }

  get size() {
    return this.#clients.size;
  }

  /** Alias used by the CLI banner. */
  get clientCount() {
    return this.#clients.size;
  }

  /**
   * Attaches an HTTP response as an SSE client.
   * The initial `hello` frame carries the channels, the server time and the capability snapshot
   * the client needs to render the connection state truthfully.
   */
  add(req, res, { clientId = null, hello = {} } = {}) {
    const id = clientId ?? `sse-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': lumen stream\n\n');

    const client = {
      id,
      res,
      channels: new Set(Object.values(SseEvent)),
      connectedAt: Date.now(),
      sent: 0,
      lastEventId: Number.parseInt(req.headers['last-event-id'] ?? '0', 10) || 0,
    };
    this.#clients.set(id, client);
    this.#stats.connections = this.#clients.size;
    this.#stats.totalConnections += 1;
    if (client.lastEventId > 0) this.#stats.reconnects += 1;

    this.send(id, SseEvent.HELLO, {
      clientId: id,
      serverTime: Date.now(),
      channels: [...client.channels],
      heartbeatMs: this.heartbeatMs,
      backlog: this.#backlogSize(),
      ...hello,
    });

    // Replay what the client missed while disconnected (bounded).
    if (client.lastEventId > 0 && this.#backlog.size > 0) {
      let replayed = 0;
      for (client.lastEventId += 1; ; client.lastEventId += 1) {
        const frame = this.#frameById(client.lastEventId);
        if (!frame) break;
        this.#write(client, frame);
        replayed += 1;
        if (replayed > 200) break;
      }
      if (replayed > 0) this.logger?.debug?.(`Se reenviaron ${replayed} eventos a ${id}`, { source: 'SseHub' });
    }

    const cleanup = () => {
      if (!this.#clients.has(id)) return;
      this.#clients.delete(id);
      this.#stats.connections = this.#clients.size;
      this.logger?.debug?.(`Cliente SSE desconectado: ${id}`, { source: 'SseHub' });
    };
    req.on('close', cleanup);
    req.on('error', cleanup);
    res.on('error', cleanup);
    this.#ensureHeartbeat();
    this.logger?.debug?.(`Cliente SSE conectado: ${id}`, { source: 'SseHub' });
    return id;
  }

  /** Sends one event to one client. */
  send(clientId, event, data) {
    const client = this.#clients.get(clientId);
    if (!client) return false;
    return this.#write(client, this.#frame(event, data));
  }

  /** Sends one event to every client (optionally filtered by channel). */
  broadcast(event, data, { except = null } = {}) {
    const frame = this.#frame(event, data);
    let sent = 0;
    for (const client of this.#clients.values()) {
      if (client.id === except) continue;
      if (!client.channels.has(event)) continue;
      if (this.#write(client, frame)) sent += 1;
    }
    return sent;
  }

  /**
   * Pushes a log entry to the log channel.
   * Kept separate from `broadcast` so log volume can be filtered in one place.
   */
  log(entry) {
    return this.broadcast(SseEvent.LOG, entry);
  }

  #write(client, frame) {
    try {
      // Real back-pressure guard: if the socket is full, drop this frame instead of buffering
      // without limit (the client resyncs from the REST API on reconnect).
      if (client.res.writableLength > 1_000_000) {
        this.#stats.dropped += 1;
        return false;
      }
      client.res.write(frame);
      client.sent += 1;
      this.#stats.sent += 1;
      return true;
    } catch (err) {
      this.#clients.delete(client.id);
      this.#stats.connections = this.#clients.size;
      this.logger?.warn?.(`Error al escribir en el flujo SSE de ${client.id}: ${err.message}`, { source: 'SseHub' });
      return false;
    }
  }

  #frame(event, data) {
    const id = this.#nextId++;
    const payload = JSON.stringify({ ...data, __meta: { id, event, at: Date.now() } });
    this.#remember(event, id, payload);
    return `id: ${id}\nevent: ${event}\ndata: ${payload}\n\n`;
  }

  #remember(event, id, payload) {
    let entry = this.#backlog.get(event);
    if (!entry) {
      entry = [];
      this.#backlog.set(event, entry);
    }
    entry.push({ id, payload });
    while (entry.length > BACKLOG_PER_CHANNEL) entry.shift();
  }

  #frameById(id) {
    for (const entry of this.#backlog.values()) {
      const found = entry.find((item) => item.id === id);
      if (found) return `id: ${found.id}\ndata: ${found.payload}\n\n`;
    }
    return null;
  }

  #backlogSize() {
    let total = 0;
    for (const entry of this.#backlog.values()) total += entry.length;
    return total;
  }

  #ensureHeartbeat() {
    if (this.#heartbeat !== null) return;
    this.#heartbeat = setInterval(() => {
      if (this.#clients.size === 0) {
        clearInterval(this.#heartbeat);
        this.#heartbeat = null;
        return;
      }
      this.broadcast(SseEvent.PING, { at: Date.now(), clients: this.#clients.size });
    }, this.heartbeatMs);
    this.#heartbeat.unref?.();
  }

  /** Closes every stream (graceful shutdown). */
  closeAll(reason = 'El servidor se está deteniendo') {
    const closed = this.#clients.size;
    for (const client of this.#clients.values()) {
      try {
        client.res.write(`event: ${SseEvent.ERROR}\ndata: ${JSON.stringify({ reason, fatal: true })}\n\n`);
        client.res.end();
      } catch {
        /* the socket is already gone */
      }
    }
    this.#clients.clear();
    this.#stats.connections = 0;
    if (this.#heartbeat !== null) {
      clearInterval(this.#heartbeat);
      this.#heartbeat = null;
    }
    return { closed };
  }

  stats() {
    return {
      ...this.#stats,
      connections: this.#clients.size,
      backlog: this.#backlogSize(),
      clients: [...this.#clients.values()].map((client) => ({
        id: client.id,
        connectedAt: client.connectedAt,
        sent: client.sent,
        lagMs: Date.now() - client.connectedAt,
      })),
    };
  }
}
