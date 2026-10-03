import React, { useEffect, useState } from 'react';
import { useApp } from '../store/app';

export function Modal({ title, children, onClose, wide }: { title: React.ReactNode; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${wide ? ' lg' : ''}`} role="dialog" aria-modal="true">
        <div className="spread" style={{ marginBottom: 12 }}>
          <h2>{title}</h2>
          <button className="btn ghost icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Confirm({ title, body, confirmLabel = 'Delete', danger = true, onConfirm, onClose }: {
  title: string; body: React.ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="dim" style={{ fontSize: 14, marginBottom: 16 }}>{body}</div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}

export function Spinner({ label }: { label?: string }) {
  return <span className="row dim" style={{ gap: 8 }}><span className="spinner" />{label}</span>;
}

export function Empty({ icon = '◇', title, body, children }: { icon?: string; title: string; body?: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <div style={{ fontSize: 30, opacity: .55 }}>{icon}</div>
      <h3>{title}</h3>
      {body ? <p>{body}</p> : null}
      {children}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    enabled: 'ok', installed: '', completed: 'ok', done: 'ok', loaded: 'ok',
    disabled: '', not_installed: '', needs_configuration: 'warn', queued: 'warn',
    generating: 'warn', running: 'warn', pending: 'warn', planning: 'warn',
    error: 'err', failed: 'err', denied: 'err', cancelled: '',
  };
  return <span className={`badge ${map[status] || ''}`}>{status.replace(/_/g, ' ')}</span>;
}

export function Toasts() {
  const { toasts, dropToast } = useApp();
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dropToast(t.id)} style={{ cursor: 'pointer' }}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function usePoll(fn: () => Promise<void> | void, ms: number, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const run = async () => { await fn(); };
    run();
    const t = setInterval(() => { if (alive) run(); }, ms);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, enabled]);
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="btn ghost sm" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1400); } catch { /* ignore */ }
    }}>
      {done ? '✓ Copied' : label}
    </button>
  );
}
