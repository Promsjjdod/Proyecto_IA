import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Activity, ArrowDown, ArrowDownToLine, Bot, Check, CirclePlay, FileText, GitBranch, Globe2, Grip, Layers3, ListChecks, Minus, Plus, Save, Settings2, Sparkles, Trash2, Workflow as WorkflowIcon, ZoomIn, ZoomOut } from 'lucide-react';
import type { Agent, FlowEdge, FlowNode, Model, Provider, Workflow } from '../types';

const NODE_WIDTH = 242;
const NODE_HEIGHT = 84;
const CONDITION_HEIGHT = 100;
const DEFAULT_ZOOM = 0.9;
const modeOptions = ['LOW', 'MEDIO', 'HIGH', 'MAX'];
const iconByType: Record<string, typeof WorkflowIcon> = {
  start: CirclePlay, input: ArrowDown, text: Layers3, ai: Sparkles, agent: Bot,
  read_file: ListChecks, write_file: Save, transform: Settings2, condition: GitBranch,
  http: Globe2, output: ArrowDownToLine, end: Check,
};
const labelByType: Record<string, string> = {
  start: 'Inicio manual', input: 'Entrada', text: 'Texto', ai: 'Nodo de IA', agent: 'Habilidades',
  read_file: 'Leer archivo', write_file: 'Escribir archivo', transform: 'Transformar',
  condition: 'Condición', http: 'Petición HTTP', output: 'Salida', end: 'Finalizar',
};

type Position = { x: number; y: number };
type Gesture =
  | { type: 'node'; id: string; startX: number; startY: number; origin: Position }
  | { type: 'pan'; startX: number; startY: number; scrollLeft: number; scrollTop: number }
  | { type: 'connect'; sourceId: string; sourceHandle?: string };

type Props = {
  workflow: Workflow;
  providers: Provider[];
  modelsByProvider: Record<string, Model[]>;
  agents: Agent[];
  onMoveNode: (id: string, position: Position) => void;
  onPatchNode: (id: string, patch: Partial<FlowNode> & { config?: Record<string, unknown> }) => void;
  onConnect: (targetId: string, sourceId: string, sourceHandle?: string) => void;
  onDisconnect: (targetId: string) => void;
  onDeleteNode: (id: string) => void;
  onAddNode: () => void;
};

function getPosition(node: FlowNode): Position { return node.position || { x: 90, y: 100 }; }
function outputPoint(node: FlowNode, handle?: string): Position {
  const position = getPosition(node);
  return { x: position.x + NODE_WIDTH, y: position.y + (node.type === 'condition' ? (handle === 'false' ? 69 : 38) : NODE_HEIGHT / 2) };
}
function inputPoint(node: FlowNode): Position {
  const position = getPosition(node);
  return { x: position.x, y: position.y + NODE_HEIGHT / 2 };
}
function tokenLabel(value?: number | null) {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value).toLocaleString() : 'sin dato';
}

export function WorkflowCanvas({ workflow, providers, modelsByProvider, agents, onMoveNode, onPatchNode, onConnect, onDisconnect, onDeleteNode, onAddNode }: Props) {
  const [selectedId, setSelectedId] = useState(workflow.nodes[0]?.id || '');
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [connectionEnd, setConnectionEnd] = useState<Position | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const selected = workflow.nodes.find((node) => node.id === selectedId) || workflow.nodes[0];
  const selectedProvider = providers.find((provider) => provider.id === selected?.config?.providerId);
  const selectedModel = (modelsByProvider[selected?.config?.providerId] || []).find((model) => model.id === selected?.config?.modelId);
  const selectedIncoming = workflow.edges.find((edge) => edge.target === selected?.id);
  const selectedIncomingSource = workflow.nodes.find((node) => node.id === selectedIncoming?.source);

  useEffect(() => {
    if (!workflow.nodes.some((node) => node.id === selectedId)) setSelectedId(workflow.nodes[0]?.id || '');
  }, [workflow.nodes, selectedId]);

  const bounds = useMemo(() => {
    const maxX = Math.max(0, ...workflow.nodes.map((node) => getPosition(node).x + NODE_WIDTH));
    const maxY = Math.max(0, ...workflow.nodes.map((node) => getPosition(node).y + (node.type === 'condition' ? CONDITION_HEIGHT : NODE_HEIGHT)));
    return { width: Math.max(1320, maxX + 180), height: Math.max(680, maxY + 180) };
  }, [workflow.nodes]);

  const canvasPoint = (clientX: number, clientY: number): Position => {
    const rect = worldRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom };
  };
  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const nodeElement = (event.target as HTMLElement).closest('.workflow-node-card');
    if (nodeElement) return;
    event.preventDefault();
    const viewport = viewportRef.current;
    if (!viewport) return;
    gesture.current = { type: 'pan', startX: event.clientX, startY: event.clientY, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop };
    viewport.setPointerCapture(event.pointerId);
  };
  const startNodeMove = (event: ReactPointerEvent<HTMLElement>, node: FlowNode) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    event.preventDefault(); event.stopPropagation(); setSelectedId(node.id);
    gesture.current = { type: 'node', id: node.id, startX: event.clientX, startY: event.clientY, origin: getPosition(node) };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const startConnection = (event: ReactPointerEvent<HTMLButtonElement>, nodeId: string, sourceHandle?: string) => {
    event.preventDefault(); event.stopPropagation(); setSelectedId(nodeId);
    gesture.current = { type: 'connect', sourceId: nodeId, sourceHandle };
    setConnectionEnd(canvasPoint(event.clientX, event.clientY));
    viewportRef.current?.setPointerCapture(event.pointerId);
  };
  const moveGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current) return;
    if (current.type === 'node') {
      onMoveNode(current.id, {
        x: Math.max(24, Math.round(current.origin.x + (event.clientX - current.startX) / zoom)),
        y: Math.max(24, Math.round(current.origin.y + (event.clientY - current.startY) / zoom)),
      });
    } else if (current.type === 'pan') {
      const viewport = viewportRef.current;
      if (viewport) {
        viewport.scrollLeft = current.scrollLeft - (event.clientX - current.startX);
        viewport.scrollTop = current.scrollTop - (event.clientY - current.startY);
      }
    } else setConnectionEnd(canvasPoint(event.clientX, event.clientY));
  };
  const stopGesture = () => { gesture.current = null; setConnectionEnd(null); };
  const finishCanvasGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (current?.type === 'connect') {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-flow-node-target]');
      const targetId = target?.dataset.flowNodeTarget;
      if (targetId && targetId !== current.sourceId) onConnect(targetId, current.sourceId, current.sourceHandle);
    }
    stopGesture();
  };
  const patchConfig = (patch: Record<string, unknown>) => {
    if (selected) onPatchNode(selected.id, { config: patch });
  };
  const zoomBy = (delta: number) => setZoom((value) => Math.max(0.5, Math.min(1.5, Math.round((value + delta) * 100) / 100)));
  const fitCanvas = () => {
    const viewport = viewportRef.current;
    if (!viewport || !workflow.nodes.length) return;
    const boundsByNode = workflow.nodes.map((node) => ({ position: getPosition(node), height: node.type === 'condition' ? CONDITION_HEIGHT : NODE_HEIGHT }));
    const minX = Math.min(...boundsByNode.map((item) => item.position.x));
    const minY = Math.min(...boundsByNode.map((item) => item.position.y));
    const maxX = Math.max(...boundsByNode.map((item) => item.position.x + NODE_WIDTH));
    const maxY = Math.max(...boundsByNode.map((item) => item.position.y + item.height));
    const nextZoom = Math.max(0.5, Math.min(1.5, Math.min((viewport.clientWidth - 50) / (maxX - minX + 100), (viewport.clientHeight - 50) / (maxY - minY + 100))));
    setZoom(nextZoom);
    requestAnimationFrame(() => { viewport.scrollLeft = Math.max(0, minX * nextZoom - 35); viewport.scrollTop = Math.max(0, minY * nextZoom - 35); });
  };
  const selectedPosition = selected ? getPosition(selected) : { x: 0, y: 0 };
  const liveConnection = connectionEnd && gesture.current?.type === 'connect' ? {
    sourceId: gesture.current.sourceId,
    handle: gesture.current.sourceHandle,
    end: connectionEnd,
  } : null;

  return <>
    <div className="flow-canvas-tools">
      <div className="flow-canvas-hint"><Grip size={14} /><span>Arrastra nodos o el fondo · conecta los puertos · usa el zoom para navegar</span></div>
      <div className="flow-zoom-controls" aria-label="Controles del lienzo">
        <button className="icon-button" title="Alejar" aria-label="Alejar lienzo" onClick={() => zoomBy(-0.1)} disabled={zoom <= 0.5}><ZoomOut size={14} /></button>
        <span>{Math.round(zoom * 100)}%</span>
        <button className="icon-button" title="Acercar" aria-label="Acercar lienzo" onClick={() => zoomBy(0.1)} disabled={zoom >= 1.5}><ZoomIn size={14} /></button>
        <button className="button button-quiet button-sm" onClick={fitCanvas}>Ajustar</button>
        <button className="button button-secondary button-sm" onClick={onAddNode}><Plus size={13} />Añadir nodo</button>
      </div>
    </div>
    <div ref={viewportRef} className="flow-canvas-viewport" onPointerDown={handlePointerDown} onPointerMove={moveGesture} onPointerUp={finishCanvasGesture} onPointerCancel={stopGesture}>
      <div className="flow-canvas-scaled-space" style={{ width: bounds.width * zoom, height: bounds.height * zoom }}>
        <div ref={worldRef} className="flow-canvas-world" style={{ width: bounds.width, height: bounds.height, transform: `scale(${zoom})` }}>
          <svg className="flow-edges-svg" width={bounds.width} height={bounds.height} aria-hidden="true">
            <defs><marker id="flow-edge-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M1 1 L6 4 L1 7" fill="none" stroke="#91a8bb" strokeWidth="1.4" /></marker></defs>
            {workflow.edges.map((edge, index) => {
              const source = workflow.nodes.find((node) => node.id === edge.source);
              const target = workflow.nodes.find((node) => node.id === edge.target);
              if (!source || !target) return null;
              const start = outputPoint(source, edge.sourceHandle);
              const end = inputPoint(target);
              const curve = Math.max(50, Math.abs(end.x - start.x) * 0.45);
              return <g key={`${edge.source}-${edge.sourceHandle || 'main'}-${edge.target}-${index}`}>
                <path className={`flow-edge-path ${source.type === 'condition' ? `edge-${edge.sourceHandle || 'true'}` : ''}`} d={`M ${start.x} ${start.y} C ${start.x + curve} ${start.y}, ${end.x - curve} ${end.y}, ${end.x} ${end.y}`} />
                {source.type === 'condition' && <text className={`flow-edge-label edge-label-${edge.sourceHandle || 'true'}`} x={start.x + 12} y={start.y - 7}>{edge.sourceHandle === 'false' ? 'FALSA' : 'VERDADERA'}</text>}
              </g>;
            })}
            {liveConnection && (() => {
              const source = workflow.nodes.find((node) => node.id === liveConnection.sourceId);
              if (!source) return null;
              const start = outputPoint(source, liveConnection.handle);
              const curve = Math.max(50, Math.abs(liveConnection.end.x - start.x) * 0.45);
              return <path className="flow-edge-path flow-edge-draft" d={`M ${start.x} ${start.y} C ${start.x + curve} ${start.y}, ${liveConnection.end.x - curve} ${liveConnection.end.y}, ${liveConnection.end.x} ${liveConnection.end.y}`} />;
            })()}
          </svg>
          {workflow.nodes.map((node, index) => {
            const Icon = iconByType[node.type] || WorkflowIcon;
            const position = getPosition(node);
            const hasInput = !['start'].includes(node.type);
            const hasOutput = !['output', 'end'].includes(node.type);
            const model = (modelsByProvider[node.config?.providerId] || []).find((item) => item.id === node.config?.modelId);
            return <div key={node.id} className="flow-node-position" style={{ left: position.x, top: position.y, width: NODE_WIDTH, minHeight: node.type === 'condition' ? CONDITION_HEIGHT : NODE_HEIGHT }}>
              {hasInput && <button className="flow-port flow-port-input" data-flow-node-target={node.id} title="Puerto de entrada: suelta aquí una conexión" aria-label={`Entrada de ${node.name || labelByType[node.type]}`} />}
              <article className={`workflow-node-card node-${node.type} ${selected?.id === node.id ? 'workflow-node-selected' : ''}`} onPointerDown={(event) => startNodeMove(event, node)} onClick={() => setSelectedId(node.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setSelectedId(node.id); }} tabIndex={0} role="button" aria-pressed={selected?.id === node.id} aria-label={`Seleccionar nodo ${node.name || labelByType[node.type]}`}>
                <div className="workflow-node-head"><span className="flow-node-icon"><Icon size={15} /></span><div className="workflow-node-label"><b>{node.name || labelByType[node.type] || node.type}</b><small>{labelByType[node.type] || node.type} · {model ? model.status === 'unavailable' ? 'Modelo no disponible' : model.displayName : node.type === 'ai' ? 'Modelo sin configurar' : 'Seleccionar para configurar'}</small></div><span className="flow-node-number">{String(index + 1).padStart(2, '0')}</span></div>
                {node.type === 'condition' && <div className="workflow-node-branches"><span>Salida verdadera</span><span>Salida falsa</span></div>}
                {hasOutput && node.type !== 'condition' && <span className="workflow-node-port-caption">Salida</span>}
              </article>
              {hasOutput && node.type !== 'condition' && <button className="flow-port flow-port-output" title="Arrastra para conectar con otro nodo" aria-label={`Salida de ${node.name || labelByType[node.type]}`} onPointerDown={(event) => startConnection(event, node.id)} />}
              {node.type === 'condition' && <>
                <button className="flow-port flow-port-output flow-port-output-true" title="Arrastra la rama verdadera a un nodo" aria-label="Puerto de salida verdadera" onPointerDown={(event) => startConnection(event, node.id, 'true')} />
                <button className="flow-port flow-port-output flow-port-output-false" title="Arrastra la rama falsa a un nodo" aria-label="Puerto de salida falsa" onPointerDown={(event) => startConnection(event, node.id, 'false')} />
              </>}
            </div>;
          })}
        </div>
      </div>
    </div>
    <section className="flow-node-inspector" aria-label="Propiedades del nodo seleccionado">
      {selected ? <>
        <div className="flow-inspector-head"><div><span className="section-kicker">PROPIEDADES DEL NODO</span><h3>{labelByType[selected.type] || selected.type}</h3></div>{!['start', 'input', 'output', 'end'].includes(selected.type) && <button className="icon-button danger-icon" title="Quitar nodo seleccionado" aria-label="Quitar nodo seleccionado" onClick={() => onDeleteNode(selected.id)}><Trash2 size={15} /></button>}</div>
        <div className="flow-node-config">
          <label>Nombre del nodo<input value={selected.name || ''} maxLength={100} onChange={(event) => onPatchNode(selected.id, { name: event.target.value })} /></label>
          {selectedIncoming && <div className="flow-connected-summary"><span>Conectado desde: {selectedIncomingSource?.name || labelByType[selectedIncomingSource?.type || ''] || 'nodo'}{selectedIncomingSource?.type === 'condition' ? ` · rama ${selectedIncoming.sourceHandle === 'false' ? 'falsa' : 'verdadera'}` : ''}</span><button className="button button-quiet button-sm" onClick={() => onDisconnect(selected.id)}>Desconectar</button></div>}
          {selected.type !== 'condition' && workflow.nodes.some((node) => node.type === 'condition') && <label className="flow-condition-run">Ejecución de este nodo<select value={selected.config.when || 'always'} onChange={(event) => patchConfig({ when: event.target.value })}><option value="always">Siempre (según conexiones)</option><option value="true">Solo si la última condición es verdadera</option><option value="false">Solo si la última condición es falsa</option></select></label>}
          {selected.type === 'text' && <label>Texto / plantilla<textarea rows={3} value={selected.config.text || ''} onChange={(event) => patchConfig({ text: event.target.value })} placeholder="Usa {{input}} o {{result}}" /></label>}
          {selected.type === 'ai' && <>
            <div className="two-field-row"><label>Proveedor<select value={selected.config.providerId || ''} onChange={(event) => onPatchNode(selected.id, { config: { providerId: event.target.value, modelId: '' } })}><option value="">Seleccionar proveedor</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
              <label>Modelo<select value={selected.config.modelId || ''} onChange={(event) => patchConfig({ modelId: event.target.value })}><option value="">Seleccionar modelo</option>{(modelsByProvider[selected.config.providerId] || []).map((model) => <option key={model.id} value={model.id} disabled={model.status === 'unavailable'}>{model.displayName}{model.status === 'unavailable' ? ' · NO DISPONIBLE' : model.status !== 'available' ? ' · sin comprobar' : ''}</option>)}</select></label></div>
            {selectedModel && <div className={`flow-model-limits ${selectedModel.status === 'unavailable' ? 'flow-model-unavailable' : ''}`}><Activity size={13} /><span>{selectedProvider?.name} · Contexto {tokenLabel(selectedModel.contextTokens)} · Entrada {tokenLabel(selectedModel.maxInputTokens)} · Salida máx. {tokenLabel(selectedModel.maxOutputTokens)} · {selectedModel.status === 'unavailable' ? 'No disponible' : selectedModel.status === 'available' ? 'Disponible' : 'Estado sin comprobar'}</span></div>}
            <div className="two-field-row"><label>Modo de trabajo<select value={selected.config.mode || 'MEDIO'} onChange={(event) => patchConfig({ mode: event.target.value })}>{modeOptions.map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select></label><label>Instrucción<input value={selected.config.prompt || '{{result}}'} onChange={(event) => patchConfig({ prompt: event.target.value })} placeholder="{{result}}" /></label></div>
          </>}
          {selected.type === 'agent' && <label>Habilidad<select value={selected.config.agentId || ''} onChange={(event) => patchConfig({ agentId: event.target.value })}><option value="">Seleccionar habilidad</option>{agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name}</option>)}</select></label>}
          {(selected.type === 'read_file' || selected.type === 'write_file') && <div className="two-field-row"><label>Ruta dentro del proyecto<input value={selected.config.path || ''} onChange={(event) => patchConfig({ path: event.target.value })} placeholder="src/result.txt" /></label>{selected.type === 'write_file' && <label>Contenido<textarea rows={3} value={selected.config.content || '{{result}}'} onChange={(event) => patchConfig({ content: event.target.value })} /></label>}</div>}
          {selected.type === 'transform' && <div className="two-field-row"><label>Operación<select value={selected.config.operation || 'trim'} onChange={(event) => patchConfig({ operation: event.target.value })}><option value="trim">Quitar espacios</option><option value="uppercase">Mayúsculas</option><option value="lowercase">Minúsculas</option><option value="prepend">Añadir prefijo</option><option value="append">Añadir sufijo</option></select></label>{['prepend', 'append'].includes(selected.config.operation) && <label>Texto<input value={selected.config.text || ''} onChange={(event) => patchConfig({ text: event.target.value })} /></label>}</div>}
          {selected.type === 'condition' && <><label>Ramas conectables por separado<select value="true" disabled><option value="true">Verdadera y falsa (puertos del nodo)</option></select></label><label>Se cumple si la salida contiene<input value={selected.config.contains || ''} onChange={(event) => patchConfig({ contains: event.target.value })} placeholder="texto a buscar" /></label><small className="field-help">Conecta cada salida a un nodo distinto arrastrando el puerto etiquetado. La validación del servidor impide los ciclos.</small></>}
          {selected.type === 'http' && <><div className="two-field-row"><label>Método<select value={selected.config.method || 'GET'} onChange={(event) => patchConfig({ method: event.target.value })}><option>GET</option><option>POST</option></select></label><label>URL HTTPS allowlisted<input value={selected.config.url || ''} onChange={(event) => patchConfig({ url: event.target.value })} placeholder="https://api.example.com" /></label></div>{selected.config.method === 'POST' && <label>Cuerpo de la petición<textarea rows={3} value={selected.config.body || '{{input}}'} onChange={(event) => patchConfig({ body: event.target.value })} /></label>}<small className="field-help">Solo HTTPS y destinos autorizados por la allowlist del servidor; se confirma antes de ejecutar.</small></>}
          {['start', 'input', 'output', 'end'].includes(selected.type) && <div className="flow-inspector-note">{selected.type === 'start' ? 'Punto de inicio manual del flujo.' : selected.type === 'input' ? 'Recibe el texto de entrada que proporcionas al ejecutar.' : selected.type === 'output' ? 'Entrega la salida actual al panel de ejecución.' : 'Marca el final de esta ruta.'}</div>}
          <div className="flow-position-note">Posición en el lienzo: {Math.round(selectedPosition.x)}, {Math.round(selectedPosition.y)} px</div>
        </div>
      </> : <div className="flow-inspector-empty"><WorkflowIcon size={20} /><span>Selecciona un nodo para ver y modificar sus propiedades.</span></div>}
    </section>
  </>;
}
