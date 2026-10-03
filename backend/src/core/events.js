import { EventEmitter } from 'node:events';

/**
 * Internal event bus connecting services (chat streaming, task runner,
 * approvals) with SSE endpoints.
 */
export const bus = new EventEmitter();
bus.setMaxListeners(200);

export function emit(channel, event) {
  bus.emit(channel, { ...event, at: Date.now() });
}

/**
 * Attach an SSE stream to a response. Returns a `send(event)` function and
 * automatically cleans up on disconnect.
 */
export function attachSSE(req, res, { heartbeatMs = 15000 } = {}) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* closed */ }
  }, heartbeatMs);

  let closed = false;
  const onClose = () => { closed = true; clearInterval(heartbeat); };
  // NOTE: only the *response* closing means the client went away.
  // (req 'close' fires as soon as Express finishes reading the request body.)
  res.on('close', onClose);
  res.on('error', onClose);

  return {
    get closed() { return closed; },
    send(event, data) {
      if (closed) return false;
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        return true;
      } catch {
        closed = true;
        return false;
      }
    },
    close() {
      onClose();
      try { res.end(); } catch { /* already closed */ }
    },
  };
}
