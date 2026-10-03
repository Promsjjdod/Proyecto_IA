import React, { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { useApp } from '../store/app';

export function LoginPage() {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const app = useApp();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/login', { password });
      window.location.reload();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%', background: 'var(--bg)' }}>
      <form onSubmit={submit} className="card" style={{ width: 'min(360px, 92vw)', padding: 26, textAlign: 'center' }}>
        <img src="/brand/icon-192.png" alt="ForgeAI" width={64} height={64} style={{ borderRadius: 16 }} />
        <h1 style={{ fontSize: 20, margin: '12px 0 2px' }}>ForgeAI</h1>
        <div className="dim" style={{ fontSize: 12.5, marginBottom: 18, letterSpacing: '.14em' }}>BUILD. THINK. CREATE.</div>
        <input
          className="input"
          type="password"
          autoFocus
          placeholder="Local password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div style={{ color: 'var(--err)', fontSize: 12.8, marginTop: 8 }}>{error}</div>}
        <button className="btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }} disabled={busy}>
          {busy ? 'Signing in…' : 'Unlock workspace'}
        </button>
        <div className="hint" style={{ marginTop: 12 }}>The password is the FORGEAI_AUTH_PASSWORD value from your .env file.</div>
      </form>
    </div>
  );
}
