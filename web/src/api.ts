let csrfToken = '';
export function setCsrfToken(value: string) { csrfToken = value; }

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.name = 'ApiError'; this.status = status; }
}

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
  if (init.body && !isForm && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const method = (init.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) headers.set('X-CSRF-Token', csrfToken);
  const response = await fetch(`/api${path.startsWith('/') ? path : `/${path}`}`, { ...init, headers, credentials: 'same-origin' });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json().catch(() => ({})) : await response.text().catch(() => '');
  if (!response.ok) {
    const message = typeof payload === 'string' ? payload : payload?.error || payload?.message || `Error ${response.status}`;
    throw new ApiError(message, response.status);
  }
  return payload as T;
}

export function jsonBody(value: unknown) { return JSON.stringify(value); }

export async function uploadFile(file: File) {
  const body = new FormData(); body.append('file', file);
  return api<{ id: string; name: string; mimeType: string; size: number; isImage: boolean }>('/uploads', { method: 'POST', body });
}

export type StreamHandlers = {
  onDelta: (text: string) => void;
  onStatus?: (status: any) => void;
  onTool?: (tool: any) => void;
  onError?: (message: string) => void;
  onDone?: (payload: any) => void;
};

export async function streamChat(chatId: string, payload: Record<string, unknown>, signal: AbortSignal, handlers: StreamHandlers) {
  const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'text/event-stream' });
  if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
  const requestId = String(payload.requestId || crypto.randomUUID());
  headers.set('Idempotency-Key', requestId);
  const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}/messages`, {
    method: 'POST', headers, credentials: 'same-origin', signal, body: JSON.stringify({ ...payload, requestId }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(data?.error || `Error ${response.status}`, response.status);
  }
  if (!response.body) throw new Error('El navegador no permite leer la respuesta en streaming.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let donePayload: any = null;
  const dispatch = (block: string) => {
    const lines = block.replace(/\r/g, '').split('\n');
    const eventType = lines.find((line) => line.startsWith('event:'))?.slice(6).trim() || 'message';
    const raw = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
    if (!raw) return;
    let data: any;
    try { data = JSON.parse(raw); } catch { data = { text: raw }; }
    if (eventType === 'delta') handlers.onDelta(String(data.text || ''));
    else if (eventType === 'status') handlers.onStatus?.(data);
    else if (eventType === 'tool') handlers.onTool?.(data);
    else if (eventType === 'error') handlers.onError?.(String(data.error || 'Error del proveedor.'));
    else if (eventType === 'done') { donePayload = data; handlers.onDone?.(data); }
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        dispatch(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
      }
    }
    if (buffer.trim()) dispatch(buffer);
  } finally { reader.releaseLock(); }
  return donePayload;
}
