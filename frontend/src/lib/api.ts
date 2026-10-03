export class ApiError extends Error {
  code: string;
  status: number;
  errorId?: string;
  details?: { field: string; message: string }[];
  constructor(status: number, code: string, message: string, errorId?: string, details?: { field: string; message: string }[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.errorId = errorId;
    this.details = details;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) {
    const err = json?.error || {};
    throw new ApiError(res.status, err.code || 'ERROR', err.message || `Request failed (${res.status})`, err.errorId, err.details);
  }
  return json as T;
}

export const api = {
  get: <T = any>(path: string) => request<T>('GET', path),
  post: <T = any>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T = any>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T = any>(path: string) => request<T>('DELETE', path),
  upload: async <T = any>(path: string, form: FormData): Promise<T> => {
    const res = await fetch(`/api${path}`, { method: 'POST', body: form, credentials: 'same-origin' });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, json?.error?.code || 'ERROR', json?.error?.message || 'Upload failed');
    return json as T;
  },
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
