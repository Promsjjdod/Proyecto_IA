import React, { memo, useEffect, useRef } from 'react';
import { renderMarkdown, highlight } from '../lib/markdown';

/**
 * Markdown renderer with syntax highlighting and per-block copy buttons.
 * Highlighting runs incrementally so streaming text stays cheap.
 */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = renderMarkdown(text);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll('pre').forEach((pre) => {
      if (pre.dataset.ready) return;
      pre.dataset.ready = '1';
      pre.classList.add('code');
      const code = pre.querySelector('code');
      const langClass = [...(code?.classList || [])].find((c) => c.startsWith('language-'));
      const lang = langClass ? langClass.slice(9) : '';
      const head = document.createElement('div');
      head.className = 'code-head';
      head.innerHTML = `<span>${lang || 'text'}</span>`;
      const btn = document.createElement('button');
      btn.className = 'btn ghost sm';
      btn.textContent = 'Copy';
      btn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(code?.textContent || pre.textContent || '');
          btn.textContent = '✓ Copied';
          setTimeout(() => { btn.textContent = 'Copy'; }, 1400);
        } catch { /* ignore */ }
      };
      head.appendChild(btn);
      pre.parentNode?.insertBefore(head, pre);
      if (code) code.innerHTML = highlight(code.textContent || '', lang);
    });
  }, [html]);

  return <div className="markdown" ref={ref} dangerouslySetInnerHTML={{ __html: html }} />;
});
