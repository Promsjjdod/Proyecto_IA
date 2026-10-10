import { useMemo } from 'react';
import { Activity, ChevronDown, Menu, Settings2, Sparkles } from 'lucide-react';
import type { Model, Mode, Provider } from '../types';
import { ProviderIcon } from './common';
import type { ViewId } from './Sidebar';

const pageTitle: Record<ViewId, string> = { chat: 'Conversación', compare: 'Comparar modelos', projects: 'Proyectos', agents: 'Agentes', automations: 'Automatizaciones', images: 'Generación de imágenes', providers: 'Proveedores de IA', settings: 'Preferencias', admin: 'Administración' };
const modeDetails: Record<Mode, string> = { LOW: 'Rápido y menor presupuesto', MEDIO: 'Equilibrio recomendado', ALTO: 'Mayor profundidad', EXTRA: 'Programación y análisis', MAX: 'Mejor opción disponible y autorizada' };

export function Header({ view, providers, modelsByProvider, providerId, modelId, mode, onModelChange, onModeChange, onMenu }: {
  view: ViewId; providers: Provider[]; modelsByProvider: Record<string, Model[]>; providerId: string; modelId: string; mode: Mode;
  onModelChange: (providerId: string, modelId: string) => void; onModeChange: (mode: Mode) => void; onMenu: () => void;
}) {
  const activeProvider = providers.find((provider) => provider.id === providerId);
  const value = providerId && modelId ? `${providerId}::${modelId}` : '';
  const entries = useMemo(() => providers.flatMap((provider) => (modelsByProvider[provider.id] || []).filter((model) => model.status !== 'unavailable').map((model) => ({ provider, model, value: `${provider.id}::${model.id}` }))), [providers, modelsByProvider]);
  const current = entries.find((entry) => entry.value === value);
  return <header className="topbar">
    <div className="topbar-left"><button className="mobile-menu-button" onClick={onMenu} aria-label="Abrir navegación"><Menu size={19} /></button><div className="breadcrumbs"><span>WORKSPACE</span><i>/</i><b>{pageTitle[view]}</b></div></div>
    <div className="topbar-controls">
      <label className="model-select-wrap"><ProviderIcon type={activeProvider?.type} size={17} /><select aria-label="Seleccionar modelo" value={value} onChange={(event) => { const [nextProvider, ...parts] = event.target.value.split('::'); onModelChange(nextProvider, parts.join('::')); }}>
        {entries.length === 0 && <option value="">Conecta un modelo</option>}
        {providers.map((provider) => <optgroup key={provider.id} label={provider.name}>{(modelsByProvider[provider.id] || []).filter((model) => model.status !== 'unavailable').map((model) => <option key={`${provider.id}::${model.id}`} value={`${provider.id}::${model.id}`}>{model.displayName}{model.favorite ? ' ★' : ''}</option>)}</optgroup>)}
      </select><ChevronDown size={13} /></label>
      <span className="topbar-divider" />
      <label className={`mode-select-wrap mode-${mode.toLowerCase()}`} title={modeDetails[mode]}><Sparkles size={14} /><select aria-label="Modo de uso" value={mode} onChange={(event) => onModeChange(event.target.value as Mode)}><option value="LOW">LOW</option><option value="MEDIO">MEDIO · recomendado</option><option value="ALTO">ALTO</option><option value="EXTRA">EXTRA</option><option value="MAX">MAX</option></select><ChevronDown size={13} /></label>
      <div className="connection-indicator" title={current ? `${current.provider.name} · modelo configurado` : 'Sin modelo seleccionado'}><span className={current ? 'connection-dot online' : 'connection-dot'} /><span>{current ? 'Listo' : 'Sin conexión'}</span></div>
    </div>
  </header>;
}
