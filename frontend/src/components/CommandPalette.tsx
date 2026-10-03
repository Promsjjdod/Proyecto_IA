import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store/app';
import { useChats } from '../store/chats';
import { api } from '../lib/api';

interface Item { id: string; label: string; kind: string; icon: string; run: () => void; }

export function CommandPalette() {
  const app = useApp();
  const { newChat } = useChats();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [searchResults, setSearchResults] = useState<any>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (app.paletteOpen) { setQ(''); setSel(0); setSearchResults(null); setTimeout(() => inputRef.current?.focus(), 30); } }, [app.paletteOpen]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setSearchResults(null); return; }
    const t = setTimeout(() => {
      api.get(`/search?q=${encodeURIComponent(term)}`).then(({ results }) => setSearchResults(results)).catch(() => setSearchResults(null));
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  const commands: Item[] = useMemo(() => [
    { id: 'new-chat', label: 'New Chat', kind: 'command', icon: '✦', run: async () => { const c = await newChat(); nav(`/chat/${c.id}`); } },
    { id: 'new-agent', label: 'New Agent', kind: 'command', icon: '◈', run: () => nav('/agents?new=1') },
    { id: 'open-work', label: 'Open Work', kind: 'command', icon: '⚒', run: () => nav('/work') },
    { id: 'open-plugins', label: 'Open Plugins', kind: 'command', icon: '▣', run: () => nav('/plugins') },
    { id: 'open-files', label: 'Open Files', kind: 'command', icon: '⌸', run: () => nav('/files') },
    { id: 'open-images', label: 'Open Image Generator', kind: 'command', icon: '🖼', run: () => nav('/images') },
    { id: 'open-video', label: 'Open Video Generator', kind: 'command', icon: '▶', run: () => nav('/video') },
    { id: 'settings', label: 'Settings', kind: 'command', icon: '⚙', run: () => nav('/settings') },
    { id: 'connect-github', label: 'Connect GitHub', kind: 'command', icon: '⑂', run: () => nav('/settings?tab=github') },
    { id: 'status', label: 'System Status', kind: 'command', icon: '♥', run: () => nav('/status') },
    {
      id: 'theme', label: 'Toggle Dark Mode', kind: 'command', icon: '◐',
      run: () => {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        app.setTheme(next);
      },
    },
  ], [nav, newChat, app]);

  const items: Item[] = useMemo(() => {
    const term = q.trim().toLowerCase();
    const cmds = term ? commands.filter((c) => c.label.toLowerCase().includes(term)) : commands;
    const extra: Item[] = [];
    if (searchResults) {
      for (const c of searchResults.chats || []) extra.push({ id: `chat-${c.id}`, label: c.title, kind: 'chat', icon: '✦', run: () => nav(`/chat/${c.id}`) });
      for (const a of searchResults.agents || []) extra.push({ id: `agent-${a.id}`, label: a.name, kind: 'agent', icon: a.avatar || '◈', run: () => nav(`/agents/${a.id}`) });
      for (const p of searchResults.plugins || []) extra.push({ id: `plugin-${p.id}`, label: p.name, kind: 'plugin', icon: p.icon, run: () => nav('/plugins') });
      for (const f of searchResults.files || []) extra.push({ id: `file-${f.id}`, label: f.name, kind: 'file', icon: '⌸', run: () => nav(`/files?open=${f.id}`) });
      for (const w of searchResults.workspaces || []) extra.push({ id: `ws-${w.id}`, label: w.name, kind: 'workspace', icon: '🗀', run: () => nav('/files') });
    }
    return [...cmds, ...extra].slice(0, 30);
  }, [q, commands, searchResults, nav]);

  useEffect(() => { setSel(0); }, [q]);

  if (!app.paletteOpen) return null;
  const close = () => app.setPalette(false);

  return (
    <div className="overlay" style={{ paddingTop: '12vh' }} onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="palette">
        <input
          ref={inputRef}
          placeholder="Type a command or search chats, agents, plugins, files…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            if (e.key === 'Enter' && items[sel]) { close(); items[sel].run(); }
            if (e.key === 'Escape') close();
          }}
        />
        <div className="palette-list">
          {items.map((item, i) => (
            <div key={item.id} className={`palette-item ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => { close(); item.run(); }}>
              <span style={{ width: 18, textAlign: 'center' }}>{item.icon}</span>
              <span>{item.label}</span>
              <span className="kind">{item.kind}</span>
            </div>
          ))}
          {!items.length && <div className="palette-item dim">No matches.</div>}
        </div>
      </div>
    </div>
  );
}
