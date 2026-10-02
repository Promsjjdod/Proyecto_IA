/**
 * Browser stubs for the Node-only branches of the `wasmoon` bundle.
 *
 * `wasmoon/dist/index.js` is a universal bundle: it contains code paths that `require('url')`
 * and `import('module')` when it detects Node. In the browser those branches are unreachable
 * (the factory loads `glue.wasm` through `fetch`), but a bundler still has to resolve them.
 *
 * These stubs are wired through esbuild aliases (`url` and `module`). They are never called
 * during normal operation; if they ever are, they fail loudly with the real reason instead of
 * pretending to work.
 */

const NOT_AVAILABLE = 'no disponible en el navegador (rama Node de wasmoon)';

export function pathToFileURL(filePath) {
  throw new Error(`pathToFileURL ${NOT_AVAILABLE}: ${filePath}`);
}

export function fileURLToPath(url) {
  throw new Error(`fileURLToPath ${NOT_AVAILABLE}: ${url}`);
}

export function createRequire(filename) {
  throw new Error(`createRequire ${NOT_AVAILABLE}: ${filename}`);
}

export const sep = '/';

export default { pathToFileURL, fileURLToPath, createRequire, sep };
