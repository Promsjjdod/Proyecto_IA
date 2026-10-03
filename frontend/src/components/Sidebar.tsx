import React, { useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../store/app';
import { useChats } from '../store/chats';
import { Confirm } from './ui';
import { timeAgo } from '../lib/format';

const NAV = [
  { to: '/', icon: '✦', label: 'Chat', end: true },
  { to: '/work', icon: '⚒', label: 'Work' },
  { to: '/agents', icon: '◈', label: 'Agents' },
  { to: '/plugins', icon: '▣', label: 'Plugins' },
  { to: '/files', icon: '⌸', label: 'Files' },
  { to: '/images', icon: '🖼', label: 'Images' },
  { to: '/video', icon: '▶', label: 'Video' },
  { to: '/status', icon: '♥', label: 'Status' },
  { to: '/settings', icon: '⚙', label: 'Settings' },
];

export function Sidebar() {
  const app = useApp();
  const { chats, folders, current, loadChats, newChat, patchChat, removeChat, openChat } = useChats();
  const nav = useNavigate();
  const loc = useLocation();
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const collapsed = app.sidebarCollapsed && !app.sidebarOpenMobile;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return chats.filter((c) => !q || c.title.toLowerCase().includes(q) || c.folder.toLowerCase().includes(q));
  }, [chats, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const chat of filtered) {
      const key = chat.folder || '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(chat);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const go = (path: string) => { nav(path); app.setMobileOpen(false); };

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${app.sidebarOpenMobile ? 'open' : ''}`}>
      <div className="row" style={{ padding: '12px 12px 8px', gap: 10 }}>
        {!collapsed && (
          <button className="btn ghost icon mobile-only" style={{ marginLeft: 'auto' }} onClick={() => app.setMobileOpen(false)} aria-label="Close menu">✕</button>
        )}
        <button
          className="row"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', gap: 10, padding: 4, flex: 1 }}
          onClick={() => go('/about')}
          title="About ForgeAI"
        >
          <img src="/brand/favicon-64.png" alt="" width={26} height={26} style={{ borderRadius: 7, flex: 'none' }}  />
          {!collapsed && (
            <span style={{ textAlign: 'left' }}>
              <span style={{ display: 'block', fontWeight: 700, fontSize: 14.5, letterSpacing: '.02em' }}>ForgeAI</span>
              <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-faint)', letterSpacing: '.08em' }}>BUILD · THINK · CREATE</span>
            </span>
          )}
        </button>
        <button className="btn ghost icon" title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={app.toggleSidebar} style={{ display: app.sidebarOpenMobile ? 'none' : undefined }}>
          {collapsed ? '»' : '«'}
        </button>
      </div>

      <div className="sidebar-main scroll">
        {!collapsed && (
          <div style={{ padding: '4px 10px 8px' }}>
            <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} onClick={async () => { const c = await newChat(); go(`/chat/${c.id}`); }}>
              ＋ New chat
            </button>
            <input
              className="input"
              style={{ marginTop: 8, fontSize: 13 }}
              placeholder="Search chats…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="row spread" style={{ marginTop: 6 }}>
              <span className="faint" style={{ fontSize: 11 }}>{showArchived ? 'Archived' : 'Recent'}</span>
              <button className="btn ghost sm" onClick={() => setShowArchived((v) => !v)}>{showArchived ? 'Back' : 'Archive'}</button>
            </div>
          </div>
        )}

        {!collapsed && grouped.map(([folder, items]) => (
          <div key={folder || '_'}>
            {folder && <div className="section-title" style={{ margin: '10px 14px 4px', fontSize: 10.5 }}>📁 {folder}</div>}
            {items.map((chat) => (
              <div key={chat.id} className={`chat-item ${current?.id === chat.id && loc.pathname.startsWith('/chat') ? 'active' : ''}`}>
                <button className="chat-item" style={{ width: 'auto', margin: 0, padding: 0, flex: 1 }} onClick={() => { openChat(chat.id); go(`/chat/${chat.id}`); }}>
                  <span style={{ color: 'var(--text-faint)' }}>{chat.pinned ? '📌' : '✦'}</span>
                  <span className="title">{chat.title}</span>
                </button>
                <span className="acts">
                  <button className="btn ghost sm" title="Rename" onClick={() => { setRenaming(chat.id); setRenameValue(chat.title); }}>✎</button>
                  <button className="btn ghost sm" title={chat.pinned ? 'Unpin' : 'Pin'} onClick={() => patchChat(chat.id, { pinned: !chat.pinned } as any)}>{chat.pinned ? '⭔' : '📌'}</button>
                  <button className="btn ghost sm" title={showArchived ? 'Unarchive' : 'Archive'} onClick={() => patchChat(chat.id, { archived: !chat.archived } as any)}>{showArchived ? '♻' : '🗀'}</button>
                  <button className="btn ghost sm" title="Delete" onClick={() => setConfirmDelete(chat.id)}>🗑</button>
                </span>
              </div>
            ))}
          </div>
        ))}
        {!collapsed && !filtered.length && <div className="faint" style={{ padding: '10px 16px', fontSize: 12.5 }}>No chats yet. Start one above.</div>}

        {collapsed && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '6px 0' }}>
            <button className="btn primary icon" title="New chat" onClick={async () => { const c = await newChat(); go(`/chat/${c.id}`); }}>＋</button>
          </div>
        )}
      </div>

      <nav style={{ padding: '8px 0 10px', borderTop: '1px solid var(--border)' }}>
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `nav-item ${isActive && (item.end ? true : loc.pathname.startsWith(item.to)) ? 'active' : ''}`}
            onClick={() => app.setMobileOpen(false)}
            title={item.label}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </NavLink>
        ))}
        <button className="nav-item" onClick={() => { app.setPalette(true); app.setMobileOpen(false); }} title="Command palette (Ctrl+K)">
          <span className="nav-icon">⌘</span>
          <span className="nav-label">Command palette <span className="faint mono" style={{ fontSize: 10.5 }}>Ctrl K</span></span>
        </button>
      </nav>

      {confirmDelete && (
        <Confirm
          title="Delete chat?"
          body="The conversation and its messages will be permanently removed from the local database."
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => removeChat(confirmDelete)}
        />
      )}
      {renaming && (
        <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setRenaming(null); }}>
          <div className="modal">
            <h2>Rename chat</h2>
            <input className="input" autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={async (e) => { if (e.key === 'Enter') { await patchChat(renaming, { title: renameValue } as any); setRenaming(null); } }} />
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn" onClick={() => setRenaming(null)}>Cancel</button>
              <button className="btn primary" onClick={async () => { await patchChat(renaming, { title: renameValue } as any); setRenaming(null); }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
