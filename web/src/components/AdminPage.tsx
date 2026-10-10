import { useEffect, useState, type FormEvent } from 'react';
import { Activity, AlertTriangle, Check, CreditCard, Gauge, KeyRound, LoaderCircle, Save, Shield, ShieldCheck, Users, X } from 'lucide-react';
import type { User } from '../types';
import { api } from '../api';
import { ErrorBanner, Modal } from './common';

const types: [string, string][] = [['openai', 'OpenAI'], ['anthropic', 'Anthropic'], ['google', 'Gemini'], ['deepseek', 'DeepSeek'], ['ollama', 'Ollama'], ['openai-compatible', 'OpenAI-compatible'], ['custom', 'Personalizado']];
type AdminUser = { id: string; email: string; name: string; role: 'admin' | 'user'; credits: number; dailyLimit: number; monthlyLimit: number; operations: number; creditsSpent: number; createdAt: string };
type Dashboard = { users: number; admins: number; operations: number; internalCreditsSpent: number; failedOperations: number; projects: number; workflows: number; allowedProviderTypes: string[]; audit: any[] };
export function AdminPage({ user }: { user: User }) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usage, setUsage] = useState<any[]>([]);
  const [allowed, setAllowed] = useState<string[]>([]);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [form, setForm] = useState({ role: 'user', credits: 0, dailyLimit: 0, monthlyLimit: 0 });
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = async () => {
    try {
      const [dash, accountUsers, operations, settings] = await Promise.all([api<Dashboard>('/admin/dashboard'), api<AdminUser[]>('/admin/users'), api<any[]>('/admin/usage'), api<any>('/admin/settings')]);
      setDashboard(dash); setUsers(accountUsers); setUsage(operations); setAllowed(settings.allowedProviderTypes);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cargar el panel.'); }
  };
  useEffect(() => { void load(); }, []);
  const editUser = (item: AdminUser) => { setSelected(item); setForm({ role: item.role, credits: item.credits, dailyLimit: item.dailyLimit, monthlyLimit: item.monthlyLimit }); };
  const saveUser = async (event: FormEvent) => {
    event.preventDefault(); if (!selected) return;
    setBusy(true); setError('');
    try { await api(`/admin/users/${encodeURIComponent(selected.id)}`, { method: 'PATCH', body: JSON.stringify(form) }); setNotice(`Se actualizaron los límites de ${selected.email}.`); setSelected(null); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo actualizar el usuario.'); }
    finally { setBusy(false); }
  };
  const saveSettings = async () => {
    setBusy(true); setError('');
    try { await api('/admin/settings', { method: 'PATCH', body: JSON.stringify({ allowedProviderTypes: allowed }) }); setNotice('Proveedores permitidos actualizados.'); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron guardar los ajustes.'); }
    finally { setBusy(false); }
  };
  const filtered = users.filter((item) => `${item.name} ${item.email}`.toLowerCase().includes(search.toLowerCase()));
  if (user.role !== 'admin') return <div className="page-content"><ErrorBanner message="Esta sección requiere rol de administrador verificado en el servidor." /></div>;
  return <div className="page-content admin-page"><div className="page-heading-row"><div><div className="eyebrow"><span className="eyebrow-dot" /> CONTROL DE PLATAFORMA</div><h1>Administración</h1><p>Usuarios, límites internos, proveedores permitidos y registros de actividad.</p></div><span className="admin-badge"><ShieldCheck size={14} />ADMINISTRADOR</span></div>
    {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}{notice && <div className="success-banner"><Check size={15} />{notice}<button className="icon-button" onClick={() => setNotice('')}><X size={14} /></button></div>}
    <div className="admin-stat-grid">{[
      { label: 'Usuarios', value: dashboard?.users ?? '—', icon: Users, tone: 'violet' },
      { label: 'Operaciones', value: dashboard?.operations ?? '—', icon: Activity, tone: 'blue' },
      { label: 'Unidades internas', value: dashboard?.internalCreditsSpent?.toLocaleString() ?? '—', icon: CreditCard, tone: 'mint' },
      { label: 'Operaciones fallidas', value: dashboard?.failedOperations ?? '—', icon: AlertTriangle, tone: 'amber' },
    ].map((card) => <div className="admin-stat-card" key={card.label}><span className={`admin-stat-icon ${card.tone}`}><card.icon size={17} /></span><div><small>{card.label}</small><b>{card.value}</b></div><i /></div>)}</div>
    <div className="admin-main-grid"><section className="admin-section-card users-admin-card"><div className="admin-section-head"><div><span className="section-kicker">ACCESO Y CUOTAS</span><h2>Usuarios</h2></div><label className="admin-search"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar usuario…" /></label></div><div className="admin-user-table"><div className="admin-table-head"><span>CUENTA</span><span>ROL</span><span>CRÉDITOS</span><span>ACTIVIDAD</span><span /></div>{filtered.map((account) => <div className="admin-user-row" key={account.id}><div className="admin-user-identity"><span className="avatar">{account.name.slice(0, 1).toUpperCase()}</span><span><b>{account.name}</b><small>{account.email}</small></span></div><span className={`role-pill role-${account.role}`}>{account.role}</span><span className="admin-credit-cell">{account.credits.toLocaleString()}<small>saldo</small></span><span className="admin-activity-cell">{account.operations} ops<small>{account.creditsSpent.toLocaleString()} unidades</small></span><button className="button button-quiet button-sm" onClick={() => editUser(account)}>Editar límites</button></div>)}{filtered.length === 0 && <div className="empty-inline">No se encontraron cuentas.</div>}</div><div className="admin-card-footnote"><Shield size={14} />Los roles y cuotas se validan en el backend. Cambiar un rol requiere sesión de administrador.</div></section>
      <section className="admin-section-card provider-policy-card"><div className="admin-section-head"><div><span className="section-kicker">POLÍTICA DE CONEXIÓN</span><h2>Proveedores permitidos</h2></div><KeyRound size={17} /></div><p className="admin-policy-copy">Restringe qué integraciones pueden conectar los usuarios. Las credenciales externas siguen siendo responsabilidad de cada cuenta.</p><div className="provider-policy-list">{types.map(([id, label]) => <label key={id}><span>{label}</span><input type="checkbox" checked={allowed.includes(id)} onChange={(e) => setAllowed((current) => e.target.checked ? [...current, id] : current.filter((value) => value !== id))} /></label>)}</div><button className="button button-secondary button-sm" onClick={() => void saveSettings()} disabled={busy}><Save size={14} />Guardar política</button><div className="admin-card-footnote"><AlertTriangle size={13} />No modifica restricciones ni cuotas de la API externa.</div></section></div>
    <section className="admin-section-card operation-log-card"><div className="admin-section-head"><div><span className="section-kicker">TRAZABILIDAD</span><h2>Actividad reciente</h2></div><span className="section-count">{usage.length}</span></div><div className="admin-log-table"><div className="admin-log-header"><span>USUARIO</span><span>OPERACIÓN</span><span>ESTADO</span><span>UNIDADES</span><span>FECHA</span></div>{usage.slice(0, 50).map((entry) => <div className="admin-log-row" key={entry.id}><span>{entry.email}</span><span>{entry.operation}</span><span className={`log-state log-${entry.status}`}>{entry.status}</span><span>{entry.credits || entry.reserved || 0}</span><span>{new Date(entry.createdAt).toLocaleString()}</span></div>)}</div><p className="admin-card-footnote">Las claves API y el contenido de las conversaciones no se muestran en este registro.</p></section>
    <div className="admin-limit-note"><Gauge size={15} /><span>Los administradores omiten únicamente las cuotas internas. Los proveedores externos y sus políticas de seguridad siguen aplicándose.</span></div>
    {selected && <Modal title="Ajustar cuenta" description={`${selected.name} · ${selected.email}`} onClose={() => setSelected(null)}><form className="form-stack" onSubmit={saveUser}><label>Rol<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="user">Usuario normal</option><option value="admin">Administrador</option></select></label><label>Créditos internos restantes<input type="number" min={0} max={10000000} value={form.credits} onChange={(e) => setForm({ ...form, credits: Number(e.target.value) })} /></label><label>Límite diario<input type="number" min={0} max={10000000} value={form.dailyLimit} onChange={(e) => setForm({ ...form, dailyLimit: Number(e.target.value) })} /></label><label>Límite mensual<input type="number" min={0} max={10000000} value={form.monthlyLimit} onChange={(e) => setForm({ ...form, monthlyLimit: Number(e.target.value) })} /></label>{selected.id === user.id && form.role !== 'admin' && <div className="warning-banner">No puedes quitar tu propio rol desde esta sesión.</div>}<div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setSelected(null)}>Cancelar</button><button className="button button-primary" disabled={busy || (selected.id === user.id && form.role !== 'admin')}>{busy ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}Guardar</button></div></form></Modal>}
  </div>;
}
