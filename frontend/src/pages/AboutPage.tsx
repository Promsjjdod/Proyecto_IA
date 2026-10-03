import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';

export function AboutPage() {
  const [branding, setBranding] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  useEffect(() => {
    api.get('/system/branding').then(setBranding).catch(() => undefined);
    api.get('/health').then(setHealth).catch(() => undefined);
  }, []);

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div className="card" style={{ textAlign: 'center', padding: '34px 26px' }}>
        <img src="/brand/logo-main.png" alt="ForgeAI logo" style={{ width: 116, borderRadius: 22, border: '1px solid var(--border)' }} />
        <h1 style={{ margin: '16px 0 2px', fontSize: 26, letterSpacing: '-.01em' }}>ForgeAI</h1>
        <div className="dim" style={{ letterSpacing: '.18em', fontSize: 12 }}>BUILD. THINK. CREATE.</div>
        <div className="row" style={{ justifyContent: 'center', marginTop: 14, gap: 8 }}>
          <span className="badge accent">v{branding?.version || health?.version || '0.1.0'}</span>
          <span className="badge">local-first</span>
          <span className="badge">MIT</span>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <b>What is ForgeAI?</b>
        <p className="dim" style={{ fontSize: 13.8 }}>
          A self-hosted AI workspace that runs entirely on your machine: chat with any OpenAI-compatible
          model or local Ollama, build agents with tools and permissions, run autonomous WORK tasks,
          manage files, generate images and extend everything through plugins — without sending your
          data anywhere unless you explicitly connect a provider.
        </p>
        <div className="grid cols-2" style={{ marginTop: 12 }}>
          {[
            ['✦', 'Chat', 'Streaming, markdown, code highlighting, editing, regeneration, attachments and token stats.'],
            ['⚒', 'Work', 'PLAN → ANALYZE → TOOLS → EXECUTE → VERIFY → RESULT with visible progress and approvals.'],
            ['◈', 'Agents', 'System prompts, models, tools, plugins, memory and per-agent permissions.'],
            ['▣', 'Plugins', 'Installable packs with a marketplace, configuration and encrypted secrets.'],
            ['⌸', 'Files', 'Uploads, previews (MD/CSV/JSON/code/PDF/DOCX/ZIP), folders, search and drag & drop.'],
            ['🖼', 'Media', 'Image generation with a local gallery; video queue architecture ready for providers.'],
          ].map(([icon, title, body]) => (
            <div key={title as string} className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
              <span className="plugin-icon" style={{ width: 30, height: 30, fontSize: 14 }}>{icon}</span>
              <div><b style={{ fontSize: 13.4 }}>{title}</b><div className="dim" style={{ fontSize: 12.4 }}>{body}</div></div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <b>Brand & identity</b>
        <p className="dim" style={{ fontSize: 13.4 }}>
          The ForgeAI mark — an abstract forged “F” with an ember spark — is original artwork generated for
          this project. Variants ship in <code className="inline">assets/brand/</code>: main logo, light-mode logo,
          monochrome light/dark, square icons and favicons. No third-party logos or trademarks are used.
        </p>
        <div className="row wrap" style={{ gap: 12, marginTop: 10 }}>
          <img src="/brand/logo-main.png" alt="dark logo" width={64} style={{ borderRadius: 12 }} />
          <img src="/brand/logo-light.png" alt="light logo" width={64} style={{ borderRadius: 12 }} />
          <img src="/brand/logo-mono-light.png" alt="mono light" width={64} style={{ borderRadius: 12, background: '#111' }} />
          <img src="/brand/logo-mono-dark.png" alt="mono dark" width={64} style={{ borderRadius: 12, background: '#eee' }} />
          <img src="/brand/favicon-32.png" alt="favicon 32" width={32} />
          <img src="/brand/favicon-64.png" alt="favicon 64" width={64} style={{ borderRadius: 10 }} />
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <b>Runtime</b>
        <table className="file-table" style={{ marginTop: 8 }}>
          <tbody>
            <tr><td className="dim">Backend</td><td className="mono">http://localhost:{health ? 8000 : '…'} · /api/health → {health?.status || 'offline'}</td></tr>
            <tr><td className="dim">Database</td><td className="mono">SQLite (WAL) · {health?.database || '—'}</td></tr>
            <tr><td className="dim">Environment</td><td className="mono">{health?.env || '—'}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
