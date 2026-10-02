// Asset loader with progress + lazy variants (web = optimised, hd = full)
import { SYMBOLS, TOADS, TOAD_POSES } from './config.js';

const cache = new Map();

export function symbolPath(id, hd = false) {
  return hd ? `assets/symbols/symbol_${id}.png` : `assets/symbols/web/symbol_${id}.png`;
}
export function toadPath(color, pose, hd = false) {
  return hd
    ? `assets/characters/${color}/tiny_toad_${color}_${pose}.png`
    : `assets/characters/${color}/web/tiny_toad_${color}_${pose}.png`;
}

export function loadImage(src) {
  if (cache.has(src)) return cache.get(src);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load ' + src));
    img.src = src;
  });
  cache.set(src, p);
  return p;
}

export function getImage(src) {
  // sync access after preload (returns HTMLImageElement or undefined)
  const p = cache.get(src);
  return p && p.__img;
}

export async function preload(onProgress) {
  const list = [];
  for (const id of Object.keys(SYMBOLS)) list.push(symbolPath(id));
  for (const c of TOADS) for (const p of TOAD_POSES) list.push(toadPath(c, p));
  let done = 0;
  await Promise.all(list.map(async (src) => {
    try {
      const img = await loadImage(src);
      cache.get(src).__img = img;
    } catch (e) {
      console.warn(e.message);
    }
    done++;
    onProgress && onProgress(done / list.length);
  }));
}

/** Lazy-load HD symbol art after first paint (used by paytable / big wins). */
export function warmHD() {
  if (!('requestIdleCallback' in window)) return;
  requestIdleCallback(() => {
    for (const id of Object.keys(SYMBOLS)) loadImage(symbolPath(id, true)).then(i => (cache.get(symbolPath(id, true)).__img = i)).catch(() => {});
  });
}
