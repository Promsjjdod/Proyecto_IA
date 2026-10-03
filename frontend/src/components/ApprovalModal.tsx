import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../store/app';

/**
 * Global permission gate: polls for pending approvals and shows a confirm
 * dialog describing the tool, its arguments and the permissions involved.
 */
export function ApprovalModal() {
  const [pending, setPending] = useState<any[]>([]);
  const toast = useApp((s) => s.toast);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const { approvals } = await api.get('/approvals');
        if (alive) setPending(approvals);
      } catch { /* backend restarting */ }
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!pending.length) return null;
  const item = pending[0];

  const decide = async (decision: 'approved' | 'denied') => {
    try {
      await api.post(`/approvals/${item.id}`, { decision });
      setPending((p) => p.filter((x) => x.id !== item.id));
      toast(decision === 'approved' ? `Approved ${item.tool}` : `Denied ${item.tool}`, decision === 'approved' ? 'ok' : 'warn');
    } catch (err: any) {
      toast(err.message, 'err');
    }
  };

  return (
    <div className="overlay">
      <div className="modal">
        <div className="row" style={{ gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 22 }}>🛡</span>
          <h2 style={{ margin: 0 }}>Permission required</h2>
        </div>
        <p className="dim" style={{ fontSize: 13.6 }}>
          The agent wants to run <b className="mono">{item.tool}</b>
          {item.dangerous ? <span className="badge warn" style={{ marginLeft: 8 }}>dangerous tool</span> : null}
        </p>
        {item.missing?.length ? (
          <div style={{ margin: '8px 0' }}>
            <div className="hint" style={{ marginBottom: 4 }}>Missing permissions:</div>
            {item.missing.map((m: string) => <span key={m} className="badge err" style={{ marginRight: 6 }}>{m}</span>)}
          </div>
        ) : null}
        <div className="section-title">Arguments</div>
        <pre className="code" style={{ maxHeight: 220, margin: 0 }}>{JSON.stringify(item.args, null, 2)}</pre>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14, gap: 8 }}>
          <button className="btn danger" onClick={() => decide('denied')}>Deny</button>
          <button className="btn primary" onClick={() => decide('approved')}>Allow this action</button>
        </div>
        <div className="hint" style={{ marginTop: 10 }}>
          You can restrict tool permissions permanently in Settings → Security.
        </div>
      </div>
    </div>
  );
}
