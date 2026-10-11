import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Bot, Check, CirclePlay, Clock3, Copy, GitBranch, Globe2, Layers3, ListChecks, Plus, Save, Settings2, Sparkles, Trash2, Workflow as WorkflowIcon } from 'lucide-react';
import type { Agent, FlowEdge, FlowNode, Model, Project, Provider, Workflow } from '../types';
import { api } from '../api';
import { EmptyState, ErrorBanner, Modal } from './common';
import { WorkflowCanvas } from './WorkflowCanvas';

const catalog: { type: string; label: string; description: string; Icon: typeof WorkflowIcon }[] = [
  { type: 'text', label: 'Texto', description: 'Añade o transforma texto', Icon: Layers3 },
  { type: 'ai', label: 'Nodo de IA', description: 'Ejecuta un modelo conectado', Icon: Sparkles },
  { type: 'agent', label: 'Agente', description: 'Carga instrucciones de un agente', Icon: Bot },
  { type: 'read_file', label: 'Leer archivo', description: 'Lee archivos del proyecto activo', Icon: ListChecks },
  { type: 'write_file', label: 'Escribir archivo', description: 'Guarda un archivo en el proyecto', Icon: Save },
  { type: 'transform', label: 'Transformar', description: 'Mayúsculas, minúsculas, prefijo…', Icon: Settings2 },
  { type: 'condition', label: 'Condición', description: 'Abre ramas verdadera y falsa', Icon: GitBranch },
  { type: 'http', label: 'Petición HTTP', description: 'HTTPS público permitido por allowlist', Icon: Globe2 },
  { type: 'output', label: 'Salida', description: 'Devuelve el resultado del flujo', Icon: ArrowRight },
];
function newId() { return crypto.randomUUID().replace(/-/g, '').slice(0, 12); }

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

function starterFlow(): { nodes: FlowNode[]; edges: FlowEdge[] } {
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

export function AutomationPage({ workflows, providers, modelsByProvider, agents, projects, activeProjectId, onRefresh, onRefreshUsage }: { workflows: Workflow[]; providers: Provider[]; modelsByProvider: Record<string, Model[]>; agents: Agent[]; projects: Project[]; activeProjectId: string | null; onRefresh: () => void; onRefreshUsage: () => void }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Workflow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [input, setInput] = useState('');
  const [projectForRun, setProjectForRun] = useState(activeProjectId || '');
  const [run, setRun] = useState<any>(null);
  const [runHistory, setRunHistory] = useState<any[]>([]);
  const [showNodePicker, setShowNodePicker] = useState(false);
  const [nodeToDelete, setNodeToDelete] = useState<string | null>(null);

  useEffect(() => {
    const workflow = workflows.find((item) => item.id === activeId);
    if (workflow) setDraft(withWorkflowPositions(workflow));
    else if (!activeId) setDraft(null);
  }, [workflows, activeId]);
  useEffect(() => { if (activeProjectId) setProjectForRun(activeProjectId); }, [activeProjectId]);

  const addFlow = async () => {
    const starter = starterFlow();
    try {
      setBusy(true); setError('');
      const created = await api<Workflow>('/workflows', { method: 'POST', body: JSON.stringify({ name: 'Nueva automatización', description: 'Flujo creado desde Nexus.', ...starter }) });
      onRefresh(); setActiveId(created.id); setDraft(withWorkflowPositions(created));
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo crear el flujo.'); }
    finally { setBusy(false); }
  };
  const updateDraft = (updater: (value: Workflow) => Workflow) => setDraft((current) => current ? updater(current) : current);
  const save = async () => {
    if (!draft) return;
    setBusy(true); setError('');
    try {
      const saved = await api<Workflow>(`/workflows/${encodeURIComponent(draft.id)}`, { method: 'PATCH', body: JSON.stringify({ name: draft.name, description: draft.description, nodes: draft.nodes, edges: draft.edges }) });
      setDraft(withWorkflowPositions(saved)); onRefresh(); setNotice('Flujo guardado con posiciones y conexiones.');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar el flujo.'); }
    finally { setBusy(false); }
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
                : type === 'http' ? { method: 'GET', url: 'https://example.com' }
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
    try { await api(`/workflows/${encodeURIComponent(flow.id)}`, { method: 'DELETE', body: JSON.stringify({ confirm: true }) }); onRefresh(); setActiveId(null); setDraft(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo eliminar el flujo.'); }
  };
  const duplicate = async (flow: Workflow) => {
    try {
      const copy = await api<Workflow>(`/workflows/${encodeURIComponent(flow.id)}/duplicate`, { method: 'POST', body: '{}' });
      onRefresh(); setActiveId(copy.id); setDraft(withWorkflowPositions(copy));
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo duplicar el flujo.'); }
  };
  const execute = async () => {
    if (!draft) return;
    const usesExternal = draft.nodes.some((node) => node.type === 'ai' || node.type === 'http');
    const writesFiles = draft.nodes.some((node) => node.type === 'write_file');
    const actions = [usesExternal ? 'enviar datos a proveedores externos' : '', writesFiles ? 'crear o reemplazar archivos del proyecto' : ''].filter(Boolean).join(' y ');
    if (actions && !window.confirm(`Este flujo puede ${actions}. ¿Autorizas esta ejecución?`)) return;
    setBusy(true); setError(''); setRun(null);
    try {
      const result = await api<any>(`/workflows/${encodeURIComponent(draft.id)}/run`, { method: 'POST', body: JSON.stringify({ input, projectId: projectForRun || null, confirmExternalResources: usesExternal, confirmProjectWrites: writesFiles }) });
      setRun(result); setRunHistory([result, ...runHistory].slice(0, 10)); onRefreshUsage();
    } catch (e) { setError(e instanceof Error ? e.message : 'Falló la ejecución del flujo.'); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!activeId) { setRunHistory([]); return; }
    let current = true;
    api<any[]>(`/workflows/${encodeURIComponent(activeId)}/runs`).then((rows) => { if (current) setRunHistory(rows); }).catch(() => { /* Historial opcional mientras se edita. */ });
    return () => { current = false; };
  }, [activeId]);

  return <div className="page-content automations-page">
    {!draft ? <>
      <div className="page-heading-row"><div><div className="eyebrow"><span className="eyebrow-dot" /> FLUJOS CONECTADOS</div><h1>Automatizaciones</h1><p>Encadena entradas, agentes, modelos y archivos en ejecuciones controladas.</p></div><button className="button button-primary" onClick={() => void addFlow()} disabled={busy}><Plus size={16} />Crear flujo</button></div>
      <div className="flow-security-note"><span className="mini-shield">⌑</span><div><b>Diseñado para ejecutar bajo permisos</b><p>Sin comandos de sistema ni código arbitrario. Las peticiones HTTP requieren una allowlist HTTPS configurada en el servidor.</p></div></div>
      <div className="workflow-list">{workflows.length ? workflows.map((workflow) => <article className="workflow-list-card" key={workflow.id}><div className="workflow-list-icon"><WorkflowIcon size={19} /></div><div className="workflow-list-meta"><h3>{workflow.name}</h3><p>{workflow.description || 'Sin descripción'} · {workflow.nodes.length} nodos</p><small>Actualizado {new Date(workflow.updatedAt).toLocaleDateString()}</small></div><div className="workflow-list-actions"><button className="icon-button" title="Duplicar" onClick={() => void duplicate(workflow)}><Copy size={15} /></button><button className="icon-button danger-icon" title="Eliminar" onClick={() => void deleteFlow(workflow)}><Trash2 size={15} /></button><button className="button button-secondary button-sm" onClick={() => setActiveId(workflow.id)}>Editar <ArrowRight size={14} /></button></div></article>) : <EmptyState icon={<WorkflowIcon size={24} />} title="Empieza con un flujo" description="Crea una automatización y conecta nodos visuales mediante sus puertos." action={<button className="button button-primary" onClick={() => void addFlow()}><Plus size={16} />Crear primer flujo</button>} />}</div>
      <div className="workflow-roadmap"><span><Clock3 size={14} /> Disparadores programados: próximos</span><span>Las ejecuciones manuales se guardan en el servidor. No dependen de que esta página permanezca abierta.</span></div>
    </> : <>
      <div className="flow-editor-topbar"><button className="button button-quiet button-sm" onClick={() => setActiveId(null)}><ArrowLeft size={15} />Automatizaciones</button><div className="flow-title-edit"><WorkflowIcon size={17} /><input aria-label="Nombre del flujo" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /><span>{draft.nodes.length} NODOS</span></div><div className="flow-top-actions"><button className="button button-quiet button-sm" onClick={() => void duplicate(draft)}><Copy size={14} />Duplicar</button><button className="button button-secondary button-sm" onClick={() => void save()} disabled={busy}><Save size={14} />Guardar</button><button className="button button-primary button-sm" onClick={() => void execute()} disabled={busy}><CirclePlay size={15} />{busy ? 'Ejecutando…' : 'Ejecutar'}</button><button className="icon-button danger-icon" title="Eliminar flujo" onClick={() => void deleteFlow(draft)}><Trash2 size={15} /></button></div></div>
      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}{notice && <div className="success-banner"><Check size={15} />{notice}<button className="icon-button" onClick={() => setNotice('')}>×</button></div>}
      <div className="flow-editor-layout"><main className="flow-canvas"><div className="flow-canvas-header"><div><span className="section-kicker">EDITOR VISUAL</span><h2>{draft.description || 'Diseña tu flujo'}</h2></div><label className="flow-description-edit"><span>DESCRIPCIÓN</span><input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Qué hace esta automatización" /></label></div>
        <WorkflowCanvas workflow={draft} providers={providers} modelsByProvider={modelsByProvider} agents={agents} onMoveNode={moveNode} onPatchNode={patchNode} onConnect={connectNode} onDisconnect={disconnectNode} onDeleteNode={setNodeToDelete} onAddNode={() => setShowNodePicker(true)} />
      </main>
      <aside className="flow-run-panel"><div className="flow-run-panel-head"><div className="run-panel-icon"><CirclePlay size={17} /></div><div><b>Ejecución manual</b><small>Prueba el flujo con una entrada real</small></div></div><label>Texto de entrada<textarea rows={5} value={input} onChange={(event) => setInput((event.target as HTMLTextAreaElement).value)} placeholder="Escribe el texto que recibirá el flujo…" /></label><label>Proyecto para leer / escribir<select value={projectForRun} onChange={(event) => setProjectForRun((event.target as HTMLSelectElement).value)}><option value="">Sin proyecto seleccionado</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label><button className="button button-primary run-flow-button" onClick={() => void execute()} disabled={busy}><CirclePlay size={16} />{busy ? 'Ejecutando…' : 'Ejecutar flujo'}</button><div className="run-safety-footnote"><span className="mini-shield">⌑</span>Cada ejecución se registra en la base de datos. Las llamadas a IA/HTTP requieren confirmación.</div>
        {run && <div className="run-result"><div className="run-result-head"><span className="run-success-dot" /><b>Resultado</b><small>{run.elapsedMs} ms</small></div><pre>{String(run.output?.text || '(sin salida)')}</pre><div className="run-log-list">{run.logs?.map((log: any, index: number) => <div key={`${log.nodeId}-${index}`} className={`run-log run-log-${log.status}`}><i />{log.nodeName}: {log.message}</div>)}</div>{run.artifacts?.length > 0 && <div className="run-artifacts"><b>Archivos guardados</b>{run.artifacts.map((file: any) => <div key={file.path}>{file.path}<small>{file.validationMessage}</small></div>)}</div>}</div>}
        {runHistory.length > 0 && <div className="run-history"><h4>Últimas ejecuciones</h4>{runHistory.slice(0, 5).map((item, index) => <div key={item.id || index}><span className={item.status === 'complete' ? 'history-success-dot' : 'history-error-dot'} />{item.status || 'complete'}<small>{item.finishedAt ? new Date(item.finishedAt).toLocaleTimeString() : 'ahora'}</small></div>)}</div>}
      </aside></div>
    </>}
    {showNodePicker && <Modal title="Añadir un nodo" description="Selecciona un bloque para colocarlo en el lienzo y conectarlo por sus puertos." onClose={() => setShowNodePicker(false)}><div className="node-picker-list">{catalog.map(({ type, label, description, Icon }) => <button key={type} onClick={() => addNode(type)}><span><Icon size={16} /></span><div><b>{label}</b><small>{description}</small></div><Plus size={14} /></button>)}</div></Modal>}
    {nodeToDelete && <Modal title="Quitar nodo" description="Se quitarán las conexiones de este nodo. Revisa los enlaces restantes antes de guardar o ejecutar el flujo." onClose={() => setNodeToDelete(null)}><div className="modal-actions"><button className="button button-quiet" onClick={() => setNodeToDelete(null)}>Cancelar</button><button className="button button-danger" onClick={() => removeNode(nodeToDelete)}><Trash2 size={14} />Quitar nodo</button></div></Modal>}
  </div>;
}
