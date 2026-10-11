import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Bot, Check, CirclePlay, Clock3, Copy, GitBranch, Globe2, Layers3, ListChecks, LoaderCircle, Pause, Play, Plus, Save, Settings2, Sparkles, Trash2, Workflow as WorkflowIcon } from 'lucide-react';
import type { Agent, FlowEdge, FlowNode, Model, Project, Provider, Workflow } from '../types';
import { api } from '../api';
import { EmptyState, ErrorBanner, Modal } from './common';
import { WorkflowCanvas } from './WorkflowCanvas';

const catalog: { type: string; label: string; description: string; Icon: typeof WorkflowIcon }[] = [
  { type: 'text', label: 'Texto', description: 'Añade o transforma texto', Icon: Layers3 },
  { type: 'ai', label: 'Nodo de IA', description: 'Ejecuta un modelo conectado', Icon: Sparkles },
  { type: 'agent', label: 'Habilidades', description: 'Carga instrucciones de una habilidad', Icon: Bot },
  { type: 'read_file', label: 'Leer archivo', description: 'Lee archivos del proyecto activo', Icon: ListChecks },
  { type: 'write_file', label: 'Escribir archivo', description: 'Guarda un archivo en el proyecto', Icon: Save },
  { type: 'transform', label: 'Transformar', description: 'Mayúsculas, minúsculas, prefijo…', Icon: Settings2 },
  { type: 'condition', label: 'Condición', description: 'Abre ramas verdadera y falsa', Icon: GitBranch },
  { type: 'http', label: 'Petición HTTP', description: 'HTTPS público permitido por allowlist', Icon: Globe2 },
  { type: 'output', label: 'Salida', description: 'Devuelve el resultado del flujo', Icon: ArrowRight },
];
function newId() { return crypto.randomUUID().replace(/-/g, '').slice(0, 12); }

export type WorkflowGeneratorModelOption = { id: string; displayName: string; favorite: boolean };
export type WorkflowGeneratorProviderOption = { id: string; name: string; type: string; status: string; ready: boolean; reason: string; models: WorkflowGeneratorModelOption[] };
export type WorkflowGeneratorOptions = {
  configuredProviderCount: number;
  secondProvider: (WorkflowGeneratorProviderOption & { modelId: string | null; modelName: string | null }) | null;
  secondProviderReason: string;
  providers: WorkflowGeneratorProviderOption[];
};

/** Adds stable canvas positions to old persisted flows without changing their graph. */
export function withWorkflowPositions(workflow: Workflow): Workflow {
  const indegree = new Map(workflow.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of workflow.edges) {
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) || []), edge.target]);
  }
  const depth = new Map(workflow.nodes.map((node) => [node.id, 0]));
  const queue = workflow.nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  let visited = 0;
  while (queue.length) {
    const current = queue.shift()!; visited += 1;
    for (const target of outgoing.get(current) || []) {
      depth.set(target, Math.max(depth.get(target) || 0, (depth.get(current) || 0) + 1));
      indegree.set(target, (indegree.get(target) || 1) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  const rowsByDepth = new Map<number, number>();
  return { ...workflow, nodes: workflow.nodes.map((node, index) => {
    const normalized = { ...node, config: node.config && typeof node.config === 'object' && !Array.isArray(node.config) ? node.config : {} };
    const position = node.position;
    if (position && Number.isFinite(position.x) && Number.isFinite(position.y) && position.x >= 0 && position.y >= 0 && position.x <= 50_000 && position.y <= 50_000) return normalized;
    const layer = visited === workflow.nodes.length ? (depth.get(node.id) || 0) : index;
    const row = rowsByDepth.get(layer) || 0;
    rowsByDepth.set(layer, row + 1);
    return { ...normalized, position: { x: 90 + layer * 320, y: 90 + row * 150 } };
  }) };
}

function blankFlow(): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = [
    { id: newId(), type: 'start', name: 'Inicio manual', config: {}, position: { x: 90, y: 170 } },
    { id: newId(), type: 'input', name: 'Entrada de texto', config: {}, position: { x: 410, y: 170 } },
    { id: newId(), type: 'output', name: 'Resultado', config: {}, position: { x: 730, y: 170 } },
  ];
  return { nodes, edges: [{ source: nodes[0].id, target: nodes[1].id }, { source: nodes[1].id, target: nodes[2].id }] };
}

function wouldCreateCycle(edges: FlowEdge[], source: string, target: string) {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) outgoing.set(edge.source, [...(outgoing.get(edge.source) || []), edge.target]);
  const pending = [target]; const visited = new Set<string>();
  while (pending.length) {
    const node = pending.pop()!;
    if (node === source) return true;
    if (visited.has(node)) continue;
    visited.add(node); pending.push(...(outgoing.get(node) || []));
  }
  return false;
}

function enabled(workflow: Workflow) { return workflow.enabled !== false; }

export function AutomationPage({ workflows, providers, modelsByProvider, agents, projects, activeProjectId, onRefresh, onRefreshUsage, onGoProviders, loading = false }: {
  workflows: Workflow[]; providers: Provider[]; modelsByProvider: Record<string, Model[]>; agents: Agent[]; projects: Project[]; activeProjectId: string | null;
  onRefresh: () => void; onRefreshUsage: () => void; onGoProviders: () => void; loading?: boolean;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Workflow | null>(null);
  const [isUnsavedDraft, setIsUnsavedDraft] = useState(false);
  const [busyAction, setBusyAction] = useState<null | 'create' | 'save' | 'duplicate' | 'run' | 'delete'>(null);
  const [error, setError] = useState('');
  const [generationError, setGenerationError] = useState('');
  const [notice, setNotice] = useState('');
  const [generationNotice, setGenerationNotice] = useState('');
  const [generationRequest, setGenerationRequest] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatorOptions, setGeneratorOptions] = useState<WorkflowGeneratorOptions | null>(null);
  const [generatorOptionsLoading, setGeneratorOptionsLoading] = useState(true);
  const [generatorOptionsError, setGeneratorOptionsError] = useState('');
  const [selectedGeneratorProviderId, setSelectedGeneratorProviderId] = useState('');
  const [selectedGeneratorModelId, setSelectedGeneratorModelId] = useState('');
  const [projectForRun, setProjectForRun] = useState(activeProjectId || '');
  const [input, setInput] = useState('');
  const [run, setRun] = useState<any>(null);
  const [runHistory, setRunHistory] = useState<any[]>([]);
  const [showNodePicker, setShowNodePicker] = useState(false);
  const [nodeToDelete, setNodeToDelete] = useState<string | null>(null);
  const [removingFlowId, setRemovingFlowId] = useState<string | null>(null);

  const busy = busyAction !== null;
  const defaultGenerator = generatorOptions?.secondProvider || null;
  const providerForOptions = useMemo(() => selectedGeneratorProviderId
    ? generatorOptions?.providers.find((provider) => provider.id === selectedGeneratorProviderId) || null
    : defaultGenerator,
  [selectedGeneratorProviderId, generatorOptions, defaultGenerator]);
  const modelValue = selectedGeneratorModelId || providerForOptions?.models[0]?.id || '';
  const selectedAlternativeModel = Boolean(selectedGeneratorProviderId || (modelValue && defaultGenerator?.modelId !== modelValue));
  const alternativeProviders = generatorOptions?.providers.filter((provider) => provider.ready && provider.id !== defaultGenerator?.id) || [];

  useEffect(() => {
    let current = true;
    setGeneratorOptionsLoading(true); setGeneratorOptionsError('');
    api<WorkflowGeneratorOptions>('/workflows/generator-options').then((options) => { if (current) setGeneratorOptions(options); })
      .catch((e) => { if (current) setGeneratorOptionsError(e instanceof Error ? e.message : 'No se pudo consultar la configuración de proveedores.'); })
      .finally(() => { if (current) setGeneratorOptionsLoading(false); });
    return () => { current = false; };
  }, []);
  useEffect(() => {
    if (isUnsavedDraft) return;
    const workflow = workflows.find((item) => item.id === activeId);
    if (workflow) setDraft(withWorkflowPositions(workflow));
    else if (!activeId) setDraft(null);
  }, [workflows, activeId, isUnsavedDraft]);
  useEffect(() => { if (activeProjectId) setProjectForRun(activeProjectId); }, [activeProjectId]);

  async function loadGeneratorOptions() {
    setGeneratorOptionsLoading(true); setGeneratorOptionsError('');
    try { setGeneratorOptions(await api<WorkflowGeneratorOptions>('/workflows/generator-options')); }
    catch (e) { setGeneratorOptionsError(e instanceof Error ? e.message : 'No se pudo consultar la configuración de proveedores.'); }
    finally { setGeneratorOptionsLoading(false); }
  }

  const addFlow = async () => {
    const starter = blankFlow();
    try {
      setBusyAction('create'); setError('');
      const created = await api<Workflow>('/workflows', { method: 'POST', body: JSON.stringify({ name: 'Nueva automatización', description: '', ...starter }) });
      onRefresh(); setActiveId(created.id); setIsUnsavedDraft(false); setDraft(withWorkflowPositions(created));
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo crear el flujo.'); }
    finally { setBusyAction(null); }
  };
  const updateDraft = (updater: (value: Workflow) => Workflow) => setDraft((current) => current ? updater(current) : current);
  const save = async () => {
    if (!draft) return;
    setBusyAction('save'); setError('');
    try {
      const payload = { name: draft.name, description: draft.description, nodes: draft.nodes, edges: draft.edges };
      const saved = isUnsavedDraft
        ? await api<Workflow>('/workflows', { method: 'POST', body: JSON.stringify(payload) })
        : await api<Workflow>(`/workflows/${encodeURIComponent(draft.id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      setDraft(withWorkflowPositions(saved)); setActiveId(saved.id); setIsUnsavedDraft(false); onRefresh();
      setNotice(isUnsavedDraft ? 'La automatización se guardó en tu cuenta.' : 'Cambios guardados en el servidor.');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar el flujo.'); }
    finally { setBusyAction(null); }
  };
  const closeEditor = () => {
    if (isUnsavedDraft && !window.confirm('Este borrador todavía no está guardado. ¿Querés descartarlo?')) return;
    setActiveId(null); setDraft(null); setIsUnsavedDraft(false); setRun(null); setError(''); setNotice('');
  };
  const addNode = (type: string) => {
    if (!draft) return;
    const meta = catalog.find((node) => node.type === type);
    if (!meta) return;
    const nodes: FlowNode[] = draft.nodes.map((node) => ({ ...node, position: node.position || { x: 90, y: 90 } }));
    const outputIndex = nodes.findIndex((item) => item.type === 'output' || item.type === 'end');
    const insertAt = outputIndex < 0 ? nodes.length : outputIndex;
    const nextNode = nodes[insertAt]; const previousNode = nodes[insertAt - 1];
    const previousPosition = previousNode?.position || { x: 90, y: 90 };
    const newX = previousPosition.x + 320;
    if (nextNode?.position && nextNode.position.x <= newX + 240) {
      const oldNextX = nextNode.position.x;
      for (const node of nodes) if (node.position && node.position.x >= oldNextX) node.position = { ...node.position, x: node.position.x + 320 };
    }
    const node: FlowNode = {
      id: newId(), type, name: meta.label, position: { x: newX, y: previousPosition.y },
      config: type === 'ai' ? { mode: 'MEDIO', providerId: '', modelId: '', prompt: '{{result}}' }
        : type === 'transform' ? { operation: 'trim' }
          : type === 'condition' ? { contains: '' }
            : type === 'write_file' ? { path: 'output.txt', content: '{{result}}' }
              : type === 'read_file' ? { path: 'README.md' }
                : type === 'http' ? { method: 'GET', url: '' }
                  : type === 'text' ? { text: '' } : {},
    };
    nodes.splice(insertAt, 0, node);
    let edges = [...draft.edges];
    const directEdgeIndex = previousNode && nextNode ? edges.findIndex((edge) => edge.source === previousNode.id && edge.target === nextNode.id) : -1;
    if (directEdgeIndex >= 0) {
      const previousEdge = edges[directEdgeIndex];
      edges = edges.filter((_edge, index) => index !== directEdgeIndex);
      edges.push({ ...previousEdge, target: node.id }, { source: node.id, target: nextNode!.id });
    } else if (previousNode) edges.push({ source: previousNode.id, target: node.id });
    setDraft({ ...draft, nodes, edges }); setShowNodePicker(false);
  };
  const removeNode = (id: string) => {
    if (!draft) return;
    setDraft({ ...draft, nodes: draft.nodes.filter((node) => node.id !== id), edges: draft.edges.filter((edge) => edge.source !== id && edge.target !== id) });
    setNodeToDelete(null);
  };
  const moveNode = (id: string, position: { x: number; y: number }) => updateDraft((flow) => ({ ...flow, nodes: flow.nodes.map((node) => node.id === id ? { ...node, position } : node) }));
  const patchNode = (id: string, patch: Partial<FlowNode> & { config?: Record<string, unknown> }) => updateDraft((flow) => ({ ...flow, nodes: flow.nodes.map((node) => node.id === id ? { ...node, ...patch, config: patch.config ? { ...node.config, ...patch.config } : node.config } : node) }));
  const connectNode = (targetId: string, sourceId: string, sourceHandle?: string) => {
    if (!draft) return;
    const edges = draft.edges.filter((edge) => edge.target !== targetId);
    if (wouldCreateCycle(edges, sourceId, targetId)) { setError('Esa conexión crearía un ciclo. Elige otro nodo de origen.'); return; }
    const source = draft.nodes.find((node) => node.id === sourceId);
    if (!source || sourceId === targetId) { setError('La conexión no es válida.'); return; }
    edges.push({ source: sourceId, target: targetId, ...(source.type === 'condition' ? { sourceHandle: sourceHandle === 'false' ? 'false' : 'true' } : {}) });
    setDraft({ ...draft, edges }); setError('');
  };
  const disconnectNode = (targetId: string) => {
    if (!draft) return;
    setDraft({ ...draft, edges: draft.edges.filter((edge) => edge.target !== targetId) });
  };
  const deleteFlow = async (flow: Workflow) => {
    if (!window.confirm(`¿Eliminar el flujo «${flow.name}» y sus registros?`)) return;
    try {
      setBusyAction('delete');
      await api(`/workflows/${encodeURIComponent(flow.id)}`, { method: 'DELETE', body: JSON.stringify({ confirm: true }) });
      setRemovingFlowId(flow.id);
      if (activeId === flow.id) { setActiveId(null); setDraft(null); setIsUnsavedDraft(false); }
      window.setTimeout(() => { onRefresh(); setRemovingFlowId((current) => current === flow.id ? null : current); }, 180);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo eliminar el flujo.'); }
    finally { setBusyAction(null); }
  };
  const duplicate = async (flow: Workflow) => {
    try {
      setBusyAction('duplicate');
      const copy = await api<Workflow>(`/workflows/${encodeURIComponent(flow.id)}/duplicate`, { method: 'POST', body: '{}' });
      onRefresh(); setActiveId(copy.id); setIsUnsavedDraft(false); setDraft(withWorkflowPositions(copy));
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo duplicar el flujo.'); }
    finally { setBusyAction(null); }
  };
  const toggleWorkflow = async (flow: Workflow) => {
    const nextEnabled = !enabled(flow);
    try {
      const updated = await api<Workflow>(`/workflows/${encodeURIComponent(flow.id)}/enabled`, { method: 'PATCH', body: JSON.stringify({ enabled: nextEnabled }) });
      if (activeId === flow.id) setDraft((current) => current ? { ...current, enabled: updated.enabled } : current);
      setNotice(nextEnabled ? 'La automatización está activa.' : 'Se pausaron nuevas ejecuciones. Las ya iniciadas no se interrumpen.');
      onRefresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cambiar el estado de la automatización.'); }
  };
  const execute = async () => {
    if (!draft) return;
    if (!enabled(draft)) { setError('Esta automatización está pausada. Reactivala antes de ejecutarla.'); return; }
    const usesExternal = draft.nodes.some((node) => node.type === 'ai' || node.type === 'http');
    const writesFiles = draft.nodes.some((node) => node.type === 'write_file');
    const actions = [usesExternal ? 'enviar datos a proveedores externos' : '', writesFiles ? 'crear o reemplazar archivos del proyecto' : ''].filter(Boolean).join(' y ');
    if (actions && !window.confirm(`Este flujo puede ${actions}. ¿Autorizas esta ejecución?`)) return;
    setBusyAction('run'); setError(''); setRun(null);
    try {
      const result = await api<any>(`/workflows/${encodeURIComponent(draft.id)}/run`, { method: 'POST', body: JSON.stringify({ input, projectId: projectForRun || null, confirmExternalResources: usesExternal, confirmProjectWrites: writesFiles }) });
      setRun(result); setRunHistory((current) => [result, ...current].slice(0, 10));
    } catch (e) { setError(e instanceof Error ? e.message : 'Falló la ejecución del flujo.'); }
    finally { onRefreshUsage(); setBusyAction(null); }
  };
  const generate = async (event: FormEvent) => {
    event.preventDefault();
    if (isGenerating || !generationRequest.trim()) return;
    if (!providerForOptions?.ready || !modelValue) {
      setGenerationError(generatorOptions?.secondProviderReason || 'Configurá un proveedor y un modelo disponible antes de generar.');
      return;
    }
    const providerOverride = selectedGeneratorProviderId || undefined;
    const modelOverride = selectedAlternativeModel ? modelValue : undefined;
    setIsGenerating(true); setGenerationError(''); setGenerationNotice(''); setError('');
    try {
      const result = await api<{ name: string; description: string; nodes: FlowNode[]; edges: FlowEdge[]; generatedBy: { providerId: string; providerName: string; modelId: string; modelName: string } }>('/workflows/generate', {
        method: 'POST', body: JSON.stringify({ request: generationRequest.trim(), requestId: crypto.randomUUID(), ...(providerOverride ? { providerId: providerOverride } : {}), ...(modelOverride ? { modelId: modelOverride } : {}) }),
      });
      const now = new Date().toISOString();
      const generatedDraft: Workflow = { id: `draft-${newId()}`, name: result.name, description: result.description, nodes: result.nodes, edges: result.edges, enabled: true, createdAt: now, updatedAt: now };
      setActiveId(null); setDraft(withWorkflowPositions(generatedDraft)); setIsUnsavedDraft(true);
      setGenerationNotice(`Borrador generado por ${result.generatedBy.providerName} · ${result.generatedBy.modelName}. Revisalo y guardalo cuando esté listo.`);
      onRefreshUsage();
    } catch (e) { setGenerationError(e instanceof Error ? e.message : 'No se pudo generar la automatización. No se guardó ningún flujo.'); onRefreshUsage(); }
    finally { setIsGenerating(false); }
  };
  const selectGeneratorProvider = (providerId: string) => {
    setSelectedGeneratorProviderId(providerId);
    const provider = providerId ? generatorOptions?.providers.find((item) => item.id === providerId) : defaultGenerator;
    setSelectedGeneratorModelId(provider?.models[0]?.id || '');
  };
  useEffect(() => {
    if (!activeId) { setRunHistory([]); return; }
    let current = true;
    api<any[]>(`/workflows/${encodeURIComponent(activeId)}/runs`).then((rows) => { if (current) setRunHistory(rows); }).catch(() => { /* Historial opcional mientras se edita. */ });
    return () => { current = false; };
  }, [activeId]);

  return <div className="page-content automations-page">
    {!draft ? <>
      <div className="page-heading-row automation-page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> FLUJOS CONECTADOS</div><h1>Automatizaciones</h1><p>Diseñá flujos reales con pasos verificables y controles de ejecución.</p></div><button className="button button-secondary" onClick={() => void addFlow()} disabled={busy || isGenerating}><Plus size={16} />Crear flujo en blanco</button></div>
      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}{notice && <div className="success-banner automation-feedback-enter"><Check size={15} />{notice}<button className="icon-button" onClick={() => setNotice('')}>×</button></div>}
      <div className="flow-security-note"><span className="mini-shield">⌑</span><div><b>Diseñado para ejecutar bajo permisos</b><p>Sin comandos de sistema ni código arbitrario. Las escrituras y llamadas externas requieren confirmación; HTTP exige una allowlist HTTPS del servidor.</p></div></div>
      <section className="automation-generator-card" aria-labelledby="automation-generator-title" aria-busy={isGenerating}>
        <div className="automation-generator-heading"><div className="automation-generator-mark"><Sparkles size={18} /></div><div><span className="section-kicker">CONSTRUCCIÓN ASISTIDA</span><h2 id="automation-generator-title">¿Qué querés automatizar?</h2><p>La IA prepara un borrador para revisar; no se guarda ni se ejecuta hasta que vos lo confirmes.</p></div></div>
        <form className="automation-generator-form" onSubmit={(event) => void generate(event)}>
          <label htmlFor="automation-request">Describí el resultado y los pasos que necesitás</label>
          <textarea id="automation-request" maxLength={5_000} rows={3} value={generationRequest} onChange={(event) => setGenerationRequest(event.target.value)} placeholder="Escribí tu instrucción en lenguaje natural…" disabled={isGenerating} />
          <div className="automation-generator-controls">
            <div className="automation-generator-provider-fields">
              <label>Proveedor para generar<select value={selectedGeneratorProviderId} onChange={(event) => selectGeneratorProvider(event.target.value)} disabled={generatorOptionsLoading || isGenerating}>
                {defaultGenerator?.ready ? <option value="">Automático · segundo configurado ({defaultGenerator.name})</option> : <option value="">Segundo proveedor no disponible</option>}
                {alternativeProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} · alternativa disponible</option>)}
              </select></label>
              <label>Modelo<select value={modelValue} onChange={(event) => setSelectedGeneratorModelId(event.target.value)} disabled={!providerForOptions?.ready || isGenerating || generatorOptionsLoading}>
                {(providerForOptions?.models || []).map((model) => <option key={model.id} value={model.id}>{model.displayName}{model.favorite ? ' ★' : ''}</option>)}
                {!providerForOptions?.models.length && <option value="">Sin modelos confirmados</option>}
              </select></label>
            </div>
            <button type="submit" className="button button-primary automation-generate-button" disabled={isGenerating || generatorOptionsLoading || !generationRequest.trim() || !providerForOptions?.ready || !modelValue}>
              {isGenerating ? <><LoaderCircle size={16} className="spin" />Generando borrador…</> : <><Sparkles size={16} />Generar con IA</>}
            </button>
          </div>
          {generatorOptionsLoading && <div className="automation-provider-note"><LoaderCircle size={13} className="spin" />Comprobando los proveedores configurados…</div>}
          {!generatorOptionsLoading && generatorOptions && <div className={`automation-provider-note ${providerForOptions?.ready ? 'automation-provider-note-ready' : 'automation-provider-note-warning'}`}>
            {providerForOptions?.ready
              ? selectedGeneratorProviderId
                ? <>Se usará la alternativa que elegiste: <b>{providerForOptions.name} · {providerForOptions.models.find((model) => model.id === modelValue)?.displayName || modelValue}</b>. {defaultGenerator ? `El proveedor predeterminado sigue siendo ${defaultGenerator.name}.` : 'No hay segundo proveedor configurado; esta alternativa se eligió explícitamente.'}</>
                : <>El backend usará el segundo proveedor configurado: <b>{defaultGenerator?.name} · {providerForOptions.models.find((model) => model.id === modelValue)?.displayName || modelValue}</b>. Podés elegir una alternativa disponible.</>
              : <>{generatorOptions.secondProviderReason} {generatorOptions.configuredProviderCount < 2 ? 'Elegí un proveedor disponible o configurá otro.' : 'Seleccioná una alternativa disponible o revisá su estado.'}</>}
            <button type="button" className="button button-quiet button-sm" onClick={onGoProviders}>Configurar proveedores</button>
            <button type="button" className="icon-button automation-refresh-options" title="Actualizar modelos" aria-label="Actualizar proveedores y modelos" onClick={() => void loadGeneratorOptions()} disabled={generatorOptionsLoading}><span aria-hidden="true">↻</span></button>
          </div>}
          {generatorOptionsError && <div className="automation-provider-note automation-provider-note-warning" role="status">{generatorOptionsError}<button type="button" className="button button-quiet button-sm" onClick={onGoProviders}>Abrir proveedores</button></div>}
          {isGenerating && <div className="automation-generation-progress" role="status" aria-live="polite"><LoaderCircle size={15} className="spin" /><span>Analizando la solicitud y validando los pasos compatibles…</span><i /></div>}
          {generationError && <ErrorBanner message={generationError} onDismiss={() => setGenerationError('')} />}
          {generationNotice && <div className="automation-generation-notice" role="status" aria-live="polite"><Check size={14} />{generationNotice}</div>}
        </form>
      </section>
      {loading ? <div className="automation-loading-state"><LoaderCircle size={18} className="spin" />Cargando tus automatizaciones…</div> : workflows.length === 0 ? <div className="automation-empty-wrap"><EmptyState icon={<WorkflowIcon size={25} />} title="Todavía no tenés automatizaciones" description="Generá un borrador con IA o empezá con un flujo en blanco. Tus automatizaciones existentes nunca se borran al mostrar este estado." action={<button className="button button-primary" onClick={() => void addFlow()} disabled={busy || isGenerating}><Plus size={16} />Crear automatización</button>} /></div> : <div className="workflow-list" aria-label="Tus automatizaciones">{workflows.map((workflow, index) => <article key={workflow.id} className={`workflow-list-card ${!enabled(workflow) ? 'workflow-list-card-paused' : ''} ${removingFlowId === workflow.id ? 'workflow-list-card-removing' : ''}`} style={{ animationDelay: `${Math.min(index, 5) * 45}ms` }}>
        <div className="workflow-list-icon"><WorkflowIcon size={19} /></div><div className="workflow-list-meta"><div className="workflow-list-title-row"><h3>{workflow.name}</h3><span className={`automation-status-pill ${enabled(workflow) ? 'automation-status-active' : 'automation-status-paused'}`}><i />{enabled(workflow) ? 'Activa' : 'En pausa'}</span></div><p>{workflow.description || 'Sin descripción'} · {workflow.nodes.length} nodos</p><small>Actualizada {new Date(workflow.updatedAt).toLocaleDateString()}</small></div><div className="workflow-list-actions"><button className="icon-button" title="Duplicar automatización" aria-label={`Duplicar ${workflow.name}`} onClick={() => void duplicate(workflow)} disabled={busy || isGenerating}><Copy size={15} /></button><button className={`icon-button ${!enabled(workflow) ? 'automation-resume-button' : ''}`} title={enabled(workflow) ? 'Pausar nuevas ejecuciones' : 'Reanudar automatización'} aria-label={enabled(workflow) ? `Pausar ${workflow.name}` : `Reanudar ${workflow.name}`} onClick={() => void toggleWorkflow(workflow)} disabled={busy || isGenerating}>{enabled(workflow) ? <Pause size={15} /> : <Play size={15} />}</button><button className="icon-button danger-icon" title="Eliminar automatización" aria-label={`Eliminar ${workflow.name}`} onClick={() => void deleteFlow(workflow)} disabled={busy || isGenerating}><Trash2 size={15} /></button><button className="button button-secondary button-sm" onClick={() => { setIsUnsavedDraft(false); setActiveId(workflow.id); setNotice(''); setError(''); }} disabled={busy || isGenerating}>Editar <ArrowRight size={14} /></button></div>
      </article>)}</div>}
      <div className="workflow-roadmap"><span><Clock3 size={14} /> Ejecución manual disponible</span><span>Los disparadores programados todavía no están implementados. Pausar impide nuevas ejecuciones; no interrumpe las ya iniciadas.</span></div>
    </> : <>
      <div className="flow-editor-topbar automation-editor-enter"><button className="button button-quiet button-sm" onClick={closeEditor}><ArrowLeft size={15} />Automatizaciones</button><div className="flow-title-edit"><WorkflowIcon size={17} /><input aria-label="Nombre del flujo" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /><span>{draft.nodes.length} NODOS</span></div><div className="flow-top-actions">
        {!isUnsavedDraft && <button className="button button-quiet button-sm" onClick={() => void toggleWorkflow(draft)}><span className={`automation-status-dot ${enabled(draft) ? 'is-active' : 'is-paused'}`} />{enabled(draft) ? <><Pause size={14} />Pausar</> : <><Play size={14} />Reanudar</>}</button>}
        {!isUnsavedDraft && <button className="button button-quiet button-sm" onClick={() => void duplicate(draft)} disabled={busy || isGenerating}><Copy size={14} />Duplicar</button>}
        <button className="button button-secondary button-sm" onClick={() => void save()} disabled={busy || isGenerating}><Save size={14} />{isUnsavedDraft ? 'Guardar borrador' : 'Guardar'}</button>
        <button className="button button-primary button-sm" onClick={() => void execute()} disabled={busy || isGenerating || !enabled(draft) || isUnsavedDraft}><CirclePlay size={15} />{busyAction === 'run' ? 'Ejecutando…' : 'Ejecutar'}</button>
        {!isUnsavedDraft && <button className="icon-button danger-icon" title="Eliminar automatización" aria-label="Eliminar automatización" onClick={() => void deleteFlow(draft)} disabled={busy || isGenerating}><Trash2 size={15} /></button>}
      </div></div>
      {isUnsavedDraft && <div className="automation-draft-warning"><Sparkles size={14} /><span>Este es un borrador generado por IA; todavía no se guardó en tu cuenta. Revisalo antes de guardarlo.</span></div>}
      {!enabled(draft) && <div className="automation-paused-banner"><Pause size={14} /><span>Automatización pausada. No se aceptan nuevas ejecuciones; las ya iniciadas no se interrumpen.</span></div>}
      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}{notice && <div className="success-banner automation-feedback-enter"><Check size={15} />{notice}<button className="icon-button" onClick={() => setNotice('')}>×</button></div>}
      <div className="flow-editor-layout automation-editor-enter"><main className="flow-canvas"><div className="flow-canvas-header"><div><span className="section-kicker">EDITOR VISUAL</span><h2>{draft.description || 'Diseña tu flujo'}</h2></div><label className="flow-description-edit"><span>DESCRIPCIÓN</span><input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Qué hace esta automatización" /></label></div>
        <WorkflowCanvas workflow={draft} providers={providers} modelsByProvider={modelsByProvider} agents={agents} onMoveNode={moveNode} onPatchNode={patchNode} onConnect={connectNode} onDisconnect={disconnectNode} onDeleteNode={setNodeToDelete} onAddNode={() => setShowNodePicker(true)} />
      </main>
      <aside className="flow-run-panel"><div className="flow-run-panel-head"><div className="run-panel-icon"><CirclePlay size={17} /></div><div><b>Ejecución manual</b><small>{enabled(draft) ? 'Prueba el flujo con una entrada real' : 'Reactiva el flujo para ejecutar'}</small></div></div><label>Texto de entrada<textarea rows={5} value={input} onChange={(event) => setInput((event.target as HTMLTextAreaElement).value)} placeholder="Escribe el texto que recibirá el flujo…" /></label><label>Proyecto para leer / escribir<select value={projectForRun} onChange={(event) => setProjectForRun((event.target as HTMLSelectElement).value)}><option value="">Sin proyecto seleccionado</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label><button className="button button-primary run-flow-button" onClick={() => void execute()} disabled={busy || isGenerating || !enabled(draft) || isUnsavedDraft}><CirclePlay size={16} />{busyAction === 'run' ? 'Ejecutando…' : 'Ejecutar flujo'}</button><div className="run-safety-footnote"><span className="mini-shield">⌑</span>Cada ejecución confirmada se registra en el servidor. Las llamadas a IA/HTTP y las escrituras requieren autorización.</div>
        {busyAction === 'run' && <div className="automation-run-pending" role="status" aria-live="polite"><LoaderCircle size={15} className="spin" /><span>El motor está ejecutando los pasos del flujo…</span></div>}
        {run && <div className="run-result automation-feedback-enter"><div className="run-result-head"><span className="run-success-dot" /><b>Completada</b><small>{run.elapsedMs} ms</small></div><pre>{String(run.output?.text || '(sin salida)')}</pre><div className="run-log-list">{run.logs?.map((log: any, index: number) => <div key={`${log.nodeId}-${index}`} className={`run-log run-log-${log.status}`}><i />{log.nodeName}: {log.message}</div>)}</div>{run.artifacts?.length > 0 && <div className="run-artifacts"><b>Archivos guardados</b>{run.artifacts.map((file: any) => <div key={file.path}>{file.path}<small>{file.validationMessage}</small></div>)}</div>}</div>}
        {runHistory.length > 0 && <div className="run-history"><h4>Últimas ejecuciones</h4>{runHistory.slice(0, 5).map((item, index) => <div key={item.id || index}><span className={item.status === 'complete' ? 'history-success-dot' : item.status === 'running' ? 'automation-run-dot' : 'history-error-dot'} />{item.status || 'complete'}<small>{item.finishedAt ? new Date(item.finishedAt).toLocaleTimeString() : 'ahora'}</small></div>)}</div>}
      </aside></div>
    </>}
    {showNodePicker && <Modal title="Añadir un nodo" description="Selecciona un bloque para colocarlo en el lienzo y conectarlo por sus puertos." onClose={() => setShowNodePicker(false)}><div className="node-picker-list">{catalog.map(({ type, label, description, Icon }) => <button key={type} onClick={() => addNode(type)}><span><Icon size={16} /></span><div><b>{label}</b><small>{description}</small></div><Plus size={14} /></button>)}</div></Modal>}
    {nodeToDelete && <Modal title="Quitar nodo" description="Se quitarán las conexiones de este nodo. Revisa los enlaces restantes antes de guardar o ejecutar el flujo." onClose={() => setNodeToDelete(null)}><div className="modal-actions"><button className="button button-quiet" onClick={() => setNodeToDelete(null)}>Cancelar</button><button className="button button-danger" onClick={() => removeNode(nodeToDelete)}><Trash2 size={14} />Quitar nodo</button></div></Modal>}
  </div>;
}
