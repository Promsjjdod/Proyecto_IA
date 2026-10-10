import { useEffect, useState, type FormEvent } from 'react';
import { Activity, ArrowDown, ArrowDownToLine, ArrowLeft, ArrowRight, Bot, Check, ChevronDown, CirclePlay, Clock3, Copy, GitBranch, Globe2, Layers3, ListChecks, Plus, Save, Settings2, Sparkles, Trash2, Workflow as WorkflowIcon, X } from 'lucide-react';
import type { Agent, FlowEdge, FlowNode, Model, Project, Provider, Workflow } from '../types';
import { api } from '../api';
import { EmptyState, ErrorBanner, Modal, ProviderIcon } from './common';

const catalog: { type: string; label: string; description: string }[] = [
  { type: 'input', label: 'Entrada', description: 'Texto inicial del usuario' },
  { type: 'text', label: 'Texto', description: 'Añade o transforma texto' },
  { type: 'ai', label: 'Nodo de IA', description: 'Ejecuta un modelo conectado' },
  { type: 'agent', label: 'Agente', description: 'Carga instrucciones de un agente' },
  { type: 'read_file', label: 'Leer archivo', description: 'Lee archivos del proyecto activo' },
  { type: 'write_file', label: 'Escribir archivo', description: 'Guarda un archivo en el proyecto' },
  { type: 'transform', label: 'Transformar', description: 'Mayúsculas, minúsculas, prefijo…' },
  { type: 'condition', label: 'Condición', description: 'Evalúa si el texto contiene un valor' },
  { type: 'http', label: 'Petición HTTP', description: 'HTTPS público permitido por allowlist' },
  { type: 'output', label: 'Salida', description: 'Devuelve el resultado del flujo' },
  { type: 'end', label: 'Finalizar', description: 'Termina la ejecución' },
];
const typeIcon: Record<string, typeof WorkflowIcon> = { start: CirclePlay, input: ArrowDown, text: Layers3, ai: Sparkles, agent: Bot, read_file: ListChecks, write_file: Save, transform: Settings2, condition: GitBranch, http: Globe2, output: ArrowRight, end: Check };
function newId() { return crypto.randomUUID().replace(/-/g, '').slice(0, 12); }
function starterFlow(): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = [
    { id: newId(), type: 'start', name: 'Inicio manual', config: {} },
    { id: newId(), type: 'input', name: 'Entrada de texto', config: {} },
    { id: newId(), type: 'output', name: 'Resultado', config: {} },
  ];
  return { nodes, edges: [{ source: nodes[0].id, target: nodes[1].id }, { source: nodes[1].id, target: nodes[2].id }] };
}

export function AutomationPage({ workflows, providers, modelsByProvider, agents, projects, activeProjectId, onRefresh, onRefreshUsage }: { workflows: Workflow[]; providers: Provider[]; modelsByProvider: Record<string, Model[]>; agents: Agent[]; projects: Project[]; activeProjectId: string | null; onRefresh: () => void; onRefreshUsage: () => void }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Workflow | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [input, setInput] = useState('');
  const [projectForRun, setProjectForRun] = useState(activeProjectId || '');
  const [run, setRun] = useState<any>(null);
  const [runHistory, setRunHistory] = useState<any[]>([]);
  const [showNodePicker, setShowNodePicker] = useState(false);
  const [nodeToDelete, setNodeToDelete] = useState<string | null>(null);
  useEffect(() => { const workflow = workflows.find((item) => item.id === activeId); if (workflow) setDraft(workflow); else if (!activeId) setDraft(null); }, [workflows, activeId]);
  useEffect(() => { if (activeProjectId) setProjectForRun(activeProjectId); }, [activeProjectId]);
  const addFlow = async () => {
    const starter = starterFlow();
    try { setBusy(true); const created = await api<Workflow>('/workflows', { method: 'POST', body: JSON.stringify({ name: 'Nueva automatización', description: 'Flujo creado desde Nexus.', ...starter }) }); onRefresh(); setActiveId(created.id); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo crear el flujo.'); }
    finally { setBusy(false); }
  };
  const updateDraft = (updater: (value: Workflow) => Workflow) => setDraft((current) => current ? updater(current) : current);
  const save = async () => {
    if (!draft) return; setBusy(true); setError('');
    try { const saved = await api<Workflow>(`/workflows/${encodeURIComponent(draft.id)}`, { method: 'PATCH', body: JSON.stringify({ name: draft.name, description: draft.description, nodes: draft.nodes, edges: draft.edges }) }); setDraft(saved); onRefresh(); setNotice('Flujo guardado.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar el flujo.'); }
    finally { setBusy(false); }
  };
  const addNode = (type: string) => {
    if (!draft) return;
    const meta = catalog.find((node) => node.type === type)!;
    const node: FlowNode = { id: newId(), type, name: meta.label, config: type === 'ai' ? { mode: 'MEDIO', providerId: '', modelId: '', prompt: '{{result}}' } : type === 'transform' ? { operation: 'trim' } : type === 'condition' ? { contains: '' } : type === 'write_file' ? { path: 'output.txt', content: '{{result}}' } : type === 'read_file' ? { path: 'README.md' } : type === 'http' ? { method: 'GET', url: 'https://example.com' } : type === 'text' ? { text: '' } : {} };
    const nodes = [...draft.nodes];
    const outputIndex = nodes.findIndex((item) => item.type === 'output' || item.type === 'end');
    const insertAt = outputIndex < 0 ? nodes.length : outputIndex;
    nodes.splice(insertAt, 0, node);
    const edges = nodes.slice(0, -1).map((item, index) => ({ source: item.id, target: nodes[index + 1].id }));
    setDraft({ ...draft, nodes, edges }); setShowNodePicker(false);
  };
  const deleteNode = (id: string) => {
    if (!draft) return;
    const nodes = draft.nodes.filter((node) => node.id !== id);
    const edges = nodes.slice(0, -1).map((item, index) => ({ source: item.id, target: nodes[index + 1].id }));
    setDraft({ ...draft, nodes, edges }); setNodeToDelete(null);
  };
  const moveNode = (index: number, delta: number) => {
    if (!draft) return;
    const nodes = [...draft.nodes]; const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= nodes.length) return;
    [nodes[index], nodes[nextIndex]] = [nodes[nextIndex], nodes[index]];
    const edges = nodes.slice(0, -1).map((node, i) => ({ source: node.id, target: nodes[i + 1].id }));
    setDraft({ ...draft, nodes, edges });
  };
  const patchNode = (id: string, patch: Partial<FlowNode> & { config?: Record<string, any> }) => updateDraft((flow) => ({ ...flow, nodes: flow.nodes.map((node) => node.id === id ? { ...node, ...patch, config: patch.config ? { ...node.config, ...patch.config } : node.config } : node) }));
  const deleteFlow = async (flow: Workflow) => {
    if (!window.confirm(`¿Eliminar el flujo «${flow.name}» y sus registros?`)) return;
    try { await api(`/workflows/${encodeURIComponent(flow.id)}`, { method: 'DELETE', body: JSON.stringify({ confirm: true }) }); onRefresh(); setActiveId(null); setDraft(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo eliminar.'); }
  };
  const duplicate = async (flow: Workflow) => {
    try { const copy = await api<Workflow>(`/workflows/${encodeURIComponent(flow.id)}/duplicate`, { method: 'POST', body: '{}' }); onRefresh(); setActiveId(copy.id); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo duplicar.'); }
  };
  const execute = async () => {
    if (!draft) return;
    const usesExternal = draft.nodes.some((node) => node.type === 'ai' || node.type === 'http');
    if (usesExternal && !window.confirm('Este flujo puede enviar la entrada a un proveedor externo o a un host HTTPS permitido. ¿Continuar?')) return;
    setBusy(true); setError(''); setRun(null);
    try {
      const result = await api<any>(`/workflows/${encodeURIComponent(draft.id)}/run`, { method: 'POST', body: JSON.stringify({ input, projectId: projectForRun || null, confirmExternalResources: usesExternal }) });
      setRun(result); setRunHistory([result, ...runHistory].slice(0, 10)); onRefreshUsage();
    } catch (e) { setError(e instanceof Error ? e.message : 'Falló la ejecución del flujo.'); }
    finally { setBusy(false); }
  };
  const loadRuns = async () => { if (!draft) return; try { setRunHistory(await api<any[]>(`/workflows/${encodeURIComponent(draft.id)}/runs`)); } catch { /* run history is optional in the editor */ } };
  useEffect(() => { void loadRuns(); }, [activeId]);

  return <div className="page-content automations-page">
    {!draft ? <>
      <div className="page-heading-row"><div><div className="eyebrow"><span className="eyebrow-dot" /> FLUJOS CONECTADOS</div><h1>Automatizaciones</h1><p>Encadena entradas, agentes, modelos y archivos en ejecuciones controladas.</p></div><button className="button button-primary" onClick={() => void addFlow()} disabled={busy}><Plus size={16} />Crear flujo</button></div>
      <div className="flow-security-note"><ShieldIcon /><div><b>Diseñado para ejecutar bajo permisos</b><p>Sin comandos de sistema ni código arbitrario. Las peticiones HTTP requieren una allowlist HTTPS configurada en el servidor.</p></div></div>
      <div className="workflow-list">{workflows.length ? workflows.map((workflow) => <article className="workflow-list-card" key={workflow.id}><div className="workflow-list-icon"><WorkflowIcon size={19} /></div><div className="workflow-list-meta"><h3>{workflow.name}</h3><p>{workflow.description || 'Sin descripción'} · {workflow.nodes.length} nodos</p><small>Actualizado {new Date(workflow.updatedAt).toLocaleDateString()}</small></div><div className="workflow-list-actions"><button className="icon-button" title="Duplicar" onClick={() => void duplicate(workflow)}><Copy size={15} /></button><button className="icon-button danger-icon" title="Eliminar" onClick={() => void deleteFlow(workflow)}><Trash2 size={15} /></button><button className="button button-secondary button-sm" onClick={() => setActiveId(workflow.id)}>Editar <ArrowRight size={14} /></button></div></article>) : <EmptyState icon={<WorkflowIcon size={24} />} title="Empieza con un flujo" description="Crea una automatización y conecta nodos visuales para procesar texto y archivos." action={<button className="button button-primary" onClick={() => void addFlow()}><Plus size={16} />Crear primer flujo</button>} />}</div>
      <div className="workflow-roadmap"><span><Clock3 size={14} /> Disparadores programados: próximos</span><span>Las ejecuciones manuales se guardan en el servidor. No dependen de que esta página permanezca abierta.</span></div>
    </> : <>
      <div className="flow-editor-topbar"><button className="button button-quiet button-sm" onClick={() => setActiveId(null)}><ArrowLeft size={15} />Automatizaciones</button><div className="flow-title-edit"><WorkflowIcon size={17} /><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /><span>{draft.nodes.length} NODOS</span></div><div className="flow-top-actions"><button className="button button-quiet button-sm" onClick={() => void duplicate(draft)}><Copy size={14} />Duplicar</button><button className="button button-secondary button-sm" onClick={() => void save()} disabled={busy}><Save size={14} />Guardar</button><button className="button button-primary button-sm" onClick={() => void execute()} disabled={busy}><CirclePlay size={15} />{busy ? 'Ejecutando…' : 'Ejecutar'}</button><button className="icon-button danger-icon" title="Eliminar flujo" onClick={() => void deleteFlow(draft)}><Trash2 size={15} /></button></div></div>
      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}{notice && <div className="success-banner"><Check size={15} />{notice}<button className="icon-button" onClick={() => setNotice('')}>×</button></div>}
      <div className="flow-editor-layout"><main className="flow-canvas"><div className="flow-canvas-header"><div><span className="section-kicker">EDITOR VISUAL</span><h2>{draft.description || 'Diseña tu flujo'}</h2></div><label className="flow-description-edit"><span>DESCRIPCIÓN</span><input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Qué hace esta automatización" /></label></div>
        <div className="flow-node-list">{draft.nodes.map((node, index) => {
          const meta = catalog.find((entry) => entry.type === node.type) || { label: node.type, description: '' };
          const Icon = typeIcon[node.type] || WorkflowIcon;
          return <div className="flow-node-wrap" key={node.id}><article className={`flow-node-card node-${node.type}`}><div className="flow-node-head"><span className="flow-node-icon"><Icon size={16} /></span><div className="flow-node-title"><b>{node.name || meta.label}</b><small>{meta.description}</small></div><span className="flow-node-index">{String(index + 1).padStart(2, '0')}</span><div className="flow-node-control"><button className="icon-button" disabled={index === 0} title="Subir" onClick={() => moveNode(index, -1)}>↑</button><button className="icon-button" disabled={index === draft.nodes.length - 1} title="Bajar" onClick={() => moveNode(index, 1)}>↓</button>{!['start', 'input', 'output', 'end'].includes(node.type) && <button className="icon-button danger-icon" title="Quitar nodo" onClick={() => setNodeToDelete(node.id)}><X size={14} /></button>}</div></div>
            <div className="flow-node-config">{node.type !== 'condition' && draft.nodes.slice(0, index).some((previous) => previous.type === 'condition') && <label className="flow-condition-run">Ejecución condicional<select value={node.config.when || 'always'} onChange={(e) => patchNode(node.id, { config: { when: e.target.value } })}><option value="always">Siempre</option><option value="true">Solo si la última condición es verdadera</option><option value="false">Solo si la última condición es falsa</option></select></label>}{node.type === 'text' && <label>Texto / plantilla<textarea rows={2} value={node.config.text || ''} onChange={(e) => patchNode(node.id, { config: { text: e.target.value } })} placeholder="Usa {{input}} o {{result}}" /></label>}
              {node.type === 'ai' && <><div className="two-field-row"><label>Proveedor<select value={node.config.providerId || ''} onChange={(e) => patchNode(node.id, { config: { providerId: e.target.value, modelId: '' } })}><option value="">Seleccionar proveedor</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label><label>Modelo<select value={node.config.modelId || ''} onChange={(e) => patchNode(node.id, { config: { modelId: e.target.value } })}><option value="">Seleccionar modelo</option>{(modelsByProvider[node.config.providerId] || []).map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}</select></label></div><div className="two-field-row"><label>Modo<select value={node.config.mode || 'MEDIO'} onChange={(e) => patchNode(node.id, { config: { mode: e.target.value } })}><option>LOW</option><option>MEDIO</option><option>ALTO</option><option>EXTRA</option><option>MAX</option></select></label><label>Instrucción<input value={node.config.prompt || '{{result}}'} onChange={(e) => patchNode(node.id, { config: { prompt: e.target.value } })} /></label></div></>}
              {node.type === 'agent' && <label>Agente<select value={node.config.agentId || ''} onChange={(e) => patchNode(node.id, { config: { agentId: e.target.value } })}><option value="">Seleccionar agente</option>{agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name}</option>)}</select></label>}
              {(node.type === 'read_file' || node.type === 'write_file') && <div className="two-field-row"><label>Ruta dentro del proyecto<input value={node.config.path || ''} onChange={(e) => patchNode(node.id, { config: { path: e.target.value } })} placeholder="src/result.txt" /></label>{node.type === 'write_file' && <label>Contenido<textarea rows={2} value={node.config.content || '{{result}}'} onChange={(e) => patchNode(node.id, { config: { content: e.target.value } })} /></label>}</div>}
              {node.type === 'transform' && <div className="two-field-row"><label>Operación<select value={node.config.operation || 'trim'} onChange={(e) => patchNode(node.id, { config: { operation: e.target.value } })}><option value="trim">Quitar espacios</option><option value="uppercase">Mayúsculas</option><option value="lowercase">Minúsculas</option><option value="prepend">Añadir prefijo</option><option value="append">Añadir sufijo</option></select></label>{['prepend', 'append'].includes(node.config.operation) && <label>Texto<input value={node.config.text || ''} onChange={(e) => patchNode(node.id, { config: { text: e.target.value } })} /></label>}</div>}
              {node.type === 'condition' && <label>Se cumple si la salida actual contiene<input value={node.config.contains || ''} onChange={(e) => patchNode(node.id, { config: { contains: e.target.value } })} placeholder="texto a buscar" /></label>}
              {node.type === 'http' && <div className="two-field-row"><label>Método<select value={node.config.method || 'GET'} onChange={(e) => patchNode(node.id, { config: { method: e.target.value } })}><option>GET</option><option>POST</option></select></label><label>URL HTTPS<input value={node.config.url || ''} onChange={(e) => patchNode(node.id, { config: { url: e.target.value } })} placeholder="https://api.example.com" /></label></div>}
              {node.type === 'condition' && <div className="conditional-hint">La condición compara la salida actual. En nodos posteriores puedes elegir ejecutar siempre o solo cuando esta condición sea verdadera o falsa.</div>}
            </div></article>{index < draft.nodes.length - 1 && <div className="flow-connector"><span /><ArrowDown size={14} /><small>CONTINUAR</small></div>}</div>;
        })}</div>
        <button className="flow-add-node" onClick={() => setShowNodePicker(true)}><Plus size={16} />Añadir nodo <span>+</span></button>
      </main>
      <aside className="flow-run-panel"><div className="flow-run-panel-head"><div className="run-panel-icon"><CirclePlay size={17} /></div><div><b>Ejecución manual</b><small>Prueba el flujo con una entrada real</small></div></div><label>Texto de entrada<textarea rows={5} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Escribe el texto que recibirá el flujo…" /></label><label>Proyecto para leer / escribir<select value={projectForRun} onChange={(e) => setProjectForRun(e.target.value)}><option value="">Sin proyecto seleccionado</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label><button className="button button-primary run-flow-button" onClick={() => void execute()} disabled={busy}><CirclePlay size={16} />{busy ? 'Ejecutando…' : 'Ejecutar flujo'}</button><div className="run-safety-footnote"><ShieldIcon />Cada ejecución se registra en la base de datos. Las llamadas a IA/HTTP requieren confirmación.</div>
        {run && <div className="run-result"><div className="run-result-head"><span className="run-success-dot" /><b>Resultado</b><small>{run.elapsedMs} ms</small></div><pre>{String(run.output?.text || '(sin salida)')}</pre><div className="run-log-list">{run.logs?.map((log: any, i: number) => <div key={`${log.nodeId}-${i}`} className={`run-log run-log-${log.status}`}><i />{log.nodeName}: {log.message}</div>)}</div></div>}
        {runHistory.length > 0 && <div className="run-history"><h4>Últimas ejecuciones</h4>{runHistory.slice(0, 5).map((item, index) => <div key={item.id || index}><span className={item.status === 'complete' ? 'history-success-dot' : 'history-error-dot'} />{item.status || 'complete'}<small>{item.finishedAt ? new Date(item.finishedAt).toLocaleTimeString() : 'ahora'}</small></div>)}</div>}
      </aside></div>
    </>}
    {showNodePicker && <Modal title="Añadir un nodo" description="Selecciona un bloque para insertar en la ruta del flujo." onClose={() => setShowNodePicker(false)}><div className="node-picker-list">{catalog.filter((item) => item.type !== 'start' && item.type !== 'input').map((item) => { const Icon = typeIcon[item.type] || WorkflowIcon; return <button key={item.type} onClick={() => addNode(item.type)}><span><Icon size={16} /></span><div><b>{item.label}</b><small>{item.description}</small></div><Plus size={14} /></button>; })}</div></Modal>}
    {nodeToDelete && <Modal title="Quitar nodo" description="El nodo se eliminará y los nodos restantes se conectarán de forma lineal." onClose={() => setNodeToDelete(null)}><div className="modal-actions"><button className="button button-quiet" onClick={() => setNodeToDelete(null)}>Cancelar</button><button className="button button-danger" onClick={() => deleteNode(nodeToDelete)}><Trash2 size={14} />Quitar nodo</button></div></Modal>}
  </div>;
}
function ShieldIcon() { return <span className="mini-shield">⌑</span>; }
