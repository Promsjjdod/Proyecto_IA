import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronUp, LoaderCircle, MessageSquare, Send, Settings2, Sparkles, WandSparkles } from 'lucide-react';
import type { WorkflowGeneratorOptions } from './AutomationPage';

export function WorkflowAgentDock({
  options,
  loading,
  isGenerating,
  proposalReady,
  activeProviderId,
  activeModelId,
  onProviderChange,
  onModelChange,
  onGenerate,
  onReviewProposal,
  onGoProviders,
}: {
  options: WorkflowGeneratorOptions | null;
  loading: boolean;
  isGenerating: boolean;
  proposalReady: boolean;
  activeProviderId: string;
  activeModelId: string;
  onProviderChange: (providerId: string) => void;
  onModelChange: (modelId: string) => void;
  onGenerate: (request: string) => void;
  onReviewProposal: () => void;
  onGoProviders: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const readyProviders = options?.providers.filter((provider) => provider.ready) || [];
  const activeProvider = readyProviders.find((provider) => provider.id === activeProviderId) || options?.providers.find((provider) => provider.id === activeProviderId) || options?.secondProvider;
  const activeModel = activeProvider?.models.find((model) => model.id === activeModelId) || activeProvider?.models[0];
  const canGenerate = Boolean(activeProvider?.ready && (activeModel?.id || activeModelId) && request.trim() && !isGenerating);

  useEffect(() => {
    if (!activeProviderId && options?.secondProvider?.id) onProviderChange(options.secondProvider.id);
  }, [activeProviderId, onProviderChange, options?.secondProvider?.id]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!canGenerate) return;
    onGenerate(request.trim());
    setRequest('');
    setOpen(false);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  };

  return <section className={`workflow-agent-dock ${open ? 'is-open' : ''} ${proposalReady ? 'has-proposal' : ''}`} aria-label="Agente IA de automatizaciones">
    <div className="workflow-agent-dock-glow" />
    <button type="button" className="workflow-agent-dock-summary" onClick={() => { setOpen((value) => !value); window.setTimeout(() => inputRef.current?.focus(), 120); }} aria-expanded={open}>
      <span className="workflow-agent-orb"><Sparkles size={17} /></span>
      <span className="workflow-agent-copy"><b>Agente de automatización</b><small>{proposalReady ? 'Hay una propuesta pendiente de revisión' : 'Describe un flujo y lo convertimos en nodos verificables'}</small></span>
      <span className="workflow-agent-context"><i />{activeProvider?.ready ? `${activeProvider.name} · ${activeModel?.displayName || activeModelId}` : 'Proveedor pendiente'}</span>
      {proposalReady && <span className="workflow-agent-proposal-pill" onClick={(event) => { event.stopPropagation(); onReviewProposal(); }}><WandSparkles size={12} />Revisar propuesta</span>}
      <span className="workflow-agent-chevron">{open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</span>
    </button>
    {open && <form className="workflow-agent-dock-form" onSubmit={submit}>
      <div className="workflow-agent-input-wrap"><MessageSquare size={15} /><textarea ref={inputRef} rows={2} maxLength={5000} value={request} onChange={(event) => setRequest(event.target.value)} onKeyDown={handleKeyDown} placeholder="Ej.: recibe un texto, resúmelo con IA y devuelve JSON…" disabled={isGenerating} /><span>{request.length}/5.000</span></div>
      <div className="workflow-agent-dock-controls">
        <label><span>PROVEEDOR</span><select value={activeProviderId} onChange={(event) => onProviderChange(event.target.value)} disabled={loading || isGenerating}><option value="">Seleccionar proveedor</option>{readyProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
        <label><span>MODELO</span><select value={activeModel?.id || activeModelId} onChange={(event) => onModelChange(event.target.value)} disabled={loading || isGenerating || !activeProvider?.ready}><option value="">Seleccionar modelo</option>{(activeProvider?.models || []).map((model) => <option key={model.id} value={model.id}>{model.displayName}{model.favorite ? ' ★' : ''}</option>)}</select></label>
        <button type="submit" className="button button-primary workflow-agent-submit" disabled={!canGenerate}>{isGenerating ? <><LoaderCircle size={15} className="spin" />Analizando…</> : <><Send size={14} />Proponer flujo</>}</button>
        {!activeProvider?.ready && <button type="button" className="button button-quiet workflow-agent-config" onClick={onGoProviders}><Settings2 size={14} />Configurar</button>}
      </div>
      <div className="workflow-agent-dock-foot"><span><kbd>⌘</kbd><kbd>↵</kbd> para enviar</span><span>La propuesta no se guarda ni se ejecuta hasta que la revises.</span></div>
    </form>}
  </section>;
}
