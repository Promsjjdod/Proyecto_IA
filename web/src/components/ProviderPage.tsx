import { useState } from 'react';
import { Activity, Check, ChevronDown, CircleAlert, ExternalLink, KeyRound, Link2, LoaderCircle, Plus, RefreshCw, Settings2, ShieldCheck, Trash2, Wifi, X } from 'lucide-react';
import type { Model, Provider } from '../types';
import { api } from '../api';
import { ErrorBanner, Modal, ProviderIcon } from './common';

const providerInfo: Record<string, { label: string; defaultUrl: string; hint: string }> = {
  openai: { label: 'OpenAI', defaultUrl: 'https://api.openai.com/v1', hint: 'API oficial de OpenAI.' },
  anthropic: { label: 'Anthropic', defaultUrl: 'https://api.anthropic.com/v1', hint: 'Claude API. Se usa el endpoint oficial de lista de modelos.' },
  google: { label: 'Google Gemini', defaultUrl: 'https://generativelanguage.googleapis.com/v1beta', hint: 'Gemini API. La clave se transmite al backend en la query del endpoint oficial, nunca al navegador.' },
  deepseek: { label: 'DeepSeek', defaultUrl: 'https://api.deepseek.com/v1', hint: 'API OpenAI-compatible de DeepSeek.' },
  ollama: { label: 'Ollama', defaultUrl: 'http://localhost:11434/v1', hint: 'La dirección se interpreta desde el servidor Nexus. Se permiten solo los orígenes exactos de OLLAMA_ALLOWED_URLS.' },
  'openai-compatible': { label: 'Compatible con OpenAI', defaultUrl: '', hint: 'URL base del API compatible. No incluyas /chat/completions.' },
  custom: { label: 'Proveedor personalizado', defaultUrl: '', hint: 'Para APIs personalizadas que implementen el protocolo OpenAI Chat Completions.' },
};
const capabilityLabels: [string, string][] = [['vision', 'Visión'], ['tools', 'Herramientas'], ['audioInput', 'Audio entrada'], ['audioOutput', 'Audio salida'], ['imageGeneration', 'Imágenes']];

export function ProviderPage({ providers, modelsByProvider, onRefresh }: { providers: Provider[]; modelsByProvider: Record<string, Model[]>; onRefresh: () => void }) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ type: 'openai', name: 'OpenAI', baseUrl: providerInfo.openai.defaultUrl, apiKey: '', headerName: 'Authorization', prefix: 'Bearer ' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [expanded, setExpanded] = useState<string | null>(providers[0]?.id || null);
  const [manual, setManual] = useState<{ provider: Provider; modelId: string; displayName: string; contextTokens: string } | null>(null);
  const [edit, setEdit] = useState<Provider | null>(null);
  const updateType = (type: string) => setForm((current) => ({ ...current, type, name: providerInfo[type]?.label || 'Proveedor', baseUrl: providerInfo[type]?.defaultUrl || '', apiKey: '' }));
  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy('create'); setError(''); setInfo('');
    try {
      await api('/providers', { method: 'POST', body: JSON.stringify({ type: form.type, name: form.name, baseUrl: form.baseUrl, apiKey: form.apiKey, authConfig: { headerName: form.headerName, prefix: form.prefix } }) });
      setShowAdd(false); setForm((current) => ({ ...current, apiKey: '' })); onRefresh(); setInfo('Proveedor guardado. Prueba la conexión para comprobar credenciales y detectar modelos.');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar el proveedor.'); }
    finally { setBusy(''); }
  };
  const test = async (provider: Provider) => {
    setBusy(`test-${provider.id}`); setError(''); setInfo('');
    try { const result = await api<{ count: number; firstModels: string[] }>(`/providers/${encodeURIComponent(provider.id)}/test`, { method: 'POST', body: '{}' }); setInfo(`Conexión verificada: ${result.count} modelo(s) listados${result.firstModels.length ? ` (${result.firstModels.slice(0, 3).join(', ')})` : ''}.`); onRefresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo conectar.'); onRefresh(); }
    finally { setBusy(''); }
  };
  const sync = async (provider: Provider) => {
    setBusy(`sync-${provider.id}`); setError(''); setInfo('');
    try { const result = await api<{ detected: number }>(`/providers/${encodeURIComponent(provider.id)}/models/sync`, { method: 'POST', body: '{}' }); setInfo(`${result.detected} modelo(s) sincronizados. Las capacidades se mantienen como desconocidas hasta configurarlas con datos del proveedor.`); setExpanded(provider.id); onRefresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo sincronizar modelos.'); }
    finally { setBusy(''); }
  };
  const remove = async (provider: Provider) => {
    if (!window.confirm(`Desconectar ${provider.name}? Se eliminará su credencial cifrada y su catálogo local.`)) return;
    setBusy(`delete-${provider.id}`); setError('');
    try { await api(`/providers/${encodeURIComponent(provider.id)}`, { method: 'DELETE' }); onRefresh(); setInfo(`${provider.name} desconectado.`); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo desconectar.'); }
    finally { setBusy(''); }
  };
  const addManual = async (event: React.FormEvent) => {
    event.preventDefault(); if (!manual) return;
    setBusy(`manual-${manual.provider.id}`); setError('');
    try { await api(`/providers/${encodeURIComponent(manual.provider.id)}/models`, { method: 'POST', body: JSON.stringify({ modelId: manual.modelId, displayName: manual.displayName, contextTokens: manual.contextTokens }) }); setManual(null); onRefresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo añadir modelo.'); }
    finally { setBusy(''); }
  };
  const editSave = async (event: React.FormEvent) => {
    event.preventDefault(); if (!edit) return;
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    setBusy(`edit-${edit.id}`); setError('');
    try { await api(`/providers/${encodeURIComponent(edit.id)}`, { method: 'PATCH', body: JSON.stringify({ name: formData.get('name'), baseUrl: formData.get('baseUrl'), apiKey: formData.get('apiKey') || undefined }) }); setEdit(null); onRefresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo actualizar.'); }
    finally { setBusy(''); }
  };
  const patchModel = async (provider: Provider, model: Model, patch: Record<string, unknown>) => {
    try { await api(`/providers/${encodeURIComponent(provider.id)}/models/${encodeURIComponent(model.id)}`, { method: 'PATCH', body: JSON.stringify(patch) }); onRefresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo actualizar el modelo.'); }
  };
  const removeModel = async (provider: Provider, model: Model) => {
    if (!window.confirm(`Quitar el modelo ${model.id} del catálogo local?`)) return;
    try { await api(`/providers/${encodeURIComponent(provider.id)}/models/${encodeURIComponent(model.id)}`, { method: 'DELETE' }); onRefresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo quitar el modelo.'); }
  };
  return <div className="page-content provider-page">
    <div className="page-heading-row"><div><div className="eyebrow"><span className="eyebrow-dot" /> CAPA DE CONEXIONES</div><h1>Proveedores de IA</h1><p>Conecta tus credenciales, sincroniza modelos y decide qué capacidades conoce Nexus.</p></div><button className="button button-primary" onClick={() => setShowAdd(true)}><Plus size={16} />Añadir proveedor</button></div>
    {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}{info && <div className="success-banner"><Check size={16} />{info}<button className="icon-button" onClick={() => setInfo('')}><X size={14} /></button></div>}
    <div className="security-callout"><ShieldCheck size={19} /><div><b>Las claves se cifran en el servidor</b><p>La interfaz nunca vuelve a recibir una clave guardada. Usa HTTPS en producción y define <code>PROVIDER_ENCRYPTION_KEY</code>.</p></div><span>BACKEND ONLY</span></div>
    <div className="provider-list">{providers.length ? providers.map((provider) => {
      const models = modelsByProvider[provider.id] || [];
      const isExpanded = expanded === provider.id;
      return <section className={`provider-card ${isExpanded ? 'provider-expanded' : ''}`} key={provider.id}>
        <div className="provider-card-main"><div className="provider-logo-tile"><ProviderIcon type={provider.type} size={24} /></div><div className="provider-details"><div className="provider-title-row"><h3>{provider.name}</h3><span className={`provider-state state-${provider.status}`}><i />{provider.status === 'connected' ? 'Conectado' : provider.status === 'error' ? 'Revisar conexión' : 'Sin probar'}</span></div><p>{providerInfo[provider.type]?.label || 'Proveedor personalizado'} <span>·</span> {provider.baseUrl}</p><div className="provider-meta-row"><span><KeyRound size={12} />{provider.hasKey ? 'Clave cifrada' : 'Sin clave configurada'}</span><span><Activity size={12} />{models.length} modelos</span>{provider.lastCheckedAt && <span><Wifi size={12} />Prueba {new Date(provider.lastCheckedAt).toLocaleString()}</span>}</div></div><div className="provider-card-actions"><button className="button button-secondary button-sm" onClick={() => void test(provider)} disabled={busy === `test-${provider.id}`}>{busy === `test-${provider.id}` ? <LoaderCircle className="spin" size={14} /> : <Wifi size={14} />}Probar</button><button className="icon-button" title="Editar configuración" onClick={() => setEdit(provider)}><Settings2 size={16} /></button><button className="icon-button danger-icon" title="Desconectar proveedor" onClick={() => void remove(provider)}><Trash2 size={15} /></button><button className="icon-button expand-provider" onClick={() => setExpanded(isExpanded ? null : provider.id)} title="Ver modelos"><ChevronDown size={17} className={isExpanded ? 'rotate-180' : ''} /></button></div></div>
        {isExpanded && <div className="provider-models-section"><div className="models-toolbar"><div><h4>Catálogo de modelos</h4><p>Detectados y añadidos manualmente se identifican por separado. Las funciones son desconocidas hasta configurarlas.</p></div><div><button className="button button-secondary button-sm" onClick={() => void sync(provider)} disabled={busy === `sync-${provider.id}`}>{busy === `sync-${provider.id}` ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}Sincronizar</button><button className="button button-quiet button-sm" onClick={() => setManual({ provider, modelId: '', displayName: '', contextTokens: '' })}><Plus size={14} />Añadir manualmente</button></div></div>
          {models.length ? <div className="model-table">{models.map((model) => <div className="model-row" key={model.id}><div className="model-main"><span className="model-favorite">{model.favorite ? '★' : '☆'}</span><div><b>{model.displayName}</b><code>{model.id}</code></div></div><span className={`model-source ${model.source}`}>{model.source === 'detected' ? 'Detectado' : 'Manual'}</span><span className={`model-status model-${model.status}`}>{model.status === 'available' ? 'Disponible' : model.status === 'unavailable' ? 'No disponible' : 'Sin comprobar'}</span><div className="model-capabilities">{capabilityLabels.map(([key, label]) => <label key={key} title={`${label} (configuración manual)`}><input type="checkbox" checked={model.capabilities?.[key] === true} onChange={(event) => void patchModel(provider, model, { capabilities: { [key]: event.target.checked } })} />{label}</label>)}</div><div className="model-actions"><button className={`icon-button ${model.favorite ? 'favorite-active' : ''}`} title={model.favorite ? 'Quitar favorito' : 'Marcar favorito'} onClick={() => void patchModel(provider, model, { favorite: !model.favorite })}>★</button><button className="icon-button danger-icon" title="Quitar modelo" onClick={() => void removeModel(provider, model)}><Trash2 size={14} /></button></div></div>)}</div> : <div className="models-empty"><CircleAlert size={16} /><span>No hay modelos. Prueba la conexión y sincroniza, o agrega un identificador conocido manualmente.</span></div>}
          <div className="model-capability-note"><b>Capacidades manuales:</b> actívalas solo después de confirmar la documentación del proveedor y el modelo exacto. No son una detección automática.</div>
        </div>}
      </section>;
    }) : <div className="provider-empty"><div className="provider-empty-icons"><ProviderIcon type="openai" size={25} /><ProviderIcon type="anthropic" size={25} /><ProviderIcon type="google" size={25} /><ProviderIcon type="deepseek" size={25} /><ProviderIcon type="ollama" size={25} /></div><h3>Tu espacio, tus modelos</h3><p>Añade un proveedor para empezar a chatear. Las claves se guardan cifradas en este servidor.</p><button className="button button-primary" onClick={() => setShowAdd(true)}><Plus size={16} />Conectar proveedor</button></div>}</div>
    {showAdd && <Modal title="Añadir proveedor" description="La credencial se cifra antes de guardarse. Solo se envía desde el backend al proveedor seleccionado." onClose={() => setShowAdd(false)}>
      <form className="form-stack" onSubmit={create}><label>Proveedor<select value={form.type} onChange={(event) => updateType(event.target.value)}>{Object.entries(providerInfo).map(([key, value]) => <option value={key} key={key}>{value.label}</option>)}</select></label>
        <label>Nombre visible<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required maxLength={80} /></label>
        <label>URL base<input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} required placeholder="https://…" /></label>
        <small className="field-help">{providerInfo[form.type]?.hint}</small>
        <label>Clave API{form.type === 'ollama' && <span className="optional-label">opcional</span>}<input type="password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} autoComplete="new-password" required={form.type !== 'ollama'} placeholder={form.type === 'ollama' ? 'Vacío si no está configurada' : 'Se cifra en el servidor'} /></label>
        {['custom', 'openai-compatible'].includes(form.type) && <div className="two-field-row"><label>Cabecera de autenticación<input value={form.headerName} onChange={(event) => setForm({ ...form, headerName: event.target.value })} /></label><label>Prefijo<input value={form.prefix} onChange={(event) => setForm({ ...form, prefix: event.target.value })} /></label></div>}
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setShowAdd(false)}>Cancelar</button><button className="button button-primary" disabled={busy === 'create'}>{busy === 'create' ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />}Guardar proveedor</button></div>
      </form>
    </Modal>}
    {manual && <Modal title="Añadir modelo manualmente" description="Usa el identificador exacto que acepta la API. El origen queda marcado como manual." onClose={() => setManual(null)}><form className="form-stack" onSubmit={addManual}><div className="model-provider-inline"><ProviderIcon type={manual.provider.type} size={17} />{manual.provider.name}</div><label>Identificador real<input required value={manual.modelId} onChange={(event) => setManual({ ...manual, modelId: event.target.value })} placeholder="p. ej. modelo-2025-…" /></label><label>Nombre visible<input value={manual.displayName} onChange={(event) => setManual({ ...manual, displayName: event.target.value })} placeholder="Nombre en la interfaz" /></label><label>Contexto (tokens)<input type="number" min="256" max="2000000" value={manual.contextTokens} onChange={(event) => setManual({ ...manual, contextTokens: event.target.value })} placeholder="Desconocido si se deja vacío" /></label><div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setManual(null)}>Cancelar</button><button className="button button-primary" disabled={busy.startsWith('manual-')}>Añadir modelo</button></div></form></Modal>}
    {edit && <Modal title={`Editar ${edit.name}`} description="Deja la clave vacía para conservar la credencial guardada." onClose={() => setEdit(null)}><form className="form-stack" onSubmit={editSave}><label>Nombre<input name="name" required defaultValue={edit.name} /></label><label>URL base<input name="baseUrl" required defaultValue={edit.baseUrl} /></label><label>Nueva clave API<input name="apiKey" type="password" autoComplete="new-password" placeholder={edit.hasKey ? 'Sin cambios' : 'Introduce la clave'} /></label><div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setEdit(null)}>Cancelar</button><button className="button button-primary" disabled={busy === `edit-${edit.id}`}>Guardar cambios</button></div></form></Modal>}
  </div>;
}
