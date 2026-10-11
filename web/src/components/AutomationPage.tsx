import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Activity, ArrowLeft, ArrowRight, Bot, Check, CirclePlay, Clock3, Copy, Download, FileDown, FileUp, GitBranch, Globe2, Layers3, ListChecks, LoaderCircle, Pause, Play, Plus, Redo2, Save, Settings2, Sparkles, Trash2, Undo2, Workflow as WorkflowIcon } from 'lucide-react';
import type { Agent, FlowEdge, FlowNode, Model, Project, Provider, Workflow, WorkflowVersion } from '../types';
import { api } from '../api';
import { EmptyState, ErrorBanner, Modal } from './common';
import { WorkflowCanvas } from './WorkflowCanvas';
import { WorkflowAgentDock } from './WorkflowAgentDock';

type CatalogItem = {
  type: string;
  label: string;
  description: string;
  category: string;
  Icon: typeof WorkflowIcon;
  status?: 'ready' | 'experimental';
  preset?: Record<string, unknown>;
};

/**
 * The catalog is intentionally honest: ready modules map to an engine operation;
 * experimental cards are visible for product direction but cannot be added yet.
 */
const catalog: CatalogItem[] = [
  { type: 'ai', label: 'Chat con modelos', description: 'Envía contexto a un proveedor configurado', category: 'Inteligencia artificial', Icon: Sparkles, preset: { prompt: '{{result}}', mode: 'MEDIO' } },
  { type: 'ai', label: 'Resumen de documentos', description: 'Resume el contenido recibido con instrucciones reales', category: 'Inteligencia artificial', Icon: FileDown, preset: { prompt: 'Resume con precisión el siguiente contenido y conserva los datos clave:\n\n{{result}}', mode: 'MEDIO' } },
  { type: 'ai', label: 'Clasificación de contenido', description: 'Clasifica texto usando el modelo elegido', category: 'Inteligencia artificial', Icon: GitBranch, preset: { prompt: 'Clasifica el siguiente contenido y devuelve una etiqueta y una breve justificación:\n\n{{result}}', mode: 'LOW' } },
  { type: 'ai', label: 'Extracción estructurada', description: 'Extrae información siguiendo un esquema indicado', category: 'Inteligencia artificial', Icon: Layers3, preset: { prompt: 'Extrae la información importante en JSON válido desde:\n\n{{result}}', mode: 'ALTO' } },
  { type: 'ai', label: 'Generación de código', description: 'Produce código a partir de una instrucción', category: 'Inteligencia artificial', Icon: WorkflowIcon, preset: { prompt: 'Genera una solución de código segura y explica sus supuestos:\n\n{{result}}', mode: 'ALTO' } },
  { type: 'agent', label: 'Agente especializado', description: 'Aplica instrucciones y herramientas autorizadas', category: 'Inteligencia artificial', Icon: Bot },
  { type: 'condition', label: 'Condiciones y ramas', description: 'Evalúa la salida y abre rutas verdadera/falsa', category: 'Automatización', Icon: GitBranch },
  { type: 'transform', label: 'Transformación de datos', description: 'Normaliza, cambia mayúsculas o añade texto', category: 'Automatización', Icon: Settings2, preset: { operation: 'trim' } },
  { type: 'text', label: 'Plantilla de texto', description: 'Crea texto con {{input}} y {{result}}', category: 'Entrada y salida', Icon: Layers3 },
  { type: 'read_file', label: 'Lectura autorizada de archivos', description: 'Lee un archivo del proyecto seleccionado', category: 'Entrada y salida', Icon: ListChecks },
  { type: 'write_file', label: 'Escritura validada de archivos', description: 'Prepara y valida un archivo antes de guardarlo', category: 'Entrada y salida', Icon: Save },
  { type: 'http', label: 'Solicitud HTTPS', description: 'Llama a un host HTTPS permitido por el servidor', category: 'Integraciones', Icon: Globe2 },
  { type: 'output', label: 'Salida del flujo', description: 'Entrega el resultado al registro de ejecución', category: 'Entrada y salida', Icon: ArrowRight },
  { type: 'start', label: 'Inicio manual', description: 'Disponible en todos los flujos nuevos', category: 'Control y observabilidad', Icon: CirclePlay, status: 'experimental' },
  { type: 'pending', label: 'Disparador por horario', description: 'Pendiente: requiere un scheduler de servidor', category: 'Automatización', Icon: Clock3, status: 'experimental' },
  { type: 'pending', label: 'Búsqueda web con proveedor', description: 'Pendiente: necesita un conector configurado', category: 'Herramientas de agentes', Icon: Globe2, status: 'experimental' },
  { type: 'pending', label: 'Métricas avanzadas', description: 'Pendiente: prevista para el panel de observabilidad', category: 'Control y observabilidad', Icon: Activity, status: 'experimental' },
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

const importableNodeTypes = new Set(['start', 'input', 'text', 'ai', 'agent', 'read_file', 'write_file', 'http', 'condition', 'transform', 'output', 'end']);
const secretKeyPattern = /(?:api[_-]?key|secret|password|passwd|token|authorization|credential|private[_-]?key)/i;
function withoutSecrets(value: unknown, key = ''): unknown {
  if (secretKeyPattern.test(key)) return undefined;
  if (Array.isArray(value)) return value.map((item) => withoutSecrets(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).flatMap(([childKey, childValue]) => {
    const clean = withoutSecrets(childValue, childKey);
    return clean === undefined ? [] : [[childKey, clean]];
  }));
  return value;
}
function exportableWorkflow(workflow: Workflow): Workflow {
  return withoutSecrets({ ...workflow, enabled: undefined, createdAt: undefined, updatedAt: undefined }) as Workflow;
}
function validateImportedWorkflow(value: unknown): value is Workflow {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Workflow>;
  if (typeof candidate.name !== 'string' || candidate.name.trim().length < 1 || candidate.name.length > 100 || !Array.isArray(candidate.nodes) || candidate.nodes.length < 1 || candidate.nodes.length > 40 || !Array.isArray(candidate.edges) || candidate.edges.length > 80) return false;
  const ids = new Set<string>();
  for (const node of candidate.nodes) {
    if (!node || typeof node.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(node.id) || ids.has(node.id) || !importableNodeTypes.has(node.type)) return false;
    ids.add(node.id);
  }
  return candidate.edges.every((edge) => edge && typeof edge.source === 'string' && typeof edge.target === 'string' && ids.has(edge.source) && ids.has(edge.target) && edge.source !== edge.target && (edge.sourceHandle === undefined || edge.sourceHandle === 'true' || edge.sourceHandle === 'false'));
}

type WorkflowProposal = { workflow: Workflow; generatedBy: { providerName: string; modelName: string } };

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
  const [versions, setVersions] = useState<WorkflowVersion[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [showNodePicker, setShowNodePicker] = useState(false);
  const [nodeToDelete, setNodeToDelete] = useState<string | null>(null);
  const [removingFlowId, setRemovingFlowId] = useState<string | null>(null);
  const [proposal, setProposal] = useState<WorkflowProposal | null>(null);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogCategory, setCatalogCategory] = useState('Todos');
  const importRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<Workflow | null>(null);
  const pastRef = useRef<Workflow[]>([]);
  const futureRef = useRef<Workflow[]>([]);

  useEffect(() => { draftRef.current = draft; }, [draft]);
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
      onRefresh(); setActiveId(created.id); setIsUnsavedDraft(false); pastRef.current = []; futureRef.current = []; setDraft(withWorkflowPositions(created));
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo crear el flujo.'); }
    finally { setBusyAction(null); }
  };
  const recordBeforeChange = () => {
    const current = draftRef.current;
    if (!current) return;
    pastRef.current = [...pastRef.current.slice(-49), current];
    futureRef.current = [];
  };
  const updateDraft = (updater: (value: Workflow) => Workflow, recordHistory = true) => setDraft((current) => {
    if (!current) return current;
    if (recordHistory) {
      pastRef.current = [...pastRef.current.slice(-49), current];
      futureRef.current = [];
    }
    return updater(current);
  });
  const undo = () => {
    const current = draftRef.current;
    const previous = pastRef.current.pop();
    if (!current || !previous) return;
    futureRef.current = [...futureRef.current.slice(-49), current];
    setDraft(previous);
  };
  const redo = () => {
    const current = draftRef.current;
    const next = futureRef.current.pop();
    if (!current || !next) return;
    pastRef.current = [...pastRef.current.slice(-49), current];
    setDraft(next);
  };
  const save = async () => {
    if (!draft) return;
    setBusyAction('save'); setError('');
    try {
      const payload = { name: draft.name, description: draft.description, nodes: draft.nodes, edges: draft.edges };
      const saved = isUnsavedDraft
        ? await api<Workflow>('/workflows', { method: 'POST', body: JSON.stringify(payload) })
        : await api<Workflow>(`/workflows/${encodeURIComponent(draft.id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      setDraft(withWorkflowPositions(saved)); setActiveId(saved.id); setIsUnsavedDraft(false); pastRef.current = []; futureRef.current = []; onRefresh();
      void api<WorkflowVersion[]>(`/workflows/${encodeURIComponent(saved.id)}/versions`).then(setVersions).catch(() => undefined);
      setNotice(isUnsavedDraft ? 'La automatización se guardó en tu cuenta.' : 'Cambios guardados en el servidor.');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar el flujo.'); }
    finally { setBusyAction(null); }
  };
  const closeEditor = () => {
    if (isUnsavedDraft && !window.confirm('Este borrador todavía no está guardado. ¿Querés descartarlo?')) return;
    setActiveId(null); setDraft(null); setIsUnsavedDraft(false); pastRef.current = []; futureRef.current = []; setRun(null); setError(''); setNotice('');
  };
  const addNode = (itemOrType: CatalogItem | string) => {
    if (!draft) return;
    const meta = typeof itemOrType === 'string' ? catalog.find((node) => node.type === itemOrType && node.status !== 'experimental') : itemOrType;
    if (!meta || meta.status === 'experimental' || meta.type === 'pending') return;
    const type = meta.type;
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
    const defaults: Record<string, unknown> = type === 'ai' ? { mode: 'MEDIO', providerId: '', modelId: '', prompt: '{{result}}' }
      : type === 'transform' ? { operation: 'trim' }
        : type === 'condition' ? { contains: '' }
          : type === 'write_file' ? { path: 'output.txt', content: '{{result}}' }
            : type === 'read_file' ? { path: 'README.md' }
              : type === 'http' ? { method: 'GET', url: '' }
                : type === 'text' ? { text: '' } : {};
    const node: FlowNode = { id: newId(), type, name: meta.label, position: { x: newX, y: previousPosition.y }, config: { ...defaults, ...(meta.preset || {}) } };
    nodes.splice(insertAt, 0, node);
    let edges = [...draft.edges];
    const directEdgeIndex = previousNode && nextNode ? edges.findIndex((edge) => edge.source === previousNode.id && edge.target === nextNode.id) : -1;
    if (directEdgeIndex >= 0) {
      const previousEdge = edges[directEdgeIndex];
      edges = edges.filter((_edge, index) => index !== directEdgeIndex);
      edges.push({ ...previousEdge, target: node.id }, { source: node.id, target: nextNode!.id });
    } else if (previousNode) edges.push({ source: previousNode.id, target: node.id });
    updateDraft((current) => ({ ...current, nodes, edges })); setShowNodePicker(false);
  };
  const requestDeleteNode = (id: string) => {
    const node = draft?.nodes.find((item) => item.id === id);
    if (node && ['start', 'input', 'output', 'end'].includes(node.type)) { setError('Los nodos estructurales del flujo no se pueden eliminar. Puedes quitar sus conexiones.'); return; }
    setNodeToDelete(id);
  };
  const removeNode = (id: string) => {
    if (!draft) return;
    if (['start', 'input', 'output', 'end'].includes(draft.nodes.find((node) => node.id === id)?.type || '')) { setNodeToDelete(null); return; }
    updateDraft((current) => ({ ...current, nodes: current.nodes.filter((node) => node.id !== id), edges: current.edges.filter((edge) => edge.source !== id && edge.target !== id) }));
    setNodeToDelete(null);
  };
  const moveNode = (id: string, position: { x: number; y: number }) => updateDraft((flow) => ({ ...flow, nodes: flow.nodes.map((node) => node.id === id ? { ...node, position } : node) }), false);
  const moveNodes = (positions: Record<string, { x: number; y: number }>) => updateDraft((flow) => ({ ...flow, nodes: flow.nodes.map((node) => positions[node.id] ? { ...node, position: positions[node.id] } : node) }), false);
  const patchNode = (id: string, patch: Partial<FlowNode> & { config?: Record<string, unknown> }) => updateDraft((flow) => ({ ...flow, nodes: flow.nodes.map((node) => node.id === id ? { ...node, ...patch, config: patch.config ? { ...node.config, ...patch.config } : node.config } : node) }));
  const duplicateNodes = (ids: string[]) => {
    if (!draft || !ids.length) return;
    const selectedNodes = draft.nodes.filter((node) => ids.includes(node.id) && !['start', 'input', 'output', 'end'].includes(node.type));
    const idMap = new Map(selectedNodes.map((node) => [node.id, newId()]));
    const copies = selectedNodes.map((node) => ({ ...node, id: idMap.get(node.id)!, name: `${node.name || 'Nodo'} · copia`, position: { x: (node.position?.x || 90) + 52, y: (node.position?.y || 90) + 52 }, config: { ...node.config } }));
    const copiedEdges = draft.edges.filter((edge) => idMap.has(edge.source) && idMap.has(edge.target)).map((edge) => ({ ...edge, source: idMap.get(edge.source)!, target: idMap.get(edge.target)! }));
    updateDraft((current) => ({ ...current, nodes: [...current.nodes, ...copies], edges: [...current.edges, ...copiedEdges] }));
  };
  const connectNode = (targetId: string, sourceId: string, sourceHandle?: string) => {
    if (!draft) return;
    const source = draft.nodes.find((node) => node.id === sourceId);
    const target = draft.nodes.find((node) => node.id === targetId);
    if (!source || !target || sourceId === targetId) { setError('La conexión no es válida: selecciona un puerto de salida y otro de entrada.'); return; }
    if (source.type === 'output' || source.type === 'end') { setError('Una salida o finalización no puede iniciar otra conexión.'); return; }
    if (target.type === 'start') { setError('El inicio manual no admite entradas.'); return; }
    if (source.type === 'condition' && !sourceHandle) { setError('Elige la rama verdadera o falsa de la condición.'); return; }
    if (source.type !== 'condition' && sourceHandle) { setError('Solo las condiciones tienen puertos de rama.'); return; }
    const edgeSourceHandle = source.type === 'condition' ? (sourceHandle === 'false' ? 'false' : 'true') : undefined;
    const edges = draft.edges.filter((edge) => edge.target !== targetId && !(edge.source === sourceId && edge.sourceHandle === edgeSourceHandle));
    if (wouldCreateCycle(edges, sourceId, targetId)) { setError('Esa conexión crearía un ciclo. Elige otro nodo de origen.'); return; }
    if (edges.some((edge) => edge.source === sourceId && edge.target === targetId && edge.sourceHandle === edgeSourceHandle)) { setError('Ese enlace ya existe.'); return; }
    updateDraft((current) => ({ ...current, edges: [...edges, { source: sourceId, target: targetId, ...(edgeSourceHandle ? { sourceHandle: edgeSourceHandle } : {}) }] })); setError('');
  };
  const disconnectNode = (targetId: string) => updateDraft((current) => ({ ...current, edges: current.edges.filter((edge) => edge.target !== targetId) }));
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
      onRefresh(); setActiveId(copy.id); setIsUnsavedDraft(false); pastRef.current = []; futureRef.current = []; setDraft(withWorkflowPositions(copy));
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
  const generate = async (eventOrRequest: FormEvent | string) => {
    if (typeof eventOrRequest !== 'string') eventOrRequest.preventDefault();
    const request = (typeof eventOrRequest === 'string' ? eventOrRequest : generationRequest).trim();
    if (isGenerating || !request) return;
    setGenerationRequest(request);
    if (!providerForOptions?.ready || !modelValue) {
      setGenerationError(generatorOptions?.secondProviderReason || 'Configurá un proveedor y un modelo disponible antes de generar.');
      return;
    }
    const providerOverride = selectedGeneratorProviderId || undefined;
    const modelOverride = selectedAlternativeModel ? modelValue : undefined;
    setIsGenerating(true); setGenerationError(''); setGenerationNotice(''); setError('');
    try {
      const result = await api<{ name: string; description: string; nodes: FlowNode[]; edges: FlowEdge[]; generatedBy: { providerId: string; providerName: string; modelId: string; modelName: string } }>('/workflows/generate', {
        method: 'POST', body: JSON.stringify({ request, requestId: crypto.randomUUID(), ...(providerOverride ? { providerId: providerOverride } : {}), ...(modelOverride ? { modelId: modelOverride } : {}) }),
      });
      const now = new Date().toISOString();
      const generatedDraft: Workflow = { id: `draft-${newId()}`, name: result.name, description: result.description, nodes: result.nodes, edges: result.edges, enabled: true, createdAt: now, updatedAt: now };
      setProposal({ workflow: withWorkflowPositions(generatedDraft), generatedBy: { providerName: result.generatedBy.providerName, modelName: result.generatedBy.modelName } });
      setGenerationNotice(`La propuesta está lista. Revisala antes de aplicarla al lienzo.`);
      onRefreshUsage();
    } catch (e) { setGenerationError(e instanceof Error ? e.message : 'No se pudo generar la automatización. No se guardó ningún flujo.'); onRefreshUsage(); }
    finally { setIsGenerating(false); }
  };
  const acceptProposal = () => {
    if (!proposal) return;
    pastRef.current = []; futureRef.current = [];
    setActiveId(null); setDraft(proposal.workflow); setIsUnsavedDraft(true); setProposal(null); setRun(null);
    setNotice('Propuesta aplicada como borrador. Puedes modificar nodos y conexiones antes de guardarla.');
  };
  const exportFlow = (flow: Workflow) => {
    const safe = exportableWorkflow(flow);
    const blob = new Blob([JSON.stringify(safe, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${(flow.name || 'automatizacion').toLowerCase().replace(/[^a-z0-9áéíóúñ]+/gi, '-').replace(/^-|-$/g, '') || 'automatizacion'}.json`;
    anchor.click(); URL.revokeObjectURL(url);
  };
  const importFlow = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!validateImportedWorkflow(parsed)) throw new Error('El archivo no contiene un flujo válido o incluye nodos no compatibles.');
      const imported: Workflow = withWorkflowPositions({ id: `import-${newId()}`, name: parsed.name, description: parsed.description || '', nodes: parsed.nodes, edges: parsed.edges, enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      pastRef.current = []; futureRef.current = [];
      setActiveId(null); setDraft(imported); setIsUnsavedDraft(true); setNotice('Flujo importado como borrador. Revisa sus conexiones antes de guardarlo o ejecutarlo.');
    } catch (error) { setError(error instanceof Error ? error.message : 'No se pudo importar el flujo.'); }
  };
  const restoreVersion = async (version: WorkflowVersion) => {
    if (!activeId || !window.confirm(`¿Restaurar la versión del ${new Date(version.createdAt).toLocaleString()}? Se guardará la versión actual antes de reemplazarla.`)) return;
    try {
      const restored = await api<Workflow>(`/workflows/${encodeURIComponent(activeId)}/versions/${encodeURIComponent(version.id)}/restore`, { method: 'POST', body: '{}' });
      setDraft(withWorkflowPositions(restored)); setIsUnsavedDraft(false); pastRef.current = []; futureRef.current = []; setShowVersions(false); setNotice('Versión restaurada y guardada.'); onRefresh();
      setVersions(await api<WorkflowVersion[]>(`/workflows/${encodeURIComponent(activeId)}/versions`));
    } catch (error) { setError(error instanceof Error ? error.message : 'No se pudo restaurar la versión.'); }
  };
  const selectGeneratorProvider = (providerId: string) => {
    setSelectedGeneratorProviderId(providerId);
    const provider = providerId ? generatorOptions?.providers.find((item) => item.id === providerId) : defaultGenerator;
    setSelectedGeneratorModelId(provider?.models[0]?.id || '');
  };
  const dockProviderId = selectedGeneratorProviderId || defaultGenerator?.id || '';
  const selectDockProvider = (providerId: string) => {
    if (providerId === defaultGenerator?.id) selectGeneratorProvider('');
    else selectGeneratorProvider(providerId);
  };
  useEffect(() => {
    if (!activeId) { setRunHistory([]); setVersions([]); return; }
    let current = true;
    api<any[]>(`/workflows/${encodeURIComponent(activeId)}/runs`).then((rows) => { if (current) setRunHistory(rows); }).catch(() => { /* Historial opcional mientras se edita. */ });
    api<WorkflowVersion[]>(`/workflows/${encodeURIComponent(activeId)}/versions`).then((rows) => { if (current) setVersions(rows); }).catch(() => { if (current) setVersions([]); });
    return () => { current = false; };
  }, [activeId]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!draft || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [draft]);

  const catalogCategories = ['Todos', ...Array.from(new Set(catalog.map((item) => item.category)))];
  const visibleCatalog = catalog.filter((item) => (catalogCategory === 'Todos' || item.category === catalogCategory) && (!catalogSearch.trim() || `${item.label} ${item.description} ${item.category}`.toLowerCase().includes(catalogSearch.trim().toLowerCase())));
  const catalogGroups = catalogCategories.filter((category) => category !== 'Todos').map((category) => ({ category, items: visibleCatalog.filter((item) => item.category === category) })).filter((group) => group.items.length);

  return <div className="page-content automations-page">
    {!draft ? <>
      <div className="page-heading-row automation-page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> N2N · FLUJOS CONECTADOS</div><h1>Automatizaciones</h1><p>Diseña, conecta y ejecuta operaciones reales con inteligencia artificial.</p></div><div className="automation-heading-actions"><input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(event) => void importFlow(event)} /><button className="button button-quiet" onClick={() => importRef.current?.click()} disabled={busy || isGenerating}><FileUp size={15} />Importar JSON</button><button className="button button-secondary" onClick={() => void addFlow()} disabled={busy || isGenerating}><Plus size={16} />Crear flujo</button></div></div>
      <div className="automation-metric-strip"><div><span className="metric-icon metric-icon-green"><WorkflowIcon size={14} /></span><span><b>{workflows.length}</b><small>Flujos guardados</small></span></div><div><span className="metric-icon metric-icon-violet"><Activity size={14} /></span><span><b>{workflows.reduce((total, flow) => total + flow.nodes.length, 0)}</b><small>Nodos conectados</small></span></div><div><span className="metric-icon metric-icon-blue"><CirclePlay size={14} /></span><span><b>{workflows.filter(enabled).length}</b><small>Listos para ejecutar</small></span></div><div><span className="metric-icon metric-icon-amber"><Sparkles size={14} /></span><span><b>{generatorOptions?.providers.filter((provider) => provider.ready).length || 0}</b><small>Proveedores activos</small></span></div></div>
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
        <div className="workflow-list-icon"><WorkflowIcon size={19} /></div><div className="workflow-list-meta"><div className="workflow-list-title-row"><h3>{workflow.name}</h3><span className={`automation-status-pill ${enabled(workflow) ? 'automation-status-active' : 'automation-status-paused'}`}><i />{enabled(workflow) ? 'Activa' : 'En pausa'}</span></div><p>{workflow.description || 'Sin descripción'} · {workflow.nodes.length} nodos</p><small>Actualizada {new Date(workflow.updatedAt).toLocaleDateString()}</small></div><div className="workflow-list-actions"><button className="icon-button" title="Exportar automatización sin secretos" aria-label={`Exportar ${workflow.name}`} onClick={() => exportFlow(workflow)} disabled={busy || isGenerating}><Download size={15} /></button><button className="icon-button" title="Duplicar automatización" aria-label={`Duplicar ${workflow.name}`} onClick={() => void duplicate(workflow)} disabled={busy || isGenerating}><Copy size={15} /></button><button className={`icon-button ${!enabled(workflow) ? 'automation-resume-button' : ''}`} title={enabled(workflow) ? 'Pausar nuevas ejecuciones' : 'Reanudar automatización'} aria-label={enabled(workflow) ? `Pausar ${workflow.name}` : `Reanudar ${workflow.name}`} onClick={() => void toggleWorkflow(workflow)} disabled={busy || isGenerating}>{enabled(workflow) ? <Pause size={15} /> : <Play size={15} />}</button><button className="icon-button danger-icon" title="Eliminar automatización" aria-label={`Eliminar ${workflow.name}`} onClick={() => void deleteFlow(workflow)} disabled={busy || isGenerating}><Trash2 size={15} /></button><button className="button button-secondary button-sm" onClick={() => { pastRef.current = []; futureRef.current = []; setIsUnsavedDraft(false); setActiveId(workflow.id); setNotice(''); setError(''); }} disabled={busy || isGenerating}>Editar <ArrowRight size={14} /></button></div>
      </article>)}</div>}
      <div className="workflow-roadmap"><span><Clock3 size={14} /> Ejecución manual disponible</span><span>Los disparadores programados todavía no están implementados. Pausar impide nuevas ejecuciones; no interrumpe las ya iniciadas.</span></div>
    </> : <>
      <div className="flow-editor-topbar automation-editor-enter"><button className="button button-quiet button-sm" onClick={closeEditor}><ArrowLeft size={15} />Automatizaciones</button><div className="flow-title-edit"><WorkflowIcon size={17} /><input aria-label="Nombre del flujo" value={draft.name} onChange={(event) => updateDraft((current) => ({ ...current, name: event.target.value }))} /><span>{draft.nodes.length} NODOS</span></div><div className="flow-top-actions">
        <button className="icon-button" title="Deshacer" aria-label="Deshacer" onClick={undo} disabled={!pastRef.current.length || busy || isGenerating}><Undo2 size={14} /></button><button className="icon-button" title="Rehacer" aria-label="Rehacer" onClick={redo} disabled={!futureRef.current.length || busy || isGenerating}><Redo2 size={14} /></button>
        <button className="button button-quiet button-sm" onClick={() => setShowVersions((value) => !value)} disabled={isUnsavedDraft}><Clock3 size={14} />Historial{versions.length ? ` · ${versions.length}` : ''}</button><button className="button button-quiet button-sm" onClick={() => exportFlow(draft)} disabled={busy || isGenerating}><Download size={14} />Exportar</button>
        {!isUnsavedDraft && <button className="button button-quiet button-sm" onClick={() => void toggleWorkflow(draft)}><span className={`automation-status-dot ${enabled(draft) ? 'is-active' : 'is-paused'}`} />{enabled(draft) ? <><Pause size={14} />Pausar</> : <><Play size={14} />Reanudar</>}</button>}
        {!isUnsavedDraft && <button className="button button-quiet button-sm" onClick={() => void duplicate(draft)} disabled={busy || isGenerating}><Copy size={14} />Duplicar</button>}
        <button className="button button-secondary button-sm" onClick={() => void save()} disabled={busy || isGenerating}><Save size={14} />{isUnsavedDraft ? 'Guardar borrador' : 'Guardar'}</button>
        <button className="button button-primary button-sm" onClick={() => void execute()} disabled={busy || isGenerating || !enabled(draft) || isUnsavedDraft}><CirclePlay size={15} />{busyAction === 'run' ? 'Ejecutando…' : 'Ejecutar'}</button>
        {!isUnsavedDraft && <button className="icon-button danger-icon" title="Eliminar automatización" aria-label="Eliminar automatización" onClick={() => void deleteFlow(draft)} disabled={busy || isGenerating}><Trash2 size={15} /></button>}
      </div></div>
      {isUnsavedDraft && <div className="automation-draft-warning"><Sparkles size={14} /><span>Este es un borrador generado por IA; todavía no se guardó en tu cuenta. Revisalo antes de guardarlo.</span></div>}
      {!enabled(draft) && <div className="automation-paused-banner"><Pause size={14} /><span>Automatización pausada. No se aceptan nuevas ejecuciones; las ya iniciadas no se interrumpen.</span></div>}
      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}{notice && <div className="success-banner automation-feedback-enter"><Check size={15} />{notice}<button className="icon-button" onClick={() => setNotice('')}>×</button></div>}
      {showVersions && <section className="workflow-version-panel"><div className="workflow-version-panel-head"><div><span className="section-kicker">CONTROL DE CAMBIOS</span><h3>Versiones guardadas</h3></div><span>{versions.length} snapshots · se conservan en el servidor</span></div>{versions.length ? <div className="workflow-version-list">{versions.map((version, index) => <div className="workflow-version-row" key={version.id}><span className={index === 0 ? 'workflow-version-current' : ''}>{index === 0 ? 'Actual' : `v${versions.length - index}`}</span><div><b>{new Date(version.createdAt).toLocaleString()}</b><small>{version.nodes.length} nodos · {version.edges.length} conexiones</small></div><button className="button button-quiet button-sm" onClick={() => void restoreVersion(version)} disabled={index === 0}>Restaurar</button></div>)}</div> : <p className="workflow-version-empty">Guarda el flujo para comenzar a registrar versiones.</p>}</section>}
      <div className="flow-editor-layout automation-editor-enter"><main className="flow-canvas"><div className="flow-canvas-header"><div><span className="section-kicker">EDITOR VISUAL</span><h2>{draft.description || 'Diseña tu flujo'}</h2></div><label className="flow-description-edit"><span>DESCRIPCIÓN</span><input value={draft.description} onChange={(event) => updateDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Qué hace esta automatización" /></label></div>
        <WorkflowCanvas workflow={draft} providers={providers} modelsByProvider={modelsByProvider} agents={agents} onMoveNode={moveNode} onMoveNodes={moveNodes} onBeforeChange={recordBeforeChange} onDuplicateNodes={duplicateNodes} isRunning={busyAction === 'run'} onPatchNode={patchNode} onConnect={connectNode} onDisconnect={disconnectNode} onDeleteNode={requestDeleteNode} onAddNode={() => setShowNodePicker(true)} />
      </main>
      <aside className="flow-run-panel"><div className="flow-run-panel-head"><div className="run-panel-icon"><CirclePlay size={17} /></div><div><b>Ejecución manual</b><small>{enabled(draft) ? 'Prueba el flujo con una entrada real' : 'Reactiva el flujo para ejecutar'}</small></div></div><label>Texto de entrada<textarea rows={5} value={input} onChange={(event) => setInput((event.target as HTMLTextAreaElement).value)} placeholder="Escribe el texto que recibirá el flujo…" /></label><label>Proyecto para leer / escribir<select value={projectForRun} onChange={(event) => setProjectForRun((event.target as HTMLSelectElement).value)}><option value="">Sin proyecto seleccionado</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label><button className="button button-primary run-flow-button" onClick={() => void execute()} disabled={busy || isGenerating || !enabled(draft) || isUnsavedDraft}><CirclePlay size={16} />{busyAction === 'run' ? 'Ejecutando…' : 'Ejecutar flujo'}</button><div className="run-safety-footnote"><span className="mini-shield">⌑</span>Cada ejecución confirmada se registra en el servidor. Las llamadas a IA/HTTP y las escrituras requieren autorización.</div>
        {busyAction === 'run' && <div className="automation-run-pending" role="status" aria-live="polite"><LoaderCircle size={15} className="spin" /><span>El motor está ejecutando los pasos del flujo…</span></div>}
        {run && <div className="run-result automation-feedback-enter"><div className="run-result-head"><span className="run-success-dot" /><b>Completada</b><small>{run.elapsedMs} ms</small></div><pre>{String(run.output?.text || '(sin salida)')}</pre><div className="run-log-list">{run.logs?.map((log: any, index: number) => <div key={`${log.nodeId}-${index}`} className={`run-log run-log-${log.status}`}><i />{log.nodeName}: {log.message}</div>)}</div>{run.artifacts?.length > 0 && <div className="run-artifacts"><b>Archivos guardados</b>{run.artifacts.map((file: any) => <div key={file.path}>{file.path}<small>{file.validationMessage}</small></div>)}</div>}</div>}
        {runHistory.length > 0 && <div className="run-history"><h4>Últimas ejecuciones</h4>{runHistory.slice(0, 5).map((item, index) => <div key={item.id || index}><span className={item.status === 'complete' ? 'history-success-dot' : item.status === 'running' ? 'automation-run-dot' : 'history-error-dot'} />{item.status || 'complete'}<small>{item.finishedAt ? new Date(item.finishedAt).toLocaleTimeString() : 'ahora'}</small></div>)}</div>}
      </aside></div>
    </>}
    <WorkflowAgentDock options={generatorOptions} loading={generatorOptionsLoading} isGenerating={isGenerating} proposalReady={Boolean(proposal)} activeProviderId={dockProviderId} activeModelId={modelValue} onProviderChange={selectDockProvider} onModelChange={setSelectedGeneratorModelId} onGenerate={(request) => void generate(request)} onReviewProposal={() => setGenerationNotice('Revisa la propuesta en el panel abierto; todavía no se ha aplicado al lienzo.')} onGoProviders={onGoProviders} />
    {proposal && <Modal wide title="Revisa la propuesta del agente" description="La IA preparó un plan, pero no ha creado ni guardado nada. Comprueba los pasos y decide qué hacer." onClose={() => setProposal(null)}>
      <div className="workflow-proposal-meta"><span className="workflow-proposal-orb"><Sparkles size={16} /></span><div><b>{proposal.workflow.name}</b><small>{proposal.generatedBy.providerName} · {proposal.generatedBy.modelName} · borrador no guardado</small></div><span className="workflow-proposal-stat"><strong>{proposal.workflow.nodes.length}</strong> nodos</span><span className="workflow-proposal-stat"><strong>{proposal.workflow.edges.length}</strong> conexiones</span></div>
      <div className="workflow-proposal-list">{proposal.workflow.nodes.map((node, index) => <div className="workflow-proposal-step" key={node.id}><span>{String(index + 1).padStart(2, '0')}</span><div><b>{node.name || node.type}</b><small>{node.type === 'ai' ? 'Ejecutará el modelo configurado' : node.type === 'input' ? 'Entrada del usuario' : node.type === 'output' || node.type === 'end' ? 'Entrega de resultado' : 'Paso validado del motor'}</small></div><i className="workflow-proposal-check"><Check size={12} /></i></div>)}</div>
      <div className="workflow-proposal-safety"><span className="mini-shield">⌑</span>Se validaron las conexiones y el grafo acíclico. Las llamadas externas y escrituras seguirán requiriendo confirmación al ejecutar.</div>
      <div className="modal-actions"><button className="button button-quiet" onClick={() => setProposal(null)}>Rechazar</button><button className="button button-secondary" onClick={acceptProposal}><Settings2 size={14} />Aplicar y modificar</button><button className="button button-primary" onClick={acceptProposal}><Check size={14} />Aplicar al lienzo</button></div>
    </Modal>}
    {showNodePicker && <Modal wide title="Biblioteca de módulos" description="Conecta operaciones reales al flujo. Los módulos experimentales están visibles, pero bloqueados hasta que exista una implementación segura." onClose={() => setShowNodePicker(false)}><div className="node-picker-toolbar"><label><span>BUSCAR MÓDULO</span><input value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} placeholder="Buscar por nombre, categoría…" autoFocus /></label><div className="node-picker-categories">{catalogCategories.map((category) => <button key={category} className={catalogCategory === category ? 'active' : ''} onClick={() => setCatalogCategory(category)}>{category}</button>)}</div></div><div className="node-picker-groups">{catalogGroups.map(({ category, items }) => <section key={category}><div className="node-picker-group-title"><span>{category}</span><small>{items.filter((item) => item.status !== 'experimental').length} disponibles</small></div><div className="node-picker-list">{items.map((item) => { const { type, label, description, Icon, status } = item; const experimental = status === 'experimental'; return <button key={`${type}-${label}`} className={experimental ? 'node-picker-disabled' : ''} disabled={experimental} onClick={() => addNode(item)}><span><Icon size={16} /></span><div><b>{label}</b><small>{description}</small></div>{experimental ? <em>Pendiente</em> : <Plus size={14} />}</button>; })}</div></section>)}{!catalogGroups.length && <div className="node-picker-empty">No hay módulos que coincidan con tu búsqueda.</div>}</div></Modal>}
    {nodeToDelete && <Modal title="Quitar nodo" description="Se quitarán las conexiones de este nodo. Revisa los enlaces restantes antes de guardar o ejecutar el flujo." onClose={() => setNodeToDelete(null)}><div className="modal-actions"><button className="button button-quiet" onClick={() => setNodeToDelete(null)}>Cancelar</button><button className="button button-danger" onClick={() => removeNode(nodeToDelete)}><Trash2 size={14} />Quitar nodo</button></div></Modal>}
  </div>;
}
