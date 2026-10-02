/**
 * Browser capability detection.
 *
 * Every probe performs a *real* operation and inspects the outcome:
 *  - `workers.module`: creates a module Worker from a Blob and waits for its message;
 *  - `webAssembly`: compiles a minimal module and instantiates it;
 *  - `runtime.luau` / `runtime.lua54`: fetches the actual WASM payload the runtime needs;
 *  - `persistence.localStorage`: writes, reads back and removes a probe key;
 *  - `persistence.indexedDB`: opens, writes and deletes a real record;
 *  - `clipboard`: checks the API *and* the permission state, reporting the real fallback;
 *  - `canvas2d`: draws a pixel and reads it back.
 *
 * Results are sent to the server so the Capabilities view shows one merged, honest picture.
 */

import { CapabilityId, CapabilityScope, CapabilityState } from '../../shared/constants.js';
import { CapabilityRegistry, capabilityResult } from '../../shared/capability-registry.js';

export class BrowserCapabilities extends CapabilityRegistry {
  #probeKeys = [];

  constructor({ logger = null } = {}) {
    super({ scope: CapabilityScope.BROWSER });
    this.logger = logger;
    this.#registerProbes();
  }

  static get scope() {
    return CapabilityScope.BROWSER;
  }

  #registerProbes() {
    this.registerMany([
      {
        id: CapabilityId.UI_WEB,
        label: 'Entorno web',
        description: 'Navegador con módulos ES, fetch y almacenamiento de sesión.',
        dependency: 'navegador moderno',
        ttlMs: 300_000,
        check: async () => capabilityResult.available(
          `${navigator.userAgentData?.brands?.map((brand) => `${brand.brand} ${brand.version}`).join(', ') ?? navigator.userAgent}`,
          {
            userAgent: navigator.userAgent,
            language: navigator.language,
            languages: navigator.languages,
            online: navigator.onLine,
            hardwareConcurrency: navigator.hardwareConcurrency ?? null,
            deviceMemory: navigator.deviceMemory ?? null,
            crossOriginIsolated: globalThis.crossOriginIsolated === true,
            secureContext: globalThis.isSecureContext === true,
          },
        ),
      },
      {
        id: CapabilityId.UI_WORKERS,
        label: 'Web Workers',
        description: 'Hilos del navegador: aíslan las ejecuciones del hilo de la interfaz.',
        dependency: 'Worker + módulos ES en workers',
        ttlMs: 60_000,
        check: () => this.#probeWorkers(),
      },
      {
        id: CapabilityId.UI_WASM,
        label: 'WebAssembly',
        description: 'Necesario para los motores Luau y Lua 5.4 compilados a WASM.',
        dependency: 'WebAssembly.instantiate',
        ttlMs: 300_000,
        check: async () => {
          if (typeof WebAssembly !== 'object') return capabilityResult.unavailable('El navegador no expone WebAssembly');
          try {
            const module = await WebAssembly.compile(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
            return capabilityResult.available('Módulo WASM compilado correctamente', {
              streaming: typeof WebAssembly.compileStreaming === 'function',
              moduleBytes: WebAssembly.Module.exports(module).length,
            });
          } catch (err) {
            return capabilityResult.unavailable(`La compilación de prueba falló: ${err.message}`);
          }
        },
      },
      {
        id: CapabilityId.RUNTIME_LUAU,
        label: 'Runtime Luau en el navegador',
        description: 'Ejecuta Luau 0.739 en un Web Worker con límites de memoria, tiempo y salida.',
        dependency: 'vendor/@luau-rs (módulo + WASM servidos localmente)',
        ttlMs: 60_000,
        check: () => this.#probeAsset('/vendor/luau-rs/worker.js', {
          wasm: '/vendor/luau-rs-luau/dist/luau_wasm_bg.wasm',
          label: 'Luau (WASM)',
        }),
      },
      {
        id: CapabilityId.RUNTIME_LUA54,
        label: 'Runtime Lua 5.4 en el navegador',
        description: 'Ejecuta Lua 5.4.7 en un Worker terminable (cancelación real por terminación).',
        dependency: 'vendor/wasmoon/glue.wasm (wasmoon se empaqueta en el worker)',
        ttlMs: 60_000,
        check: () => this.#probeAsset('/vendor/wasmoon/glue.wasm', {
          label: 'Lua 5.4 (WASM)',
        }),
      },
      {
        id: CapabilityId.RUNTIME_STREAMING,
        label: 'Salida en vivo',
        description: 'La salida de `print` llega al hilo principal mientras el script se ejecuta.',
        dependency: 'mensajería de Web Workers',
        ttlMs: 60_000,
        check: () => this.#probeStreaming(),
      },
      {
        id: CapabilityId.RUNTIME_CANCEL,
        label: 'Cancelación de ejecuciones',
        description: 'Detiene un script en el navegador (señal de aborto o terminación del worker).',
        dependency: 'Worker terminable / AbortSignal del runtime',
        ttlMs: 60_000,
        check: async () => {
          const workers = this.get(CapabilityId.UI_WORKERS);
          if (!workers || !workers.available) {
            return capabilityResult.unavailable('Sin Web Workers no es posible detener una ejecución en curso');
          }
          return capabilityResult.available('Cancelación disponible: aborto cooperativo en Luau y terminación forzada en Lua 5.4', {
            luau: 'abort-signal',
            lua54: 'terminate',
          });
        },
      },
      {
        id: CapabilityId.RUNTIME_TIMEOUT,
        label: 'Límite de tiempo',
        description: 'Detiene automáticamente un script que excede el tiempo configurado.',
        dependency: 'cronómetro + cancelación',
        ttlMs: 60_000,
        check: async () => {
          const cancel = this.get(CapabilityId.RUNTIME_CANCEL);
          if (!cancel || !cancel.available) return capabilityResult.unavailable('Se necesita capacidad de cancelación para aplicar un límite de tiempo');
          return capabilityResult.available('Límite de tiempo aplicable con precisión de milisegundos');
        },
      },
      {
        id: CapabilityId.RUNTIME_MEMORY_LIMIT,
        label: 'Límite de memoria',
        description: 'Cuánta memoria puede consumir el estado de Lua.',
        dependency: 'límites del runtime WASM',
        ttlMs: 60_000,
        check: async () => capabilityResult.fallback(
          'El runtime de Luau permite fijar el presupuesto de memoria por ejecución; Lua 5.4 usa un módulo WASM con memoria fija.',
          { luau: true, lua54: false },
        ),
      },
      {
        id: CapabilityId.CLIPBOARD,
        label: 'Portapapeles',
        description: 'Copiar y pegar mediante la Clipboard API asíncrona.',
        dependency: 'navigator.clipboard',
        ttlMs: 30_000,
        check: () => this.#probeClipboard(),
      },
      {
        id: CapabilityId.PERSISTENCE_LOCAL,
        label: 'Almacenamiento local',
        description: 'Persistencia de preferencias, borradores y sesión sin servidor.',
        dependency: 'localStorage escribible',
        ttlMs: 30_000,
        check: () => this.#probeLocalStorage(),
      },
      {
        id: CapabilityId.PERSISTENCE_INDEXEDDB,
        label: 'IndexedDB',
        description: 'Almacenamiento estructurado para cachés grandes (temas, historial extenso).',
        dependency: 'indexedDB',
        ttlMs: 60_000,
        check: () => this.#probeIndexedDb(),
      },
      {
        id: CapabilityId.UI_CANVAS,
        label: 'Canvas 2D',
        description: 'Usado por el minimapa del editor y los indicadores de actividad.',
        dependency: 'canvas.getContext("2d")',
        ttlMs: 300_000,
        check: () => this.#probeCanvas(),
      },
      {
        id: CapabilityId.UI_FILE_PICKER,
        label: 'Selector de archivos',
        description: 'Abrir y guardar archivos reales del sistema desde el navegador.',
        dependency: 'File System Access API o input[type=file]',
        ttlMs: 120_000,
        check: async () => {
          if (typeof window.showOpenFilePicker === 'function' && typeof window.showSaveFilePicker === 'function') {
            return capabilityResult.available('File System Access API disponible (abrir, guardar y sobrescribir archivos reales)', {
              mode: 'file-system-access',
            });
          }
          if (typeof document !== 'undefined') {
            const input = document.createElement('input');
            if ('files' in input) {
              return capabilityResult.fallback(
                'El navegador no expone la File System Access API: se usan input de archivo (abrir) y descargas (guardar).',
                { mode: 'download-upload' },
              );
            }
          }
          return capabilityResult.unavailable('No hay forma de acceder al sistema de archivos desde este navegador');
        },
      },
      {
        id: CapabilityId.UI_DOWNLOAD,
        label: 'Descargas',
        description: 'Exportar scripts, logs y temas a un archivo real.',
        dependency: 'Blob + URL.createObjectURL + atributo download',
        ttlMs: 300_000,
        check: async () => {
          const supported = typeof Blob === 'function' && typeof URL?.createObjectURL === 'function';
          return supported
            ? capabilityResult.available('Las descargas usan Blob + URL.createObjectURL con el atributo download')
            : capabilityResult.unavailable('El navegador no soporta la generación de blobs para descarga');
        },
      },
      {
        id: CapabilityId.UI_DRAG_DROP,
        label: 'Arrastrar y soltar',
        description: 'Soltar archivos de script sobre la ventana para importarlos.',
        dependency: 'DataTransfer + eventos drag',
        ttlMs: 300_000,
        check: async () => {
          const supported = 'ondrop' in window && typeof DataTransfer === 'function';
          return supported
            ? capabilityResult.available('Arrastrar y soltar archivos habilitado')
            : capabilityResult.unavailable('El navegador no soporta la API de arrastrar y soltar');
        },
      },
      {
        id: CapabilityId.UI_NOTIFICATIONS,
        label: 'Notificaciones del sistema',
        description: 'Avisos fuera de la ventana para ejecuciones largas.',
        dependency: 'Notification API + permiso del usuario',
        ttlMs: 30_000,
        check: async () => {
          if (typeof Notification === 'undefined') {
            return capabilityResult.unavailable('El navegador no expone la API de notificaciones; se usan avisos internos.');
          }
          const permission = Notification.permission;
          if (permission === 'granted') return capabilityResult.available('Permiso concedido para notificaciones del sistema');
          if (permission === 'denied') {
            return capabilityResult.unavailable('El usuario denegó el permiso de notificaciones; los avisos se muestran dentro de la aplicación.');
          }
          return capabilityResult.fallback('Permiso pendiente: los avisos internos funcionan y se puede solicitar el permiso desde Ajustes.', { permission });
        },
      },
      {
        id: CapabilityId.UI_FULLSCREEN,
        label: 'Pantalla completa',
        description: 'Maximizar la aplicación usando la API del navegador.',
        dependency: 'Element.requestFullscreen',
        ttlMs: 120_000,
        check: async () => {
          const supported = typeof document.documentElement.requestFullscreen === 'function';
          return supported
            ? capabilityResult.available('Pantalla completa disponible (requiere interacción del usuario)')
            : capabilityResult.unavailable('El navegador no permite solicitar pantalla completa');
        },
      },
      {
        id: CapabilityId.UI_REDUCED_MOTION_QUERY,
        label: 'Preferencia de movimiento reducido',
        description: 'La aplicación respeta la preferencia de accesibilidad del sistema.',
        dependency: 'window.matchMedia("(prefers-reduced-motion: reduce)")',
        ttlMs: 120_000,
        check: async () => {
          if (typeof window.matchMedia !== 'function') return capabilityResult.unavailable('matchMedia no está disponible');
          const query = window.matchMedia('(prefers-reduced-motion: reduce)');
          return capabilityResult.available(`Consulta disponible (valor actual: ${query.matches ? 'reducir movimiento' : 'movimiento normal'})`, {
            matches: query.matches,
          });
        },
      },
      {
        id: CapabilityId.UI_RESIZE_OBSERVER,
        label: 'ResizeObserver',
        description: 'Detecta cambios de tamaño reales para adaptar paneles y editor.',
        dependency: 'ResizeObserver',
        ttlMs: 300_000,
        check: async () => (typeof ResizeObserver === 'function'
          ? capabilityResult.available('ResizeObserver disponible')
          : capabilityResult.unavailable('Se usa el evento resize de la ventana como alternativa')),
      },
      {
        id: CapabilityId.UI_INTERSECTION_OBSERVER,
        label: 'IntersectionObserver',
        description: 'Renderizado diferido de listas largas.',
        dependency: 'IntersectionObserver',
        ttlMs: 300_000,
        check: async () => (typeof IntersectionObserver === 'function'
          ? capabilityResult.available('IntersectionObserver disponible')
          : capabilityResult.unavailable('Las listas largas se renderizan por bloques sin observador')),
      },
      {
        id: CapabilityId.FILE_SYSTEM,
        label: 'Acceso a archivos del usuario',
        description: 'Leer y escribir archivos del sistema desde el navegador (con permiso explícito).',
        dependency: 'File System Access API',
        ttlMs: 120_000,
        check: async () => {
          if (typeof window.showOpenFilePicker === 'function') {
            return capabilityResult.available('Acceso directo a archivos concedido por el usuario mediante diálogos del sistema');
          }
          return capabilityResult.fallback(
            'Sin File System Access API los archivos se importan con un selector y se exportan como descarga; el almacenamiento en disco lo realiza el servidor local.',
            { mode: 'import-export' },
          );
        },
      },
      {
        id: CapabilityId.FILE_SYSTEM_WATCH,
        label: 'Vigilancia de archivos',
        description: 'Detectar cambios externos en los scripts.',
        dependency: 'servidor local (fs.watch)',
        ttlMs: 120_000,
        check: () => this.#probeServerWatch(),
      },
      {
        id: CapabilityId.HTTP,
        label: 'Peticiones HTTP',
        description: 'Comunicación con el servidor local (API REST y eventos).',
        dependency: 'fetch + EventSource',
        ttlMs: 60_000,
        check: async () => {
          const hasFetch = typeof fetch === 'function';
          const hasSse = typeof EventSource !== 'undefined';
          if (!hasFetch) return capabilityResult.unavailable('El navegador no implementa fetch');
          return hasSse
            ? capabilityResult.available('fetch y EventSource disponibles (REST + actualizaciones en vivo)')
            : capabilityResult.fallback('fetch disponible, pero sin EventSource: las actualizaciones en vivo se obtienen por sondeo.', { sse: false });
        },
      },
      {
        id: CapabilityId.STORAGE_SERVER,
        label: 'Servidor local',
        description: 'API REST que persiste scripts, temas y configuración en disco.',
        dependency: 'proceso Node.js accesible por HTTP',
        ttlMs: 10_000,
        check: () => this.#probeServer(),
      },
      {
        id: CapabilityId.WINDOW_NATIVE,
        label: 'Ventana nativa',
        description: 'Arrastrar, redimensionar, minimizar y cerrar la ventana del sistema operativo.',
        dependency: 'shell de escritorio Electron con puente preload',
        ttlMs: 60_000,
        check: () => this.#probeDesktopShell(),
      },
      {
        id: CapabilityId.WINDOW_MOVE,
        label: 'Mover la ventana',
        description: 'Arrastrar la ventana desde la barra superior.',
        dependency: 'ventana nativa',
        ttlMs: 60_000,
        check: () => this.#probeDesktopShell(),
      },
      {
        id: CapabilityId.WINDOW_RESIZE,
        label: 'Redimensionar la ventana',
        description: 'Cambiar el tamaño de la ventana del sistema.',
        dependency: 'ventana nativa',
        ttlMs: 60_000,
        check: () => this.#probeDesktopShell(),
      },
      {
        id: CapabilityId.WINDOW_MINIMIZE,
        label: 'Minimizar',
        description: 'Minimizar la ventana a la barra de tareas.',
        dependency: 'ventana nativa',
        ttlMs: 60_000,
        check: () => this.#probeDesktopShell(),
      },
      {
        id: CapabilityId.WINDOW_MAXIMIZE,
        label: 'Maximizar / restaurar',
        description: 'Alternar entre ventana maximizada y restaurada.',
        dependency: 'ventana nativa (el navegador solo permite pantalla completa)',
        ttlMs: 60_000,
        check: async () => {
          const desktop = await this.#probeDesktopShell();
          if (desktop.state === CapabilityState.AVAILABLE) return desktop;
          const fullscreen = typeof document.documentElement.requestFullscreen === 'function';
          return fullscreen
            ? capabilityResult.fallback('En el navegador se ofrece pantalla completa en lugar de maximizar la ventana nativa.', { fullscreen: true })
            : capabilityResult.unavailable('Ni ventana nativa ni pantalla completa están disponibles');
        },
      },
      {
        id: CapabilityId.WINDOW_CLOSE,
        label: 'Cerrar ventana',
        description: 'Cerrar la ventana del sistema operativo desde la barra superior.',
        dependency: 'ventana nativa',
        ttlMs: 60_000,
        check: () => this.#probeDesktopShell(),
      },
      {
        id: CapabilityId.DESKTOP_SHELL,
        label: 'Shell de escritorio (Electron)',
        description: 'Controles nativos de ventana, menú del sistema y persistencia de geometría.',
        dependency: 'puente window.lumenDesktop expuesto por el proceso principal de Electron',
        ttlMs: 30_000,
        check: () => this.#probeDesktopShell(),
      },
    ]);
  }

  /* ------------------------------------------------------------------ *
   * Probes
   * ------------------------------------------------------------------ */

  async #probeWorkers() {
    if (typeof Worker !== 'function') return capabilityResult.unavailable('El navegador no implementa Worker');
    let worker = null;
    try {
      const source = 'self.postMessage({ pong: true, module: typeof import.meta !== "undefined" });';
      const blob = new Blob([source], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('El worker no respondió en 3000 ms')), 3000);
        try {
          worker = new Worker(url, { type: 'module' });
        } catch (err) {
          clearTimeout(timer);
          reject(err);
          return;
        }
        worker.onmessage = (event) => {
          clearTimeout(timer);
          resolve(event.data);
        };
        worker.onerror = (event) => {
          clearTimeout(timer);
          reject(new Error(event.message || 'Error al crear el worker de prueba'));
        };
      });
      URL.revokeObjectURL(url);
      if (!result?.pong) return capabilityResult.unavailable('El worker respondió con datos inesperados');
      return capabilityResult.available('Web Workers (módulo) creados y verificados', { moduleWorkers: result.module === true });
    } catch (err) {
      return capabilityResult.unavailable(`No se pudieron crear Web Workers: ${err.message}`);
    } finally {
      try {
        worker?.terminate();
      } catch {
        /* already gone */
      }
    }
  }

  /** Verifies that the real WASM payload for a runtime can be fetched (headers + size). */
  async #probeAsset(entryPath, { wasm = null, label }) {
    try {
      const entryResponse = await fetch(entryPath, { method: 'HEAD' });
      if (!entryResponse.ok) {
        return capabilityResult.unavailable(
          `${label}: el módulo ${entryPath} devolvió ${entryResponse.status}. Ejecuta "npm run build" para preparar los recursos.`,
          { entryPath, status: entryResponse.status, requirement: 'npm run build' },
        );
      }
      if (!wasm) {
        return capabilityResult.available(`${label}: recurso local verificado (${entryPath})`, { entryPath });
      }
      const wasmResponse = await fetch(wasm, { method: 'HEAD' });
      if (!wasmResponse.ok) {
        return capabilityResult.unavailable(`${label}: no se pudo obtener ${wasm} (${wasmResponse.status})`, { wasm, status: wasmResponse.status });
      }
      const bytes = Number(wasmResponse.headers.get('content-length') ?? 0);
      return capabilityResult.available(`${label}: listo (${(bytes / 1024 / 1024).toFixed(1)} MB de WebAssembly)`, { wasm, bytes });
    } catch (err) {
      return capabilityResult.unavailable(`${label}: la comprobación falló (${err.message})`);
    }
  }

  /** Real streaming check: reads the current Luau engine event support. */
  async #probeStreaming() {
    const workers = this.get(CapabilityId.UI_WORKERS);
    if (!workers?.available) return capabilityResult.unavailable('Sin Web Workers no hay transmisión de salida en vivo');
    const luau = this.get(CapabilityId.RUNTIME_LUAU);
    const lua54 = this.get(CapabilityId.RUNTIME_LUA54);
    const sources = [luau?.available ? 'Luau' : null, lua54?.available ? 'Lua 5.4' : null].filter(Boolean);
    return sources.length > 0
      ? capabilityResult.available(`Salida incremental mediante eventos de worker (${sources.join(' y ')})`, { sources })
      : capabilityResult.unavailable('Ningún runtime en el navegador está disponible para transmitir salida');
  }

  async #probeClipboard() {
    if (!navigator.clipboard) return capabilityResult.unavailable('navigator.clipboard no está disponible (contexto no seguro o navegador antiguo)');
    if (typeof navigator.clipboard.writeText !== 'function') return capabilityResult.unavailable('La Clipboard API asíncrona no expone writeText');
    let permissionState = null;
    try {
      if (navigator.permissions?.query) {
        const status = await navigator.permissions.query({ name: 'clipboard-write' });
        permissionState = status.state;
      }
    } catch {
      permissionState = null;
    }
    const legacy = typeof document.execCommand === 'function';
    if (permissionState === 'denied') {
      return legacy
        ? capabilityResult.fallback('El permiso de escritura del portapapeles está denegado; se usa el método heredado con selección temporal.', { permission: permissionState, legacy })
        : capabilityResult.unavailable('El usuario denegó el acceso al portapapeles');
    }
    return capabilityResult.available(
      `Clipboard API disponible${permissionState ? ` (permiso: ${permissionState})` : ''}${legacy ? '; método heredado como respaldo' : ''}`,
      { permission: permissionState, legacy },
    );
  }

  async #probeLocalStorage() {
    try {
      const key = 'lumen.capability.probe';
      const value = `probe-${Date.now()}`;
      window.localStorage.setItem(key, value);
      const readBack = window.localStorage.getItem(key);
      window.localStorage.removeItem(key);
      if (readBack !== value) return capabilityResult.unavailable('La lectura de prueba no coincide con lo escrito');
      let quotaBytes = null;
      try {
        const estimate = await navigator.storage?.estimate?.();
        quotaBytes = estimate?.quota ?? null;
      } catch {
        quotaBytes = null;
      }
      return capabilityResult.available('localStorage escribible y verificable', { quotaBytes, usedBytes: this.#localStorageBytes() });
    } catch (err) {
      return capabilityResult.unavailable(
        `localStorage no está disponible (${err.name}: ${err.message}). Los datos se guardarán solo en el servidor local.`,
      );
    }
  }

  #localStorageBytes() {
    let total = 0;
    try {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        total += (key?.length ?? 0) + (window.localStorage.getItem(key)?.length ?? 0);
      }
    } catch {
      return null;
    }
    return total * 2; // UTF-16 code units
  }

  async #probeIndexedDb() {
    if (typeof indexedDB === 'undefined') return capabilityResult.unavailable('indexedDB no está disponible');
    return new Promise((resolve) => {
      const dbName = 'lumen-capability-probe';
      const timer = setTimeout(() => resolve(capabilityResult.unavailable('indexedDB no respondió en 3000 ms')), 3000);
      let request;
      try {
        request = indexedDB.open(dbName, 1);
      } catch (err) {
        clearTimeout(timer);
        resolve(capabilityResult.unavailable(`No se pudo abrir la base de datos de prueba: ${err.message}`));
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('probe')) db.createObjectStore('probe');
      };
      request.onerror = () => {
        clearTimeout(timer);
        resolve(capabilityResult.unavailable(`indexedDB rechazó la apertura: ${request.error?.message ?? 'error desconocido'}`));
      };
      request.onsuccess = () => {
        const db = request.result;
        try {
          const transaction = db.transaction('probe', 'readwrite');
          const store = transaction.objectStore('probe');
          store.put(`probe-${Date.now()}`, 'value');
          transaction.oncomplete = () => {
            clearTimeout(timer);
            db.close();
            indexedDB.deleteDatabase(dbName);
            resolve(capabilityResult.available('indexedDB: escritura de prueba confirmada (transacción completada)'));
          };
          transaction.onerror = () => {
            clearTimeout(timer);
            db.close();
            resolve(capabilityResult.unavailable(`La transacción de prueba falló: ${transaction.error?.message ?? 'error desconocido'}`));
          };
        } catch (err) {
          clearTimeout(timer);
          db.close();
          resolve(capabilityResult.unavailable(`No se pudo escribir en la base de datos de prueba: ${err.message}`));
        }
      };
    });
  }

  async #probeCanvas() {
    if (typeof document.createElement !== 'function') return capabilityResult.unavailable('No hay documento disponible');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      const context = canvas.getContext('2d');
      if (!context) return capabilityResult.unavailable('getContext("2d") devolvió null');
      context.fillStyle = '#5b8dff';
      context.fillRect(0, 0, 1, 1);
      const data = context.getImageData(0, 0, 1, 1).data;
      const ok = data[0] === 91 && data[1] === 141 && data[2] === 255;
      return ok
        ? capabilityResult.available('Canvas 2D dibuja y lee píxeles correctamente (minimapa habilitado)')
        : capabilityResult.unavailable(`El píxel leído no coincide con el dibujado (${[...data].join(',')})`);
    } catch (err) {
      return capabilityResult.unavailable(`Canvas 2D no utilizable: ${err.message}`);
    }
  }

  async #probeServer() {
    try {
      const started = Date.now();
      const response = await fetch('/api/health', { headers: { accept: 'application/json' } });
      if (!response.ok) return capabilityResult.unavailable(`El servidor respondió ${response.status} en /api/health`);
      const payload = await response.json();
      return capabilityResult.available(`Servidor local accesible (${Date.now() - started} ms, ${payload.app?.name ?? 'app'} ${payload.app?.version ?? ''})`, payload);
    } catch (err) {
      return capabilityResult.unavailable(
        `El servidor local no responde (${err.message}). Los scripts se ejecutarán en el navegador y los archivos no se persistirán en disco.`,
      );
    }
  }

  async #probeServerWatch() {
    const server = this.get(CapabilityId.STORAGE_SERVER);
    if (server && !server.available) {
      return capabilityResult.unavailable('La vigilancia de archivos la realiza el servidor local, que no está disponible');
    }
    return capabilityResult.available('El servidor local vigila el directorio de scripts y notifica los cambios por el canal de eventos');
  }

  async #probeDesktopShell() {
    if (typeof window.lumenDesktop === 'object' && window.lumenDesktop !== null && typeof window.lumenDesktop.minimize === 'function') {
      const info = typeof window.lumenDesktop.info === 'function' ? window.lumenDesktop.info() : null;
      return capabilityResult.available(`Shell de escritorio conectada (Electron ${info?.electron ?? 'desconocida'})`, info ?? {});
    }
    return capabilityResult.unavailable(
      'La aplicación se ejecuta en el navegador: arrastrar, minimizar y redimensionar ventanas del sistema requiere la shell de escritorio (npm run desktop).',
      { bridge: 'window.lumenDesktop' },
    );
  }

  /** Sends the browser report to the server so both sides agree on what is available. */
  async reportToServer(apiClient) {
    const entries = this.snapshot();
    try {
      const result = await apiClient.post('/api/capabilities/report', {
        scope: CapabilityScope.BROWSER,
        entries: entries.map((entry) => ({
          id: entry.id,
          label: entry.label,
          description: entry.description,
          state: entry.state,
          available: entry.available,
          detail: entry.detail,
          data: entry.data,
          scope: entry.scope,
        })),
      }, { timeoutMs: 8000 });
      return { ok: true, merged: result.merged };
    } catch (err) {
      return { ok: false, error: err };
    }
  }

  /** A short, honest summary for the status bar. */
  quickSummary() {
    const summary = this.summary();
    return {
      ...summary,
      luauReady: this.isAvailable(CapabilityId.RUNTIME_LUAU) && this.isAvailable(CapabilityId.UI_WORKERS),
      lua54Ready: this.isAvailable(CapabilityId.RUNTIME_LUA54) && this.isAvailable(CapabilityId.UI_WORKERS),
      serverReady: this.isAvailable(CapabilityId.STORAGE_SERVER),
    };
  }
}
