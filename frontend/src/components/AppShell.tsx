import React, { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { CommandPalette } from './CommandPalette';
import { ApprovalModal } from './ApprovalModal';
import { Toasts } from './ui';
import { useApp } from '../store/app';
import { useChats } from '../store/chats';

function ThemeToggle() {
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const fn = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
  return (
    <button className="btn ghost icon" title="Toggle theme" onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}>
      {resolved === 'dark' ? '☾' : '☀'}
    </button>
  );
}

export function AppShell() {
  const app = useApp();
  const loc = useLocation();
  const nav = useNavigate();
  const { current } = useChats();

  useEffect(() => { app.applyAppearance(); }, []);
  useEffect(() => { app.loadSettings(); app.loadBranding(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        app.setPalette(!useApp.getState().paletteOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const titles: [string, string][] = [
    ['/work', 'WORK — autonomous tasks'],
    ['/agents', 'Agents'],
    ['/plugins', 'Plugins'],
    ['/files', 'File Workspace'],
    ['/images', 'Image Generator'],
    ['/video', 'Video Generator'],
    ['/settings', 'Settings'],
    ['/status', 'System Status'],
    ['/about', 'About ForgeAI'],
  ];
  const title = titles.find(([p]) => loc.pathname.startsWith(p))?.[1]
    || (loc.pathname.startsWith('/chat') ? current?.title || 'Chat' : 'New chat');

  return (
    <div className="shell">
      <Sidebar />
      <div className="content">
        <div className="topbar">
          <button className="btn ghost icon mobile-only" onClick={() => app.setMobileOpen(true)} aria-label="Open menu">☰</button>
          <div className="grow" style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
          <button className="btn ghost sm" onClick={() => app.setPalette(true)} title="Command palette">
            ⌘ <span className="mono faint" style={{ fontSize: 11 }}>Ctrl K</span>
          </button>
          <ThemeToggle />
        </div>
        <div className="grow scroll" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <Outlet />
        </div>
      </div>
      <CommandPalette />
      <ApprovalModal />
      <Toasts />
    </div>
  );
}
