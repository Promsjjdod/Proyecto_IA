import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Spinner, StatusBadge } from '../components/ui';
import { formatBytes } from '../lib/format';

function Dot({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="spinner" />;
  return <span className="pulse" style={{ background: ok ? 'var(--ok)' : 'var(--err)', animation: ok ? undefined : 'none', boxShadow: 'none' }} />;
}

export function StatusPage() {
  const [status, setStatus] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [level, setLevel] = useState('');
  const [health, setHealth] = useState<any>(null);

  const load = async () => {
    try { setStatus(await api.get('/system/status')); } catch { setStatus(null); }
    try { setHealth(await api.get('/health')); } catch { setHealth(null); }
  };
  const loadLogs = () => api.get(`/system/logs?limit=200${level ? `&level=${level}` : ''}`).then(({ logs }) => setLogs(logs)).catch(() => setLogs([]));

  useEffect(() => { load(); loadLogs(); const t = setInterval(() => { load(); loadLogs(); }, 6000); return () => clearInterval(t); }, [level]);

  if (!status) return <div className="page"><Spinner label="Contacting backend…" /></div>;

  const cards = [
    { name: 'Frontend', ok: true, detail: `port ${status.frontend.port} · LAN ${status.frontend.lan ? 'enabled' : 'off'}` },
    { name: 'Backend', ok: Boolean(health), detail: health ? `v${health.version} · uptime ${health.uptimeSec}s` : 'unreachable' },
    { name: 'Database', ok: status.database?.connected, detail: status.database?.connected ? `SQLite · ${formatBytes(status.database.sizeBytes)}` : status.database?.error },
    { name: 'Ollama', ok: status.ollama?.configured ? status.ollama.ok : null, detail: status.ollama?.configured ? `${status.ollama.models?.length || 0} model(s) detected` : 'provider not configured' },
    { name: 'GitHub', ok: status.github?.connected ? true : null, detail: status.github?.connected ? `@${status.github.login} (${status.github.authMethod})` : 'not connected' },
    { name: 'Image provider', ok: status.images?.configured ? true : null, detail: status.images?.configured ? status.images.baseUrl : 'DEMO placeholders' },
    { name: 'Video provider', ok: status.video?.configured ? true : null, detail: status.video?.configured ? 'registered' : 'architecture ready, no provider' },
  ];

  return (
    <div className="page">
      <div className="page-title">
        <h1>System Status</h1>
        <div className="grow" />
        <button className="btn sm" onClick={() => { load(); loadLogs(); }}>⟳ Refresh</button>
      </div>

      <div className="status-grid">
        {cards.map((c) => (
          <div key={c.name} className="card status-card">
            <div className="name"><Dot ok={c.ok} /> {c.name}</div>
            <div className="dim" style={{ fontSize: 12.4 }}>{c.detail}</div>
          </div>
        ))}
      </div>

      <div className="section-title">Providers</div>
      <div className="status-grid">
        {status.providers?.length ? status.providers.map((p: any) => (
          <div key={p.id} className="card status-card">
            <div className="name"><Dot ok={p.ok} /> {p.name}</div>
            <div className="dim" style={{ fontSize: 12.4 }}>{p.kind} · {p.message}</div>
          </div>
        )) : <div className="dim">Only the built-in demo provider is active.</div>}
      </div>
      {status.demoMode ? <div className="hint" style={{ marginTop: 8 }}>DEMO mode is on: with no provider configured, responses are simulated locally and labelled DEMO.</div> : null}

      {status.frontend?.lan && status.frontend.addresses?.length ? (
        <div className="card" style={{ marginTop: 14 }}>
          <b>LAN access enabled</b>
          <div className="dim" style={{ fontSize: 13, marginTop: 4 }}>Other devices on your network can reach ForgeAI at:</div>
          {status.frontend.addresses.map((a: any) => (
            <div key={a.address} className="mono" style={{ marginTop: 4 }}>http://{a.address}:{status.frontend.port} <span className="faint">({a.name})</span></div>
          ))}
        </div>
      ) : null}

      <div className="section-title">Backend logs (secrets redacted)</div>
      <div className="row" style={{ marginBottom: 8 }}>
        {['', 'DEBUG', 'INFO', 'WARN', 'ERROR'].map((l) => (
          <button key={l || 'all'} className={`badge ${level === l ? 'accent' : ''}`} style={{ cursor: 'pointer', padding: '4px 10px' }} onClick={() => setLevel(l)}>{l || 'ALL'}</button>
        ))}
      </div>
      <div className="log-view">
        {logs.map((l, i) => (
          <div key={i}>
            <span className="faint">{l.ts.slice(11, 19)}</span> <span style={{ color: l.level === 'ERROR' ? 'var(--err)' : l.level === 'WARN' ? 'var(--warn)' : l.level === 'DEBUG' ? 'var(--text-faint)' : 'var(--info)' }}>{l.level.padEnd(5)}</span> <span className="dim">[{l.scope}]</span> {l.message}
          </div>
        ))}
        {!logs.length && <span className="faint">No log entries at this level.</span>}
      </div>
    </div>
  );
}
