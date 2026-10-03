import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useApp } from '../store/app';
import { Spinner, StatusBadge, Modal, Confirm } from '../components/ui';
import { PERMISSIONS } from '../lib/constants';

const TABS = [
  ['general', 'General'], ['appearance', 'Appearance'], ['models', 'Models'], ['providers', 'Providers'],
  ['agents', 'Agents'], ['plugins', 'Plugins'], ['tools', 'Tools'], ['memory', 'Memory'],
  ['files', 'Files'], ['github', 'GitHub'], ['security', 'Security'], ['advanced', 'Advanced'],
] as const;

export function SettingsPage() {
  const app = useApp();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') || 'general') as typeof TABS[number][0];
  const settings = app.settings;

  if (!settings) return <div className="page"><Spinner label="Loading settings…" /></div>;

  return (
    <div className="page">
      <div className="page-title"><h1>Settings</h1></div>
      <div className="settings-layout">
        <nav className="settings-nav">
          {TABS.map(([id, label]) => (
            <button key={id} className={`nav-item ${tab === id ? 'active' : ''}`} onClick={() => setParams({ tab: id })}>{label}</button>
          ))}
        </nav>
        <div>
          {tab === 'general' && <GeneralTab settings={settings} />}
          {tab === 'appearance' && <AppearanceTab />}
          {tab === 'models' && <ModelsTab settings={settings} />}
          {tab === 'providers' && <ProvidersTab />}
          {tab === 'agents' && <RedirectTab to="/agents" label="Agents are managed in the Agents page." />}
          {tab === 'plugins' && <RedirectTab to="/plugins" label="Plugins are managed in the Plugins page." />}
          {tab === 'tools' && <ToolsTab />}
          {tab === 'memory' && <MemoryTab settings={settings} />}
          {tab === 'files' && <FilesTab settings={settings} />}
          {tab === 'github' && <GitHubTab />}
          {tab === 'security' && <SecurityTab settings={settings} />}
          {tab === 'advanced' && <AdvancedTab settings={settings} />}
        </div>
      </div>
    </div>
  );
}

function RedirectTab({ to, label }: { to: string; label: string }) {
  return (
    <div className="card">
      <p className="dim">{label}</p>
      <a className="btn primary" href={to}>Open page</a>
    </div>
  );
}

function SaveBar({ onSave, dirty }: { onSave: () => void; dirty: boolean }) {
  return dirty ? (
    <div className="row" style={{ marginTop: 12 }}>
      <button className="btn primary" onClick={onSave}>Save changes</button>
      <span className="hint">Unsaved changes</span>
    </div>
  ) : null;
}

function useSection(section: string, initial: any) {
  const app = useApp();
  const [draft, setDraft] = useState<any>(initial);
  useEffect(() => { setDraft(initial); }, [JSON.stringify(initial)]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(app.settings?.[section]);
  const save = async () => { await app.saveSettings(section, draft); useApp.getState().toast('Settings saved', 'ok'); };
  return { draft, setDraft, dirty, save };
}

function GeneralTab({ settings }: { settings: any }) {
  const { draft, setDraft, dirty, save } = useSection('general', settings.general);
  return (
    <div className="card">
      <label className="field"><span>App name</span>
        <input className="input" value={draft.appName} onChange={(e) => setDraft({ ...draft, appName: e.target.value })} />
      </label>
      <label className="field"><span>Tagline</span>
        <input className="input" value={draft.tagline} onChange={(e) => setDraft({ ...draft, tagline: e.target.value })} />
      </label>
      <label className="row" style={{ cursor: 'pointer' }}>
        <input type="checkbox" checked={draft.demoBanner} onChange={(e) => setDraft({ ...draft, demoBanner: e.target.checked })} />
        <span style={{ fontSize: 13.5 }}>Show DEMO badges when simulated providers answer</span>
      </label>
      <SaveBar dirty={dirty} onSave={save} />
    </div>
  );
}

function AppearanceTab() {
  const app = useApp();
  return (
    <div className="card">
      <div className="section-title" style={{ marginTop: 0 }}>Theme</div>
      <div className="row">
        {(['dark', 'light', 'system'] as const).map((t) => (
          <button key={t} className={`btn ${app.theme === t ? 'primary' : ''}`} onClick={() => app.setTheme(t)}>{t}</button>
        ))}
      </div>
      <div className="section-title">Accent</div>
      <div className="row">
        {['ember', 'cobalt', 'moss', 'violet'].map((a) => (
          <button key={a} className={`btn ${app.accent === a ? 'primary' : ''}`} onClick={() => app.setAccent(a)}>{a}</button>
        ))}
      </div>
      <div className="section-title">Density</div>
      <div className="row">
        {['comfortable', 'compact'].map((d) => (
          <button key={d} className={`btn ${app.density === d ? 'primary' : ''}`} onClick={() => app.setDensity(d)}>{d}</button>
        ))}
      </div>
      <div className="section-title">Sidebar</div>
      <label className="row" style={{ cursor: 'pointer' }}>
        <input type="checkbox" checked={app.sidebarCollapsed} onChange={(e) => app.setSidebarCollapsed(e.target.checked)} />
        <span style={{ fontSize: 13.5 }}>Start with sidebar collapsed (remembered per browser)</span>
      </label>
    </div>
  );
}

function ModelsTab({ settings }: { settings: any }) {
  const { draft, setDraft, dirty, save } = useSection('models', settings.models);
  const [providers, setProviders] = useState<any[]>([]);
  const [imageStatus, setImageStatus] = useState<any>(null);
  const [videoStatus, setVideoStatus] = useState<any>(null);
  useEffect(() => {
    api.get('/models').then(({ providers }) => setProviders(providers)).catch(() => undefined);
    api.get('/images/status').then(setImageStatus).catch(() => undefined);
    api.get('/videos/status').then(setVideoStatus).catch(() => undefined);
  }, []);
  const selected = providers.find((p) => p.provider.id === draft.defaultProviderId);
  return (
    <div>
      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>Default model</div>
        <label className="field"><span>Provider</span>
          <select className="input" value={draft.defaultProviderId} onChange={(e) => setDraft({ ...draft, defaultProviderId: e.target.value, defaultModel: '' })}>
            <option value="">Automatic (default provider)</option>
            {providers.map((p) => <option key={p.provider.id} value={p.provider.id}>{p.provider.name}{p.reachable ? '' : ' (offline)'}</option>)}
          </select>
        </label>
        <label className="field"><span>Model</span>
          <select className="input" value={draft.defaultModel} onChange={(e) => setDraft({ ...draft, defaultModel: e.target.value })}>
            <option value="">Provider default</option>
            {(selected?.models || []).map((m: any) => <option key={m.id} value={m.id}>{m.name}{m.size ? ` · ${m.size}` : ''}{m.context ? ` · ${m.context.toLocaleString()} ctx` : ''}</option>)}
          </select>
        </label>
        <label className="row" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={draft.showTokenStats} onChange={(e) => setDraft({ ...draft, showTokenStats: e.target.checked })} />
          <span style={{ fontSize: 13.5 }}>Show token counts on messages</span>
        </label>
        <label className="row" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={draft.showSpeed} onChange={(e) => setDraft({ ...draft, showSpeed: e.target.checked })} />
          <span style={{ fontSize: 13.5 }}>Show generation speed (tokens/second)</span>
        </label>
        <SaveBar dirty={dirty} onSave={save} />
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ marginTop: 0 }}>Image generation</div>
        {imageStatus ? (
          imageStatus.configured
            ? <div className="row"><span className="badge ok">configured</span><code className="inline">{imageStatus.baseUrl}</code></div>
            : <div className="dim" style={{ fontSize: 13 }}>{imageStatus.instructions}</div>
        ) : <Spinner />}
        <div className="section-title">Video generation</div>
        {videoStatus ? (
          videoStatus.configured
            ? <div className="row"><span className="badge ok">provider registered</span></div>
            : <div className="dim" style={{ fontSize: 13 }}>{videoStatus.instructions}</div>
        ) : <Spinner />}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ marginTop: 0 }}>Ollama</div>
        <OllamaStatus />
      </div>
    </div>
  );
}

function OllamaStatus() {
  const [status, setStatus] = useState<any>(null);
  const load = () => api.get('/ollama/status').then(setStatus).catch(() => setStatus({ configured: false }));
  useEffect(() => { load(); }, []);
  if (!status) return <Spinner label="Checking Ollama…" />;
  if (!status.configured) return <div className="dim">Ollama provider not present.</div>;
  return (
    <div>
      <div className="row">
        {status.ok ? <span className="badge ok">reachable</span> : <span className="badge err">offline</span>}
        <span className="dim" style={{ fontSize: 13 }}>{status.message}</span>
        <button className="btn ghost sm" onClick={load}>⟳ refresh</button>
      </div>
      {status.models?.length ? (
        <table className="file-table" style={{ marginTop: 8 }}>
          <thead><tr><th>Model</th><th>Size</th><th>Context</th><th>State</th></tr></thead>
          <tbody>
            {status.models.map((m: any) => (
              <tr key={m.id}>
                <td className="mono">{m.name}</td>
                <td className="dim">{m.size || '—'}</td>
                <td className="dim">{m.context ? m.context.toLocaleString() : '—'}</td>
                <td><StatusBadge status={m.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <div className="hint" style={{ marginTop: 6 }}>No models detected. Pull one with <code className="inline">ollama pull llama3.2</code> — nothing is assumed installed.</div>}
    </div>
  );
}

function ProvidersTab() {
  const [providers, setProviders] = useState<any[]>([]);
  const [editing, setEditing] = useState<any>(null);
  const [confirmDel, setConfirmDel] = useState<any>(null);
  const toast = useApp((s) => s.toast);
  const load = () => api.get('/providers').then(({ providers }) => setProviders(providers)).catch((e) => toast(errorMessage(e), 'err'));
  useEffect(() => { load(); }, []);

  const probe = async (id: string) => {
    toast('Probing provider…', 'info');
    const res = await api.post(`/providers/${id}/probe`);
    toast(res.ok ? `Reachable: ${res.message}` : `Unreachable: ${res.message}`, res.ok ? 'ok' : 'err');
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="grow dim" style={{ fontSize: 13 }}>Configure OpenAI-compatible endpoints, Ollama or fully custom HTTP providers. API keys are encrypted at rest and never sent to the browser.</div>
        <button className="btn primary" onClick={() => setEditing({ name: '', kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', chatPath: '/chat/completions', responseMode: 'openai-sse', apiKey: '', headers: {}, bodyParams: {}, contextWindow: 128000, tags: [], icon: '◆', pricingInput: 0, pricingOutput: 0, enabled: true, isDefault: false, apiVersion: '' })}>＋ Add provider</button>
      </div>
      <div className="grid">
        {providers.map((p) => (
          <div key={p.id} className="card">
            <div className="spread">
              <b>{p.icon} {p.name}</b>
              <div className="row">
                <span className="badge">{p.kind}</span>
                {p.isDefault ? <span className="badge accent">default</span> : null}
                <StatusBadge status={p.enabled ? 'enabled' : 'disabled'} />
              </div>
            </div>
            <div className="dim mono" style={{ fontSize: 12, margin: '6px 0' }}>{p.baseUrl || '(built-in)'}</div>
            <div className="row wrap" style={{ fontSize: 11.5 }}>
              {p.hasApiKey ? <span className="badge ok">key set {p.apiKeyMasked}</span> : <span className="badge">no key</span>}
              <span className="badge">{p.contextWindow.toLocaleString()} ctx</span>
              {p.tags?.map((t: string) => <span key={t} className="badge">{t}</span>)}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn sm" onClick={() => probe(p.id)}>Probe</button>
              <button className="btn sm" onClick={() => setEditing({ ...p, apiKey: '' })}>Edit</button>
              {!p.isDefault && <button className="btn sm" onClick={async () => { await api.patch(`/providers/${p.id}`, { isDefault: true }); load(); }}>Make default</button>}
              <button className="btn sm" onClick={async () => { await api.patch(`/providers/${p.id}`, { enabled: !p.enabled }); load(); }}>{p.enabled ? 'Disable' : 'Enable'}</button>
              {p.kind !== 'demo' && <button className="btn ghost sm" onClick={() => setConfirmDel(p)}>Delete</button>}
            </div>
          </div>
        ))}
      </div>
      {editing && <ProviderEditor value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {confirmDel && <Confirm title="Delete provider?" body={`${confirmDel.name} will be removed. Chats keep their history.`} onClose={() => setConfirmDel(null)} onConfirm={async () => { await api.del(`/providers/${confirmDel.id}`); load(); }} />}
    </div>
  );
}

function ProviderEditor({ value, onClose, onSaved }: { value: any; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState(value);
  const [headersText, setHeadersText] = useState(JSON.stringify(value.headers || {}, null, 2));
  const [bodyText, setBodyText] = useState(JSON.stringify(value.bodyParams || {}, null, 2));
  const toast = useApp((s) => s.toast);
  const isNew = !value.id;

  const save = async () => {
    let headers = {}; let bodyParams = {};
    try { headers = JSON.parse(headersText || '{}'); } catch { toast('Headers must be valid JSON', 'err'); return; }
    try { bodyParams = JSON.parse(bodyText || '{}'); } catch { toast('Body params must be valid JSON', 'err'); return; }
    const payload = { ...form, headers, bodyParams, ...(form.apiKey ? { apiKey: form.apiKey } : {}) };
    delete payload.apiKeyMasked; delete payload.hasApiKey;
    try {
      if (isNew) await api.post('/providers', payload);
      else await api.patch(`/providers/${form.id}`, payload);
      toast('Provider saved', 'ok');
      onSaved();
    } catch (err) { toast(errorMessage(err), 'err'); }
  };

  return (
    <Modal wide title={isNew ? 'Add provider' : `Edit ${value.name}`} onClose={onClose}>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label className="field"><span>Name</span><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label className="field"><span>Kind</span>
          <select className="input" value={form.kind} disabled={!isNew} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            {['openai-compatible', 'ollama', 'custom', 'demo'].map((k) => <option key={k}>{k}</option>)}
          </select>
        </label>
        <label className="field"><span>Base URL</span><input className="input" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="http://localhost:11434 or https://api.openai.com/v1" /></label>
        <label className="field"><span>API version</span><input className="input" value={form.apiVersion} onChange={(e) => setForm({ ...form, apiVersion: e.target.value })} /></label>
        <label className="field"><span>API key (stored encrypted)</span><input className="input" type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder={value.hasApiKey ? 'unchanged' : 'sk-…'} /></label>
        <label className="field"><span>Chat path</span><input className="input" value={form.chatPath} onChange={(e) => setForm({ ...form, chatPath: e.target.value })} /></label>
        <label className="field"><span>Response mode</span>
          <select className="input" value={form.responseMode} onChange={(e) => setForm({ ...form, responseMode: e.target.value })}>
            {['openai-sse', 'json-text', 'ndjson-ollama'].map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
        <label className="field"><span>Context window</span><input className="input" type="number" value={form.contextWindow} onChange={(e) => setForm({ ...form, contextWindow: Number(e.target.value) })} /></label>
        <label className="field"><span>Pricing input ($/1M)</span><input className="input" type="number" step="0.01" value={form.pricingInput} onChange={(e) => setForm({ ...form, pricingInput: Number(e.target.value) })} /></label>
        <label className="field"><span>Pricing output ($/1M)</span><input className="input" type="number" step="0.01" value={form.pricingOutput} onChange={(e) => setForm({ ...form, pricingOutput: Number(e.target.value) })} /></label>
        <label className="field"><span>Icon glyph</span><input className="input" value={form.icon} maxLength={4} onChange={(e) => setForm({ ...form, icon: e.target.value })} /></label>
        <label className="field"><span>Tags (comma separated)</span><input className="input" value={(form.tags || []).join(', ')} onChange={(e) => setForm({ ...form, tags: e.target.value.split(',').map((t: string) => t.trim()).filter(Boolean) })} /></label>
      </div>
      <label className="field"><span>Custom headers (JSON)</span>
        <textarea className="input mono" rows={3} value={headersText} onChange={(e) => setHeadersText(e.target.value)} />
      </label>
      <label className="field"><span>Extra body parameters (JSON)</span>
        <textarea className="input mono" rows={3} value={bodyText} onChange={(e) => setBodyText(e.target.value)} />
      </label>
      <div className="row">
        <label className="row" style={{ cursor: 'pointer' }}><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /><span style={{ fontSize: 13.4 }}>Enabled</span></label>
        <label className="row" style={{ cursor: 'pointer' }}><input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} /><span style={{ fontSize: 13.4 }}>Default provider</span></label>
        <div className="grow" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}>Save provider</button>
      </div>
    </Modal>
  );
}

function ToolsTab() {
  const [tools, setTools] = useState<any[]>([]);
  useEffect(() => { api.get('/tools').then(({ tools }) => setTools(tools)).catch(() => undefined); }, []);
  return (
    <div className="card">
      <div className="hint" style={{ marginBottom: 10 }}>Registered tools and their permission requirements. Dangerous tools always ask for confirmation before running.</div>
      <table className="file-table">
        <thead><tr><th>Tool</th><th>Permissions</th><th>Risk</th><th>Description</th></tr></thead>
        <tbody>
          {tools.map((t) => (
            <tr key={t.name}>
              <td><code className="inline">{t.name}</code></td>
              <td>{t.permissions?.length ? t.permissions.map((p: string) => <span key={p} className="badge" style={{ marginRight: 4 }}>{p}</span>) : <span className="faint">none</span>}</td>
              <td>{t.dangerous ? <span className="badge warn">confirm</span> : <span className="badge ok">safe</span>}</td>
              <td className="dim" style={{ fontSize: 12.4 }}>{t.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MemoryTab({ settings }: { settings: any }) {
  const { draft, setDraft, dirty, save } = useSection('memory', settings.memory);
  const [memories, setMemories] = useState<any[]>([]);
  const toast = useApp((s) => s.toast);
  const load = () => api.get('/memory').then(({ memories }) => setMemories(memories)).catch(() => undefined);
  useEffect(() => { load(); }, []);
  return (
    <div>
      <div className="card">
        <label className="row" style={{ cursor: 'pointer' }}><input type="checkbox" checked={draft.conversationMemory} onChange={(e) => setDraft({ ...draft, conversationMemory: e.target.checked })} /><span style={{ fontSize: 13.5 }}>Conversation memory (recent messages included in context)</span></label>
        <label className="row" style={{ cursor: 'pointer' }}><input type="checkbox" checked={draft.agentMemory} onChange={(e) => setDraft({ ...draft, agentMemory: e.target.checked })} /><span style={{ fontSize: 13.5 }}>Agent memory (facts stored per agent)</span></label>
        <label className="row" style={{ cursor: 'pointer' }}><input type="checkbox" checked={draft.workspaceMemory} onChange={(e) => setDraft({ ...draft, workspaceMemory: e.target.checked })} /><span style={{ fontSize: 13.5 }}>Workspace memory (shared facts)</span></label>
        <label className="field" style={{ marginTop: 10 }}><span>Messages kept in conversation context</span>
          <input className="input" type="number" min={2} max={200} value={draft.maxConversationMessages} onChange={(e) => setDraft({ ...draft, maxConversationMessages: Number(e.target.value) })} style={{ maxWidth: 120 }} />
        </label>
        <div className="hint">Secret-looking values (API keys, tokens, passwords) are automatically refused and redacted before storage.</div>
        <SaveBar dirty={dirty} onSave={save} />
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="spread"><b style={{ fontSize: 14 }}>Stored memories</b><button className="btn ghost sm" onClick={load}>⟳</button></div>
        {!memories.length ? <div className="dim" style={{ fontSize: 13, marginTop: 6 }}>Nothing stored yet.</div> : (
          <div style={{ marginTop: 8 }}>
            {memories.map((m) => (
              <div key={m.id} className="row" style={{ padding: '5px 0', borderBottom: '1px solid var(--border-soft)' }}>
                <span className="badge">{m.scope}</span>
                <span className="grow dim" style={{ fontSize: 13 }}>{m.content}</span>
                <button className="btn ghost sm" onClick={async () => { await api.del(`/memory/${m.id}`); load(); }}>🗑</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FilesTab({ settings }: { settings: any }) {
  const { draft, setDraft, dirty, save } = useSection('files', settings.files);
  return (
    <div className="card">
      <label className="field"><span>Max upload size (MB)</span>
        <input className="input" type="number" min={1} max={500} value={draft.maxUploadMb} onChange={(e) => setDraft({ ...draft, maxUploadMb: Number(e.target.value) })} style={{ maxWidth: 120 }} />
      </label>
      <label className="field"><span>Text preview cap (KB)</span>
        <input className="input" type="number" min={16} max={8192} value={draft.previewMaxKb} onChange={(e) => setDraft({ ...draft, previewMaxKb: Number(e.target.value) })} style={{ maxWidth: 120 }} />
      </label>
      <SaveBar dirty={dirty} onSave={save} />
    </div>
  );
}

function GitHubTab() {
  const [status, setStatus] = useState<any>(null);
  const [repos, setRepos] = useState<any[]>([]);
  const [pat, setPat] = useState('');
  const toast = useApp((s) => s.toast);
  const load = () => api.get('/github/status').then(setStatus).catch(() => setStatus(null));
  useEffect(() => { load(); }, []);
  useEffect(() => { if (status?.connected) api.get('/github/repos').then(({ repos }) => setRepos(repos)).catch(() => setRepos([])); }, [status?.connected]);

  const connectOAuth = async () => {
    try {
      const { url } = await api.get('/github/oauth/start');
      window.open(url, '_blank', 'width=600,height=700');
      toast('Complete the authorization in the opened window.', 'info');
    } catch (err) { toast(errorMessage(err), 'err'); }
  };

  return (
    <div className="card">
      {status?.connected ? (
        <>
          <div className="row" style={{ gap: 12 }}>
            {status.avatarUrl ? <img src={status.avatarUrl} alt="" width={40} height={40} style={{ borderRadius: 20 }} /> : null}
            <div className="grow">
              <b>@{status.login}</b>
              <div className="faint" style={{ fontSize: 12 }}>via {status.authMethod === 'pat' ? 'Personal Access Token' : 'OAuth'} · token {status.tokenMasked}</div>
            </div>
            <button className="btn danger sm" onClick={async () => { await api.post('/github/disconnect'); load(); }}>Disconnect</button>
          </div>
          <div className="section-title">Authorized repositories</div>
          {!repos.length ? <div className="dim" style={{ fontSize: 13 }}>No repositories visible to this token.</div> : (
            <div style={{ maxHeight: 260, overflow: 'auto' }}>
              {repos.map((r) => (
                <div key={r.fullName} className="row" style={{ padding: '4px 0', fontSize: 13 }}>
                  <span className="grow mono">{r.fullName}</span>
                  <span className="badge">{r.language || '—'}</span>
                  {r.private ? <span className="badge warn">private</span> : null}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <b>Connect GitHub</b>
          <div className="dim" style={{ fontSize: 13, margin: '8px 0' }}>
            {status?.instructions}
          </div>
          <div className="row" style={{ margin: '10px 0' }}>
            <button className="btn primary" onClick={connectOAuth}>⑂ Connect with OAuth</button>
            <button className="btn" onClick={load}>⟳ refresh status</button>
          </div>
          <div className="section-title">…or use a Personal Access Token</div>
          <div className="row">
            <input className="input" type="password" placeholder="ghp_… / github_pat_…" value={pat} onChange={(e) => setPat(e.target.value)} />
            <button className="btn" onClick={async () => {
              try { await api.post('/github/connect-pat', { token: pat }); setPat(''); toast('GitHub connected', 'ok'); load(); } catch (err) { toast(errorMessage(err), 'err'); }
            }}>Connect PAT</button>
          </div>
          <div className="hint" style={{ marginTop: 8 }}>Tokens are encrypted with AES-256-GCM before hitting the database and are never exposed to the frontend.</div>
        </>
      )}
    </div>
  );
}

function SecurityTab({ settings }: { settings: any }) {
  const { draft, setDraft, dirty, save } = useSection('security', settings.security);
  const perms = draft.toolPermissions || settings.security.toolPermissions || ['READ_FILES', 'NETWORK_ACCESS'];
  const toggle = (p: string) => setDraft({ ...draft, toolPermissions: perms.includes(p) ? perms.filter((x: string) => x !== p) : [...perms, p] });
  return (
    <div className="card">
      <div className="section-title" style={{ marginTop: 0 }}>Global tool permission allow-list</div>
      <div className="row wrap">
        {PERMISSIONS.map((p) => (
          <button key={p} className={`badge ${perms.includes(p) ? 'accent' : ''}`} style={{ cursor: 'pointer', padding: '6px 12px' }} onClick={() => toggle(p)}>{p}</button>
        ))}
      </div>
      <div className="hint" style={{ marginTop: 8 }}>Agent permissions are intersected with this list. Tools needing anything else ask for explicit confirmation at runtime.</div>
      <label className="row" style={{ marginTop: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={draft.requireApprovalForDangerous} onChange={(e) => setDraft({ ...draft, requireApprovalForDangerous: e.target.checked })} />
        <span style={{ fontSize: 13.5 }}>Require confirmation for dangerous tools (write files, run commands, GitHub writes)</span>
      </label>
      <SaveBar dirty={dirty} onSave={save} />
    </div>
  );
}

function AdvancedTab({ settings }: { settings: any }) {
  const { draft, setDraft, dirty, save } = useSection('advanced', settings.advanced);
  return (
    <div className="card">
      <label className="row" style={{ cursor: 'pointer' }}><input type="checkbox" checked={draft.streamResponses} onChange={(e) => setDraft({ ...draft, streamResponses: e.target.checked })} /><span style={{ fontSize: 13.5 }}>Stream responses token by token</span></label>
      <label className="field" style={{ marginTop: 10 }}><span>Max tool-call iterations per completion</span>
        <input className="input" type="number" min={1} max={20} value={draft.toolLoopMaxIterations} onChange={(e) => setDraft({ ...draft, toolLoopMaxIterations: Number(e.target.value) })} style={{ maxWidth: 120 }} />
      </label>
      <div className="hint">Backend logs live in data/logs/ (levels INFO/WARN/ERROR/DEBUG, secrets redacted). View them live in System Status.</div>
      <SaveBar dirty={dirty} onSave={save} />
    </div>
  );
}
