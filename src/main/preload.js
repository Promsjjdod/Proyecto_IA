/**
 * Preload de Electron — única superficie que el renderer ve del sistema anfitrión.
 *
 * Expone `window.lumenDesktop` con un contrato pequeño y explícito. El renderer no tiene acceso
 * a Node ni a IPC arbitrario: solo a estas funciones, que se limitan a operaciones de ventana y
 * al diálogo nativo. Si el objeto no existe (versión de navegador), la interfaz detecta que la
 * ventana nativa no está disponible y lo informa como capacidad no disponible.
 */

const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_ACTIONS = new Set(['minimize', 'maximize', 'close', 'toggle-fullscreen', 'center', 'reset-geometry']);

contextBridge.exposeInMainWorld('lumenDesktop', {
  version: 1,
  kind: 'electron',
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  window: {
    state: () => ipcRenderer.invoke('lumen:window:state'),
    action: (name) => {
      if (!ALLOWED_ACTIONS.has(name)) return Promise.resolve({ ok: false, reason: `acción no permitida: ${name}` });
      return ipcRenderer.invoke('lumen:window:action', name);
    },
    minimize: () => ipcRenderer.invoke('lumen:window:action', 'minimize'),
    toggleMaximize: () => ipcRenderer.invoke('lumen:window:action', 'maximize'),
    close: () => ipcRenderer.invoke('lumen:window:action', 'close'),
    onStateChange: (listener) => {
      if (typeof listener !== 'function') return () => {};
      const handler = (_event, state) => listener(state);
      ipcRenderer.on('lumen:window:state', handler);
      return () => ipcRenderer.removeListener('lumen:window:state', handler);
    },
  },
  dialog: {
    message: (options) => ipcRenderer.invoke('lumen:dialog:message', options ?? {}),
  },
  path: {
    forFile: (name) => ipcRenderer.invoke('lumen:path:forFile', name),
  },
});
