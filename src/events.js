// Tiny event bus — every visual event is emitted here so audio can be synced later.
// Events: 'spin', 'reelStop', 'symbolLand', 'win', 'bigWin', 'jackpot', 'click', 'bonus', 'scatter'
const listeners = new Map();
export const events = {
  on(name, fn) { (listeners.get(name) || listeners.set(name, new Set()).get(name)).add(fn); return () => listeners.get(name).delete(fn); },
  emit(name, payload) { const s = listeners.get(name); if (s) for (const fn of s) fn(payload); },
};

// Visual "audio hooks": log in dev, ready to be wired to an AudioContext later.
export const AUDIO_HOOKS = ['spin', 'reelStop', 'symbolLand', 'win', 'bigWin', 'jackpot', 'click', 'bonus', 'scatter'];
