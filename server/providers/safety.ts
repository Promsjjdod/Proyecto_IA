import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { Agent, fetch as undiciFetch } from 'undici';
import type { RequestInit as UndiciRequestInit } from 'undici';
import type { ProviderRecord } from './types.js';
type SafeRequestInit = Omit<UndiciRequestInit, 'dispatcher'>;

type ResolvedAddress = { address: string; family: 4 | 6 };

function privateV4(ip: string) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  return p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 192 && p[1] === 0 && p[2] === 0) ||
    (p[0] === 192 && p[1] === 0 && p[2] === 2) ||
    (p[0] === 192 && p[1] === 88 && p[2] === 99) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
    (p[0] === 198 && (p[1] === 18 || p[1] === 19 || (p[1] === 51 && p[2] === 100))) ||
    (p[0] === 203 && p[1] === 0 && p[2] === 113);
}

export function isPrivateAddress(ip: string) {
  const kind = isIP(ip);
  if (kind === 4) return privateV4(ip);
  if (kind === 6) {
    const normal = ip.toLowerCase().split('%')[0];
    if (normal === '::1' || normal === '::' || normal.startsWith('fc') || normal.startsWith('fd') || /^fe[89ab]/.test(normal) || normal.startsWith('ff') ||
      normal.startsWith('2001:db8:') || normal.startsWith('2002:') || normal.startsWith('64:ff9b:')) return true;
    if (normal.startsWith('::ffff:')) return privateV4(normal.slice(7));
    return false;
  }
  return true;
}

function allowedOllamaUrl(url: URL) {
  const allow = (process.env.OLLAMA_ALLOWED_URLS || 'http://localhost:11434,http://127.0.0.1:11434,http://[::1]:11434').split(',').map((x) => x.trim().replace(/\/+$/, '')).filter(Boolean);
  return allow.includes(url.origin.toLowerCase());
}

function normalizeHostname(hostname: string) {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

function isCloudMetadataHost(hostname: string) {
  const host = normalizeHostname(hostname).toLowerCase().replace(/\.$/, '');
  return host === 'metadata.google.internal' || host.endsWith('.metadata.google.internal') || host === 'metadata.azure.com' || host === 'instance-data.ec2.internal';
}
function isCloudMetadataAddress(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0];
  return ['169.254.169.254', '169.254.170.2', '100.100.100.200', 'fd00:ec2::254'].includes(normalized) ||
    (normalized.startsWith('::ffff:') && isCloudMetadataAddress(normalized.slice(7)));
}

async function resolveAddresses(url: URL): Promise<ResolvedAddress[]> {
  const hostname = normalizeHostname(url.hostname);
  const family = isIP(hostname);
  if (family) return [{ address: hostname, family: family as 4 | 6 }];
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((item) => ({ address: item.address, family: item.family as 4 | 6 }));
}

async function resolvePublicAddresses(url: URL) {
  const addresses = await resolveAddresses(url).catch(() => []);
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('El endpoint no resuelve a una dirección pública permitida.');
  }
  return addresses;
}

export async function validateProviderBase(provider: Pick<ProviderRecord, 'type' | 'base_url'>) {
  let url: URL;
  try { url = new URL(provider.base_url); } catch { throw new Error('La URL base no es válida.'); }
  if (url.username || url.password) throw new Error('No incluyas credenciales dentro de la URL base.');
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Solo se admiten endpoints HTTP(S).');
  if (isCloudMetadataHost(url.hostname) || isCloudMetadataAddress(normalizeHostname(url.hostname))) throw new Error('No se permite acceder a endpoints de metadatos de nube.');
  if (provider.type === 'ollama') {
    if (!allowedOllamaUrl(url)) throw new Error(`La dirección de Ollama no está permitida. Añade su origen HTTPS/HTTP exacto a OLLAMA_ALLOWED_URLS (por defecto solo localhost:11434).`);
    const addresses = await resolveAddresses(url);
    if (addresses.some(({ address }) => isCloudMetadataAddress(address))) throw new Error('No se permite acceder a endpoints de metadatos de nube.');
    return url;
  }
  if (url.protocol !== 'https:') throw new Error('Los proveedores externos deben usar HTTPS. HTTP solo se permite para Ollama autorizado.');
  if (!url.hostname || url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || isIP(normalizeHostname(url.hostname))) {
    throw new Error('Los endpoints externos deben usar un nombre de host HTTPS público.');
  }
  await resolvePublicAddresses(url);
  return url;
}

async function pinnedFetch(url: URL, init: SafeRequestInit, addresses: ResolvedAddress[], timeoutMs: number) {
  const hostname = normalizeHostname(url.hostname);
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  const dispatcher = new Agent({
    connect: {
      lookup(requestedHostname, options, callback) {
        if (normalizeHostname(requestedHostname).toLowerCase() !== hostname.toLowerCase()) {
          callback(Object.assign(new Error('La conexión intentó resolver un host distinto al validado.'), { code: 'EHOSTUNREACH' }), '', 0);
          return;
        }
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      },
    },
    connections: 1,
    pipelining: 0,
    connectTimeout: Math.min(timeoutMs, 15_000),
    headersTimeout: Math.min(timeoutMs, 30_000),
    bodyTimeout: timeoutMs,
    maxResponseSize: 20_000_000,
  });
  let disposed = false;
  let cleanupTimer: NodeJS.Timeout;
  const dispose = async (force = false) => {
    if (disposed) return;
    disposed = true;
    clearTimeout(cleanupTimer);
    if (force) await dispatcher.destroy().catch(() => undefined);
    else await dispatcher.close().catch(() => undefined);
  };
  cleanupTimer = setTimeout(() => { void dispose(true); }, timeoutMs + 5_000);
  cleanupTimer.unref();

  try {
    const response = await undiciFetch(url, { ...init, signal, redirect: 'manual', dispatcher });
    if (!response.body) {
      await dispose();
      return new Response(null, { status: response.status, statusText: response.statusText, headers: Object.fromEntries(response.headers.entries()) });
    }
    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            controller.close();
            await dispose();
          } else controller.enqueue(chunk.value);
        } catch (error) {
          controller.error(error);
          await dispose(true);
        }
      },
      async cancel(reason) {
        try { await reader.cancel(reason); } finally { await dispose(true); }
      },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) {
    await dispose(true);
    throw error;
  }
}

/** Validates a public HTTPS destination and pins its resolved addresses for this one request. */
export async function safeExternalFetch(url: URL, init: SafeRequestInit = {}, timeoutMs = 12_000) {
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('La solicitud externa requiere HTTPS y no permite credenciales en la URL.');
  if (isCloudMetadataHost(url.hostname) || isCloudMetadataAddress(normalizeHostname(url.hostname))) throw new Error('No se permite acceder a endpoints de metadatos de nube.');
  const addresses = await resolvePublicAddresses(url);
  const response = await pinnedFetch(url, init, addresses, timeoutMs);
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('El endpoint respondió con una redirección bloqueada por seguridad.');
  }
  return response;
}

export async function safeProviderFetch(provider: ProviderRecord, url: URL, init: SafeRequestInit = {}) {
  const base = await validateProviderBase(provider);
  if (base.origin !== url.origin) throw new Error('La solicitud al proveedor debe conservar el origen configurado.');
  // Ollama is the only provider allowed to reach local addresses, and only at an origin explicitly allowlisted above.
  const addresses = provider.type === 'ollama' ? await resolveAddresses(url) : await resolvePublicAddresses(url);
  if (!addresses.length) throw new Error('El endpoint no pudo resolverse.');
  if (provider.type === 'ollama' && addresses.some(({ address }) => isCloudMetadataAddress(address))) throw new Error('No se permite acceder a endpoints de metadatos de nube.');
  const timeoutMs = 90_000;
  const response = await pinnedFetch(url, init, addresses, timeoutMs);
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('El endpoint del proveedor respondió con una redirección bloqueada por seguridad.');
  }
  return response;
}
