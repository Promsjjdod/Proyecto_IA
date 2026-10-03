export type SSEHandler = (event: string, data: any) => void;

/**
 * POST-based Server-Sent Events reader (the completion endpoint is a POST).
 * Returns an abort function.
 */
export function postSSE(path: string, body: unknown, onEvent: SSEHandler, onEnd?: () => void): () => void {
  const controller = new AbortController();
  (async () => {
    try {
      const res = await fetch(`/api${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(body),
        signal: controller.signal,
        credentials: 'same-origin',
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        let message = `Request failed (${res.status})`;
        try { message = JSON.parse(text)?.error?.message || message; } catch { /* keep */ }
        onEvent('error', { message, code: `HTTP_${res.status}` });
        onEnd?.();
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          let event = 'message';
          const dataLines: string[] = [];
          for (const line of chunk.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
          }
          if (!dataLines.length) continue;
          let data: any = null;
          try { data = JSON.parse(dataLines.join('\n')); } catch { data = dataLines.join('\n'); }
          onEvent(event, data);
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        onEvent('error', { message: err?.message || 'Connection lost.', code: 'NETWORK' });
      }
    } finally {
      onEnd?.();
    }
  })();
  return () => controller.abort();
}

/** GET-based SSE (task progress streams). */
export function getSSE(path: string, onEvent: SSEHandler): () => void {
  const controller = new AbortController();
  (async () => {
    try {
      const res = await fetch(`/api${path}`, { signal: controller.signal, headers: { Accept: 'text/event-stream' }, credentials: 'same-origin' });
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          let event = 'message';
          const dataLines: string[] = [];
          for (const line of chunk.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
          }
          if (!dataLines.length) continue;
          let data: any = null;
          try { data = JSON.parse(dataLines.join('\n')); } catch { data = null; }
          onEvent(event, data);
        }
      }
    } catch { /* aborted */ }
  })();
  return () => controller.abort();
}
