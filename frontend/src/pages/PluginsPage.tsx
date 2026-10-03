import React, { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { useApp } from '../store/app';
import { Modal, StatusBadge, Spinner } from '../components/ui';

const CATEGORIES = ['All', 'Productivity', 'Developer', 'Search', 'Files', 'Media', 'GitHub', 'Automation', 'AI', 'Utilities'];

export function PluginsPage() {
  const [plugins, setPlugins] = useState<any[]>([]);
  const [tab, setTab] = useState<'installed' | 'marketplace'>('installed');
  const [category, setCategory] = useState('All');
  const [configFor, setConfigFor] = useState<any>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const toast = useApp((s) => s.toast);

  const load = async () => {
    try {
      const { plugins } = await api.get('/plugins');
      setPlugins(plugins);
    } catch (err) { toast(errorMessage(err), 'err'); }
  };
  useEffect(() => { load(); }, []);

  const act = async (id: string, action: string) => {
    try {
      await api.post(`/plugins/${id}/${action}`);
      toast(`Plugin ${action}`, 'ok');
      await load();
    } catch (err) { toast(errorMessage(err), 'err'); await load(); }
  };

  const installed = plugins.filter((p) => p.status !== 'not_installed');
  const market = plugins.filter((p) => p.status === 'not_installed' && (category === 'All' || p.category === category));
  const shownInstalled = installed.filter((p) => category === 'All' || p.category === category);

  const openConfig = (p: any) => {
    setConfigFor(p);
    setConfigValues(Object.fromEntries(Object.entries(p.config || {}).map(([k, v]) => [k, String(v ?? '')])));
  };

  const saveConfig = async () => {
    try {
      await api.patch(`/plugins/${configFor.id}/config`, configValues);
      toast('Plugin configuration saved', 'ok');
      setConfigFor(null);
      await load();
    } catch (err) { toast(errorMessage(err), 'err'); }
  };

  if (!plugins.length) return <div className="page"><Spinner label="Loading plugins…" /></div>;

  return (
    <div className="page">
      <div className="page-title">
        <h1>Plugins</h1>
        <span className="badge">{installed.length} installed</span>
        <div className="grow" />
        <button className="btn sm" onClick={() => api.post('/plugins/sync').then(load)} title="Re-scan the /plugins directory">⟳ Rescan packs</button>
      </div>
      <p className="dim" style={{ marginTop: -10, maxWidth: 720 }}>
        Plugins contribute tools and capabilities to agents. Nothing external is ever connected without
        your explicit install + enable, and configuration secrets stay encrypted in the local database.
      </p>

      <div className="tabs">
        <button className={`tab ${tab === 'installed' ? 'active' : ''}`} onClick={() => setTab('installed')}>Plugin Manager</button>
        <button className={`tab ${tab === 'marketplace' ? 'active' : ''}`} onClick={() => setTab('marketplace')}>Marketplace</button>
      </div>

      <div className="row wrap" style={{ marginBottom: 14 }}>
        {CATEGORIES.map((c) => (
          <button key={c} className={`badge ${category === c ? 'accent' : ''}`} style={{ cursor: 'pointer', padding: '4px 10px' }} onClick={() => setCategory(c)}>{c}</button>
        ))}
      </div>

      <div className="grid cols-2">
        {(tab === 'installed' ? shownInstalled : market).map((p) => (
          <div key={p.id} className="card plugin-card">
            <div className="head">
              <span className="plugin-icon">{p.icon}</span>
              <div className="grow">
                <div className="spread">
                  <b style={{ fontSize: 14.2 }}>{p.name}</b>
                  <StatusBadge status={p.status} />
                </div>
                <div className="faint" style={{ fontSize: 11.5 }}>v{p.version} · {p.author} · {p.category}</div>
              </div>
            </div>
            <div className="dim" style={{ fontSize: 12.9 }}>{p.description}</div>
            <div className="row wrap" style={{ fontSize: 11.5 }}>
              {p.tools?.map((t: string) => <code key={t} className="inline">{t}</code>)}
              {p.permissions?.map((perm: string) => <span key={perm} className="badge">{perm}</span>)}
            </div>
            {p.requiresService ? <div className="hint">Requires: {p.requiresService === 'github' ? 'a connected GitHub account' : 'an image provider (or DEMO mode)'}</div> : null}
            <div className="row" style={{ marginTop: 'auto', paddingTop: 6 }}>
              {p.status === 'not_installed' ? (
                <button className="btn primary sm" onClick={() => act(p.id, 'install')}>Install</button>
              ) : (
                <>
                  {p.status === 'enabled'
                    ? <button className="btn sm" onClick={() => act(p.id, 'disable')}>Disable</button>
                    : <button className="btn primary sm" onClick={() => act(p.id, 'enable')}>Enable</button>}
                  {(p.configSchema?.fields?.length || 0) > 0 && (
                    <button className="btn sm" onClick={() => openConfig(p)}>Configure</button>
                  )}
                  <button className="btn ghost sm" onClick={() => act(p.id, 'uninstall')}>Uninstall</button>
                </>
              )}
            </div>
          </div>
        ))}
        {(tab === 'installed' ? shownInstalled : market).length === 0 && (
          <div className="empty" style={{ gridColumn: '1/-1' }}>
            <h3>{tab === 'installed' ? 'Nothing installed in this category' : 'No marketplace entries in this category'}</h3>
            <p>Switch category or visit the Marketplace tab to install plugin packs shipped in /plugins.</p>
          </div>
        )}
      </div>

      {configFor && (
        <Modal title={`Configure ${configFor.name}`} onClose={() => setConfigFor(null)}>
          {configFor.configSchema?.fields?.map((f: any) => (
            <label key={f.name} className="field">
              <span>{f.label || f.name}{f.secret ? ' (secret, stored encrypted)' : ''}</span>
              <input
                className="input"
                type={f.secret ? 'password' : f.type === 'number' ? 'number' : 'text'}
                placeholder={f.placeholder || ''}
                value={configValues[f.name] ?? ''}
                onChange={(e) => setConfigValues((v) => ({ ...v, [f.name]: e.target.value }))}
              />
            </label>
          ))}
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
            <button className="btn" onClick={() => setConfigFor(null)}>Cancel</button>
            <button className="btn primary" onClick={saveConfig}>Save configuration</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
