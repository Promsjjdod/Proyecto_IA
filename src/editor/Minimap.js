/**
 * Minimap — canvas overview of the document.
 *
 * Real behaviour: it measures the document (line count and relative line lengths), draws one
 * bar per line scaled to the canvas, paints the visible viewport and lets the user click or
 * drag to scroll. Colours come from the active theme tokens, and the canvas only redraws when
 * the document, the viewport or the panel size actually changed.
 *
 * It is a *structural* minimap (no per-token colours): that keeps the cost proportional to the
 * number of lines instead of parsing the document on every keystroke, which is why large files
 * stay responsive.
 */

import { createScheduler } from '../renderer/utils/async.js';
import { el } from '../renderer/utils/dom.js';

const MAX_LINES_DRAWN = 4000;

export class Minimap {
  #host = null;
  #view = null;
  #canvas = null;
  #context = null;
  #viewport = null;
  #disposers = [];
  #schedule = createScheduler(() => this.draw());
  #colors = { background: '#0d1117', line: '#4d5769', viewport: 'rgba(255,255,255,0.12)' };
  #metrics = { lines: 0, drawnLines: 0, lineHeight: 2, lastDrawMs: 0, draws: 0, width: 0, height: 0 };
  #dragging = false;
  #enabled = true;

  constructor({ theme, logger } = {}) {
    this.theme = theme;
    this.logger = logger;
  }

  get stats() {
    return { ...this.#metrics, enabled: this.#enabled, attached: this.#view !== null };
  }

  /**
   * Mounts the minimap inside `host` (a positioned container) and binds it to a CodeMirror view.
   */
  attach({ host, view, enabled = true }) {
    this.destroy();
    this.#host = host;
    this.#view = view;
    this.#enabled = enabled;

    const canvas = el('canvas.minimap__canvas', { attrs: { 'aria-hidden': 'true' } });
    const viewport = el('div.minimap__viewport');
    const root = el('div.minimap', {
      attrs: { role: 'presentation', title: 'Minimapa: clic o arrastra para desplazarte' },
      on: {
        pointerdown: (event) => this.#onPointerDown(event),
        pointermove: (event) => this.#onPointerMove(event),
        pointerup: (event) => this.#onPointerUp(event),
        pointercancel: () => { this.#dragging = false; },
      },
    }, [canvas, viewport]);
    host.appendChild(root);

    this.#canvas = canvas;
    this.#context = canvas.getContext('2d');
    this.#viewport = viewport;
    this.#readColors();
    this.#observe();

    this.#disposers.push(() => root.remove());
    this.#schedule();
    return this;
  }

  #observe() {
    if (!this.#view) return;
    const scroller = this.#view.scrollDOM;
    const onScroll = () => this.#schedule();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    this.#disposers.push(() => scroller.removeEventListener('scroll', onScroll));

    const onResize = () => {
      this.#readColors();
      this.#schedule();
    };
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(onResize);
      observer.observe(this.#host);
      this.#disposers.push(() => observer.disconnect());
    } else {
      window.addEventListener('resize', onResize);
      this.#disposers.push(() => window.removeEventListener('resize', onResize));
    }
  }

  setEnabled(enabled) {
    this.#enabled = Boolean(enabled);
    if (this.#canvas?.parentElement) this.#canvas.parentElement.hidden = !this.#enabled;
    if (this.#enabled) this.#schedule();
    return this.#enabled;
  }

  get enabled() {
    return this.#enabled;
  }

  #readColors() {
    if (!this.#host) return;
    const style = getComputedStyle(this.#host);
    const background = style.getPropertyValue('--editor-minimap-bg').trim();
    const line = style.getPropertyValue('--text-disabled').trim();
    const viewport = style.getPropertyValue('--editor-minimap-viewport').trim();
    this.#colors = {
      background: background || this.#colors.background,
      line: line || this.#colors.line,
      viewport: viewport || this.#colors.viewport,
    };
  }

  /** Redraws when the document, viewport or size changed. */
  update() {
    this.#schedule();
  }

  draw() {
    const canvas = this.#canvas;
    const context = this.#context;
    const view = this.#view;
    if (!canvas || !context || !view || !this.#enabled) return;

    const started = performance.now();
    const hostRect = this.#host.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(40, Math.round(hostRect.width));
    const height = Math.max(40, Math.round(hostRect.height));
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = this.#colors.background;
    context.fillRect(0, 0, width, height);

    const doc = view.state.doc;
    const lines = doc.lines;
    const lineHeight = Math.max(1, Math.min(3, height / Math.max(1, lines)));
    const drawn = Math.min(lines, MAX_LINES_DRAWN);
    const scale = height / Math.max(1, drawn * lineHeight);
    const maxLineLength = Math.max(40, view.scrollDOM.clientWidth / 7);

    context.fillStyle = this.#colors.line;
    for (let index = 0; index < drawn; index += 1) {
      const line = doc.line(index + 1);
      const text = line.text;
      if (text.trim() === '') continue;
      const indent = text.length - text.trimStart().length;
      const barWidth = Math.max(2, Math.min(width - 9, ((text.length - indent) / maxLineLength) * (width - 12)));
      const x = Math.min(width - barWidth - 8, 6 + (indent / maxLineLength) * (width - 12));
      context.globalAlpha = 0.75;
      context.fillRect(x, index * lineHeight * scale, barWidth, Math.max(1, lineHeight * scale - 0.4));
    }
    context.globalAlpha = 1;

    // Real viewport indicator, computed from the scroller's own measurements.
    const scroller = view.scrollDOM;
    const totalHeight = Math.max(1, scroller.scrollHeight);
    const visibleTop = scroller.scrollTop / totalHeight;
    const visibleRatio = Math.min(1, scroller.clientHeight / totalHeight);
    const top = Math.max(0, Math.min(1 - 0.02, visibleTop)) * height;
    const viewportHeight = Math.max(10, visibleRatio * height);
    if (this.#viewport) {
      this.#viewport.style.top = `${Math.round(top)}px`;
      this.#viewport.style.height = `${Math.round(viewportHeight)}px`;
      this.#viewport.style.background = this.#colors.viewport;
      this.#viewport.style.display = 'block';
    }

    this.#metrics = {
      lines,
      drawnLines: drawn,
      lineHeight,
      lastDrawMs: Math.round((performance.now() - started) * 100) / 100,
      draws: this.#metrics.draws + 1,
      width,
      height,
    };
  }

  #scrollFromEvent(event) {
    if (!this.#view) return;
    const rect = this.#canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    const scroller = this.#view.scrollDOM;
    const target = ratio * scroller.scrollHeight - scroller.clientHeight / 2;
    scroller.scrollTop = Math.max(0, target);
  }

  #onPointerDown(event) {
    if (!this.#enabled) return;
    this.#dragging = true;
    this.#canvas.setPointerCapture?.(event.pointerId);
    this.#scrollFromEvent(event);
  }

  #onPointerMove(event) {
    if (!this.#dragging) return;
    this.#scrollFromEvent(event);
  }

  #onPointerUp(event) {
    this.#dragging = false;
    this.#canvas?.releasePointerCapture?.(event.pointerId);
  }

  destroy() {
    for (const disposer of this.#disposers) {
      try {
        disposer();
      } catch {
        /* already detached */
      }
    }
    this.#disposers = [];
    this.#canvas = null;
    this.#context = null;
    this.#viewport = null;
    this.#view = null;
    this.#host = null;
  }
}
