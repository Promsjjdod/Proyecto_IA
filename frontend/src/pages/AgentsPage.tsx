import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useApp } from '../store/app';
import { Confirm, Empty, Spinner, StatusBadge } from '../components/ui';

const BLANK = {
  name: '', description: '', avatar: '◈', model: '', providerId: '', systemPrompt: '',
  tools: [] as string[], plugins: [] as string[],
  memory: { conversation: true, agent: true, workspace: false, retention: 'persistent' },
  contextWindow: 128000, temperature: 0.7, maxTokens: 4096, permissions: ['READ_FILES'] as string[],
  enabled: true,
};

export function AgentsPage() {
  const [agents, setAgents] = useState<any[]>([]);
  const nav = useNavigate();
  const [params] = useSearchParams();
  const toast = useApp((s) => s.toast);

  const load = () => api.get('/agents').then(({ agents }) => setAgents(agents)).catch((e) => toast(errorMessage(e), 'err'));
  useEffect(() => { load(); if (params.get('new')) nav('/agents/new', { replace: true }); }, []);

  return (
    <div className="page">
      <div className="page-title">
        <h1>Agents</h1>
        <div className="grow" />
        <button className="btn primary" onClick={() => nav('/agents/new')}>＋ New agent</button>
      </div>
      <p className="dim" style={{ marginTop: -10, maxWidth: 700 }}>
        Agents bundle a system prompt, model, tools, plugins, memory and permissions. Use them in chat or in WORK tasks.
      </p>
      <div className="grid cols-2">
        {agents.map((a) => (
          <button key={a.id} className="card" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => nav(`/agents/${a.id}`)}>
            <div className="row" style={{ gap: 12 }}>
              <span className="plugin-icon">{a.avatar}</span>
              <div className="grow">
                <div className="spread"><b>{a.name}</b>{a.builtin ? <span className="badge">built-in</span> : null}</div>
                <div className="dim" style={{ fontSize: 12.8, margin: '4px 0' }}>{a.description}</div>
                <div className="row wrap faint" style={{ fontSize: 11.5 }}>
                  <span>{a.tools.length} tools</span>·<span>{a.plugins.length} plugins</span>·<span>T° {a.temperature}</span>·<span>{a.contextWindow.toLocaleString()} ctx</span>
                </div>
              </div>
              <StatusBadge status={a.enabled ? 'enabled' : 'disabled'} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function AgentEditorPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useApp((s) => s.toast);
  const [form, setForm] = useState<any>(null);
  const [options, setOptions] = useState<any>({ tools: [], plugins: [], permissions: [] });
  const [providers, setProviders] = useState<any[]>([]);
  const [confirmDel, setConfirmDel] = useState(false);
  const isNew = id === 'new';

  useEffect(() => {
    api.get('/agents/options').then(setOptions).catch(() => undefined);
    api.get('/models').then(({ providers }) => setProviders(providers)).catch(() => undefined);
    if (!isNew) api.get(`/agents/${id}`).then(({ agent }) => setForm(agent)).catch((e) => toast(errorMessage(e), 'err'));
    else setForm(structuredClone(BLANK));
  }, [id]);

  if (!form) return <div className="page"><Spinner label="Loading agent…" /></div>;
  const set = (patch: any) => setForm((f: any) => ({ ...f, ...patch }));

  const save = async () => {
    try {
      if (isNew) {
        const { agent } = await api.post('/agents', form);
        toast('Agent created', 'ok');
        nav(`/agents/${agent.id}`);
      } else {
        await api.patch(`/agents/${id}`, form);
        toast('Agent saved', 'ok');
      }
    } catch (err) { toast(errorMessage(err), 'err'); }
  };

  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-title">
        <button className="btn ghost sm" onClick={() => nav('/agents')}>← Agents</button>
        <h1 style={{ fontSize: 18 }}>{isNew ? 'New agent' : form.name}</h1>
        <div className="grow" />
        {!isNew && <button className="btn danger sm" onClick={() => setConfirmDel(true)}>{form.builtin ? 'Disable' : 'Delete'}</button>}
        <button className="btn primary" onClick={save}>Save</button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <label className="field"><span>Name</span>
          <input className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Developer Agent" />
        </label>
        <label className="field"><span>Avatar (single glyph)</span>
          <input className="input" value={form.avatar} maxLength={4} onChange={(e) => set({ avatar: e.target.value })} />
        </label>
      </div>
      <label className="field"><span>Description</span>
        <textarea className="input" rows={2} value={form.description} onChange={(e) => set({ description: e.target.value })} />
      </label>
      <label className="field"><span>System prompt</span>
        <textarea className="input" rows={6} value={form.systemPrompt} onChange={(e) => set({ systemPrompt: e.target.value })}
          placeholder="You are a focused engineering agent. Inspect before editing…" />
      </label>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14 }}>
        <label className="field"><span>Provider</span>
          <select className="input" value={form.providerId} onChange={(e) => set({ providerId: e.target.value })}>
            <option value="">Default provider</option>
            {providers.map((p) => <option key={p.provider.id} value={p.provider.id}>{p.provider.name}</option>)}
          </select>
        </label>
        <label className="field"><span>Model</span>
          <select className="input" value={form.model} onChange={(e) => set({ model: e.target.value })}>
            <option value="">Provider default</option>
            {(providers.find((p) => p.provider.id === form.providerId)?.models || providers.find((p) => p.provider.isDefault)?.models || []).map((m: any) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </label>
        <label className="field"><span>Temperature {form.temperature}</span>
          <input type="range" min={0} max={2} step={0.1} value={form.temperature} onChange={(e) => set({ temperature: Number(e.target.value) })} style={{ width: '100%' }} />
        </label>
        <label className="field"><span>Max tokens</span>
          <input className="input" type="number" min={1} max={200000} value={form.maxTokens} onChange={(e) => set({ maxTokens: Number(e.target.value) })} />
        </label>
        <label className="field"><span>Context window</span>
          <input className="input" type="number" min={512} max={10000000} value={form.contextWindow} onChange={(e) => set({ contextWindow: Number(e.target.value) })} />
        </label>
      </div>

      <div className="section-title">Tools</div>
      <div className="row wrap">
        {options.tools?.map((t: any) => (
          <button key={t.name} className={`badge ${form.tools.includes(t.name) ? 'accent' : ''}`} style={{ cursor: 'pointer', padding: '5px 10px' }}
            onClick={() => set({ tools: toggle(form.tools, t.name) })} title={t.description}>
            {t.name}{t.dangerous ? ' ⚠' : ''}
          </button>
        ))}
      </div>

      <div className="section-title">Plugins</div>
      <div className="row wrap">
        {options.plugins?.map((p: any) => (
          <button key={p.id} className={`badge ${form.plugins.includes(p.id) ? 'accent' : ''}`} style={{ cursor: 'pointer', padding: '5px 10px' }}
            onClick={() => set({ plugins: toggle(form.plugins, p.id) })}>
            {p.icon} {p.name}
          </button>
        ))}
      </div>

      <div className="section-title">Permissions</div>
      <div className="row wrap">
        {options.permissions?.map((p: string) => (
          <button key={p} className={`badge ${form.permissions.includes(p) ? 'accent' : ''}`} style={{ cursor: 'pointer', padding: '5px 10px' }}
            onClick={() => set({ permissions: toggle(form.permissions, p) })}>
            {p}
          </button>
        ))}
      </div>
      <div className="hint">Permissions are intersected with the global allow-list in Settings → Security. Dangerous tools always require confirmation.</div>

      <div className="section-title">Memory</div>
      <div className="row wrap">
        {(['conversation', 'agent', 'workspace'] as const).map((scope) => (
          <label key={scope} className="row" style={{ cursor: 'pointer', gap: 6 }}>
            <input type="checkbox" checked={form.memory?.[scope] ?? false}
              onChange={(e) => set({ memory: { ...form.memory, [scope]: e.target.checked } })} />
            <span style={{ fontSize: 13.4 }}>{scope} memory</span>
          </label>
        ))}
        <select className="input" style={{ width: 'auto' }} value={form.memory?.retention || 'persistent'}
          onChange={(e) => set({ memory: { ...form.memory, retention: e.target.value } })}>
          <option value="persistent">persistent</option>
          <option value="session">session only</option>
        </select>
      </div>

      <label className="row" style={{ marginTop: 16, cursor: 'pointer' }}>
        <input type="checkbox" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        <span>Agent enabled</span>
      </label>

      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 18 }}>
        <button className="btn primary" onClick={save}>Save agent</button>
      </div>

      {confirmDel && (
        <Confirm
          title={form.builtin ? 'Disable built-in agent?' : 'Delete agent?'}
          body={form.builtin ? 'Built-in agents cannot be deleted; they will be disabled instead.' : 'The agent definition will be removed.'}
          confirmLabel={form.builtin ? 'Disable' : 'Delete'}
          onClose={() => setConfirmDel(false)}
          onConfirm={async () => { await api.del(`/agents/${id}`); nav('/agents'); }}
        />
      )}
    </div>
  );
}
