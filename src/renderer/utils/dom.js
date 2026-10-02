/**
 * DOM helpers — tiny, dependency-free and allocation-conscious.
 *
 * The whole UI is built with these helpers instead of an innerHTML-based templating layer:
 * it keeps the rendering predictable, avoids XSS by construction (text goes through
 * textContent) and lets components update a single node without re-rendering a subtree.
 */

/**
 * Creates an element.
 * @param {string} tag  Optional CSS-ish shorthand: `div.panel.is-active#id`
 * @param {object|null} [props]  Attributes: `class`, `text`, `html` (trusted only), `dataset`, `style`, `on`, `attrs`
 * @param {Array|Node|string} [children]
 */
export function el(tag, props = null, children = null) {
  const { name, classes, id } = parseTag(tag);
  const node = document.createElement(name);
  if (id) node.id = id;
  if (classes.length > 0) node.className = classes.join(' ');
  if (props) applyProps(node, props);
  append(node, children);
  return node;
}

/** Creates a DocumentFragment from children. */
export function frag(children) {
  const fragment = document.createDocumentFragment();
  append(fragment, children);
  return fragment;
}

export function text(value) {
  return document.createTextNode(value === null || value === undefined ? '' : String(value));
}

function parseTag(tag) {
  const match = /^([a-zA-Z0-9-]+)?((?:[.#][^.#]+)*)$/.exec(tag ?? 'div');
  if (!match) return { name: 'div', classes: [], id: null };
  const name = match[1] ?? 'div';
  const classes = [];
  let id = null;
  const tokens = match[2] ? match[2].match(/[.#][^.#]+/g) ?? [] : [];
  for (const token of tokens) {
    if (token.startsWith('.')) classes.push(token.slice(1));
    else id = token.slice(1);
  }
  return { name, classes, id };
}

function applyProps(node, props) {
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    switch (key) {
      case 'class':
      case 'className':
        node.className = node.className ? `${node.className} ${String(value)}`.trim() : String(value);
        break;
      case 'text':
        node.textContent = String(value);
        break;
      case 'html':
        // Only used with strings produced by our own code (never user content).
        node.innerHTML = String(value);
        break;
      case 'dataset':
        for (const [dataKey, dataValue] of Object.entries(value)) {
          if (dataValue !== null && dataValue !== undefined) node.dataset[dataKey] = String(dataValue);
        }
        break;
      case 'style':
        if (typeof value === 'string') node.setAttribute('style', value);
        else for (const [styleKey, styleValue] of Object.entries(value)) {
          if (styleValue === null || styleValue === undefined) continue;
          if (styleKey.startsWith('--')) node.style.setProperty(styleKey, String(styleValue));
          else node.style[styleKey] = typeof styleValue === 'number' ? `${styleValue}px` : String(styleValue);
        }
        break;
      case 'on':
        for (const [eventName, handler] of Object.entries(value)) {
          if (typeof handler === 'function') node.addEventListener(eventName, handler);
        }
        break;
      case 'attrs':
        for (const [attrName, attrValue] of Object.entries(value)) {
          if (attrValue === false || attrValue === null) node.removeAttribute(attrName);
          else node.setAttribute(attrName, attrValue === true ? '' : String(attrValue));
        }
        break;
      case 'disabled':
      case 'checked':
      case 'selected':
      case 'readOnly':
      case 'multiple':
      case 'hidden':
      case 'spellcheck':
        node[key] = Boolean(value);
        break;
      case 'value':
        node.value = value;
        break;
      default:
        if (key in node && typeof node[key] !== 'function') node[key] = value;
        else node.setAttribute(key, String(value));
    }
  }
}

export function append(parent, children) {
  if (children === null || children === undefined || children === false) return parent;
  if (Array.isArray(children)) {
    for (const child of children) append(parent, child);
    return parent;
  }
  if (children instanceof Node) {
    parent.appendChild(children);
    return parent;
  }
  if (typeof children === 'object') {
    // Objects from data-driven renderers: ignore `null`/`undefined` entries gracefully.
    return parent;
  }
  parent.appendChild(document.createTextNode(String(children)));
  return parent;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Replaces the children of `node` in a single operation. */
export function replace(node, children) {
  clear(node);
  append(node, children);
  return node;
}

export function qs(selector, root = document) {
  return root.querySelector(selector);
}

export function qsa(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

/** Adds an event listener and returns a disposer. */
export function on(target, event, handler, options) {
  target.addEventListener(event, handler, options);
  return () => target.removeEventListener(event, handler, options);
}

/**
 * Event delegation: one listener for many dynamically created children.
 * Returns a disposer.
 */
export function delegate(root, event, selector, handler) {
  const listener = (domEvent) => {
    const target = domEvent.target instanceof Element ? domEvent.target.closest(selector) : null;
    if (target && root.contains(target)) handler(domEvent, target);
  };
  root.addEventListener(event, listener);
  return () => root.removeEventListener(event, listener);
}

/** Toggles a class and keeps ARIA attributes in sync. */
export function setActive(node, active, className = 'is-active') {
  node.classList.toggle(className, active);
  if (node.hasAttribute('aria-selected')) node.setAttribute('aria-selected', String(active));
  return node;
}

export function setHidden(node, hidden) {
  node.hidden = Boolean(hidden);
  node.setAttribute('aria-hidden', String(Boolean(hidden)));
  return node;
}

/** Measures an element, returning real numbers (never estimates). */
export function measure(node) {
  const rect = node.getBoundingClientRect();
  return {
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    top: Math.round(rect.top),
    left: Math.round(rect.left),
    scrollHeight: node.scrollHeight,
    scrollWidth: node.scrollWidth,
  };
}

/** Scrolls an element into view only when it is actually out of view (avoids jitter). */
export function scrollIntoViewIfNeeded(node, container = null) {
  const target = container ?? node.parentElement;
  if (!target) return;
  const nodeRect = node.getBoundingClientRect();
  const containerRect = target.getBoundingClientRect();
  if (nodeRect.top < containerRect.top) target.scrollTop -= containerRect.top - nodeRect.top;
  else if (nodeRect.bottom > containerRect.bottom) target.scrollTop += nodeRect.bottom - containerRect.bottom;
}

/** Real element visibility check (used to skip work for hidden panels). */
export function isVisible(node) {
  if (!node || !node.isConnected) return false;
  if (node.offsetParent === null && getComputedStyle(node).position !== 'fixed') return false;
  return true;
}

/** Runs `callback` on the next animation frame, coalescing repeated calls. */
export function nextFrame(callback) {
  let scheduled = false;
  return () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      callback();
    });
  };
}

/** Focuses the first focusable element inside `container` (dialogs). */
export function focusFirst(container) {
  const focusable = container.querySelector(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  if (focusable) focusable.focus();
  return focusable;
}

/** Keeps Tab navigation inside `container` while a modal is open. */
export function trapFocus(container) {
  const handler = (event) => {
    if (event.key !== 'Tab') return;
    const focusable = [...container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((node) => node.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  container.addEventListener('keydown', handler);
  return () => container.removeEventListener('keydown', handler);
}

/** Builds a data-driven list reusing existing nodes when possible (cheap updates). */
export function reconcile(container, items, keyOf, create, update) {
  const existing = new Map();
  for (const child of [...container.children]) {
    const key = child.dataset.key;
    if (key === undefined) container.removeChild(child);
    else existing.set(key, child);
  }
  let index = 0;
  for (const item of items) {
    const key = String(keyOf(item));
    let node = existing.get(key);
    if (node) {
      existing.delete(key);
      update?.(node, item, index);
    } else {
      node = create(item, index);
      node.dataset.key = key;
    }
    if (container.children[index] !== node) container.insertBefore(node, container.children[index] ?? null);
    index += 1;
  }
  for (const node of existing.values()) container.removeChild(node);
  return container;
}

/** Reads a CSS custom property from an element (used by the theme system). */
export function cssVar(name, node = document.documentElement) {
  return getComputedStyle(node).getPropertyValue(name).trim();
}
