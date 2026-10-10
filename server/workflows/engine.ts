import { db } from '../db.js';
import { completeText } from '../providers/index.js';
import { safeExternalFetch } from '../providers/safety.js';
import type { ProviderRecord, CanonicalMessage } from '../providers/types.js';
import { estimateTextUnits, reserveUsage, releaseUsage, settleUsage } from '../usage.js';
import type { AuthUser } from '../auth.js';
import { ownedProject, readProjectFile, writeProjectFile } from '../workspaces/paths.js';
import { budgetForMode, MODE_POLICIES, type UsageMode } from '../config.js';

export type FlowNode = { id: string; type: string; name?: string; config?: Record<string, unknown> };
export type FlowEdge = { source: string; target: string; sourceHandle?: string };
export const NODE_TYPES = new Set(['start', 'input', 'text', 'ai', 'agent', 'read_file', 'write_file', 'http', 'condition', 'transform', 'output', 'end']);
const running = new Map<string, number>();
const MAX_NODES = 40;
const MAX_EDGE_COUNT = 80;

function json<T>(source: string, fallback: T): T { try { return JSON.parse(source) as T; } catch { return fallback; } }
function validateGraph(nodes: FlowNode[], edges: FlowEdge[]) {
  if (!Array.isArray(nodes) || nodes.length < 1 || nodes.length > MAX_NODES) throw new Error(`El flujo debe tener entre 1 y ${MAX_NODES} nodos.`);
  if (!Array.isArray(edges) || edges.length > MAX_EDGE_COUNT) throw new Error(`El flujo admite hasta ${MAX_EDGE_COUNT} conexiones.`);
  const nodeMap = new Map<string, FlowNode>();
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(node.id) || nodeMap.has(node.id)) throw new Error('El flujo contiene un identificador de nodo inválido o repetido.');
    if (!NODE_TYPES.has(node.type)) throw new Error(`Tipo de nodo no reconocido: ${node.type}`);
    nodeMap.set(node.id, node);
  }
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target) || edge.source === edge.target) throw new Error('Una conexión apunta a un nodo no válido.');
    outgoing.set(edge.source, [...(outgoing.get(edge.source) || []), edge.target]);
    incoming.set(edge.target, [...(incoming.get(edge.target) || []), edge.source]);
  }
  const degree = new Map(nodes.map((node) => [node.id, incoming.get(node.id)?.length || 0]));
  const queue = nodes.filter((node) => degree.get(node.id) === 0).map((node) => node.id);
  const order: string[] = [];
  while (queue.length) {
    const current = queue.shift()!;
    order.push(current);
    for (const target of outgoing.get(current) || []) {
      const nextDegree = (degree.get(target) || 1) - 1;
      degree.set(target, nextDegree);
      if (nextDegree === 0) queue.push(target);
    }
  }
  if (order.length !== nodes.length) throw new Error('El flujo contiene un ciclo. Los nodos de repetición con límites aún no están disponibles.');
  return { nodeMap, order, incoming };
}
function templated(value: unknown, context: { input: string; result: string; vars: Record<string, unknown> }) {
  return String(value ?? '').replace(/\{\{\s*(input|result|[a-zA-Z0-9_-]{1,64})\s*\}\}/g, (_match, key: string) => {
    if (key === 'input') return context.input;
    if (key === 'result') return context.result;
    const item = context.vars[key];
    return typeof item === 'string' ? item : JSON.stringify(item ?? '');
  });
}
function providerFor(userId: string, providerId: unknown, modelId: unknown): { provider: ProviderRecord; modelId: string; contextTokens: number | null } {
  const id = String(providerId || ''); const model = String(modelId || '');
  if (!id || !model) throw new Error('El nodo IA necesita un proveedor y un modelo.');
  const provider = db.prepare('SELECT * FROM providers WHERE id=? AND user_id=?').get(id, userId) as ProviderRecord | undefined;
  const modelRow = db.prepare('SELECT status,context_tokens FROM provider_models WHERE provider_id=? AND model_id=?').get(id, model) as { status: string; context_tokens: number | null } | undefined;
  if (!provider || !modelRow) throw new Error('El proveedor o modelo del nodo IA no está conectado a esta cuenta.');
  if (modelRow.status === 'unavailable') throw new Error(`El modelo ${model} aparece como no disponible.`);
  return { provider, modelId: model, contextTokens: modelRow.context_tokens };
}
async function safeHttpRequest(config: Record<string, unknown>, input: string, signal: AbortSignal) {
  const method = String(config.method || 'GET').toUpperCase();
  if (!['GET', 'POST'].includes(method)) throw new Error('El nodo HTTP admite solo GET y POST.');
  const url = new URL(templated(config.url, { input, result: input, vars: {} }));
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('El nodo HTTP requiere HTTPS público y no permite credenciales en la URL.');
  const allowedHosts = (process.env.WORKFLOW_HTTP_ALLOWED_HOSTS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!allowedHosts.includes(url.hostname.toLowerCase())) throw new Error(`El host ${url.hostname} no está en WORKFLOW_HTTP_ALLOWED_HOSTS.`);
  const body = method === 'POST' ? templated(config.body || '{{input}}', { input, result: input, vars: {} }) : undefined;
  const response = await safeExternalFetch(url, { method, signal, ...(body === undefined ? {} : { headers: { 'Content-Type': String(config.contentType || 'text/plain; charset=utf-8') }, body }) }, 12_000);
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > 500_000) throw new Error('La respuesta HTTP supera 500 KB.');
  if (!response.ok) throw new Error(`El endpoint HTTP respondió ${response.status}.`);
  return text;
}

export async function executeWorkflow(user: AuthUser, workflow: { id: string; user_id: string; nodes_json: string; edges_json: string }, inputText: string, projectId?: string | null) {
  const active = running.get(user.id) || 0;
  if (active >= 2) throw Object.assign(new Error('Ya hay dos automatizaciones ejecutándose para este usuario.'), { status: 429 });
  if (inputText.length > 24_000) throw Object.assign(new Error('La entrada del flujo no puede superar 24 000 caracteres.'), { status: 400 });
  const nodes = json<FlowNode[]>(workflow.nodes_json, []);
  const edges = json<FlowEdge[]>(workflow.edges_json, []);
  const { nodeMap, order, incoming } = validateGraph(nodes, edges);
  const flowInputs = { input: inputText, result: inputText, vars: {} as Record<string, unknown>, branch: {} as Record<string, boolean> };
  const aiNodeSettings = new Map<string, { selected: ReturnType<typeof providerFor>; mode: UsageMode; budget: ReturnType<typeof budgetForMode> }>();
  for (const node of nodes.filter((item) => item.type === 'ai')) {
    const nodeMode = String(node.config?.mode || 'MEDIO').toUpperCase() as UsageMode;
    if (!(nodeMode in MODE_POLICIES)) throw Object.assign(new Error('Modo del flujo no válido.'), { status: 400 });
    const selected = providerFor(user.id, node.config?.providerId, node.config?.modelId);
    const budget = budgetForMode(nodeMode, selected.contextTokens);
    if (budget.outputTokens < 1 || budget.inputContextTokens < 128) throw Object.assign(new Error(`El contexto configurado para ${selected.modelId} es demasiado pequeño para el modo ${nodeMode}.`), { status: 400 });
    aiNodeSettings.set(node.id, { selected, mode: nodeMode, budget });
  }
  const mode = aiNodeSettings.values().next().value?.mode || 'MEDIO';
  const outputBudget = [...aiNodeSettings.values()].reduce((total, settings) => total + settings.budget.outputTokens, 0);
  const inputBudget = estimateTextUnits(inputText) * Math.max(1, aiNodeSettings.size);
  const runId = crypto.randomUUID();
  const reservation = reserveUsage(user, `workflow:${runId}`, 'workflow', inputBudget, Math.max(512, outputBudget), { workflowId: workflow.id });
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO workflow_runs(id,workflow_id,user_id,status,input_json,started_at) VALUES(?,?,?,'running',?,?)`)
    .run(runId, workflow.id, user.id, JSON.stringify({ input: inputText.slice(0, 3000), projectId: projectId || null }), now);
  running.set(user.id, active + 1);
  const logs: { at: string; nodeId: string; nodeName: string; status: 'success' | 'skipped' | 'error'; message: string }[] = [];
  const completed = new Set<string>();
  let systemPrompt = '';
  let lastCondition: boolean | null = null;
  let totalText = inputText;
  const startedAt = Date.now();
  const controller = new AbortController();
  const executionTimer = setTimeout(() => controller.abort(new Error('La automatización superó el límite de ejecución de 5 minutos.')), 300_000);
  executionTimer.unref();
  try {
    if (projectId) ownedProject(user.id, projectId);
    for (const id of order) {
      const node = nodeMap.get(id)!;
      const cfg = node.config || {};
      const predecessors = incoming.get(id) || [];
      const relevantEdges = edges.filter((edge) => edge.target === id);
      const shouldRun = predecessors.every((source) => completed.has(source)) && relevantEdges.every((edge) => {
        const source = nodeMap.get(edge.source)!;
        if (source.type !== 'condition' || !edge.sourceHandle) return true;
        return Boolean(flowInputs.branch[source.id]) === (edge.sourceHandle === 'true');
      });
      const when = String(cfg.when || 'always');
      const conditionMatch = when === 'always' || lastCondition === (when === 'true');
      if (!shouldRun || !conditionMatch) {
        logs.push({ at: new Date().toISOString(), nodeId: id, nodeName: node.name || node.type, status: 'skipped', message: !conditionMatch ? `No se ejecutó: la última condición fue ${lastCondition ? 'verdadera' : 'falsa'}.` : 'Rama condicional no seleccionada.' });
        completed.add(id);
        continue;
      }
      try {
        switch (node.type) {
          case 'start': case 'input': case 'end': case 'output':
            break;
          case 'text':
            flowInputs.result = templated(cfg.text || cfg.value || '', flowInputs);
            break;
          case 'transform': {
            const value = flowInputs.result;
            const operation = String(cfg.operation || 'trim');
            if (operation === 'uppercase') flowInputs.result = value.toUpperCase();
            else if (operation === 'lowercase') flowInputs.result = value.toLowerCase();
            else if (operation === 'trim') flowInputs.result = value.trim();
            else if (operation === 'prepend') flowInputs.result = `${templated(cfg.text, flowInputs)}${value}`;
            else if (operation === 'append') flowInputs.result = `${value}${templated(cfg.text, flowInputs)}`;
            else throw new Error('Transformación no reconocida.');
            break;
          }
          case 'condition': {
            const needle = templated(cfg.contains || '', flowInputs);
            flowInputs.branch[node.id] = String(flowInputs.result).includes(needle);
            lastCondition = flowInputs.branch[node.id];
            flowInputs.vars[node.id] = flowInputs.branch[node.id];
            break;
          }
          case 'agent': {
            const agentId = String(cfg.agentId || '');
            const agent = db.prepare('SELECT * FROM agents WHERE id=? AND user_id=?').get(agentId, user.id) as any;
            if (!agent) throw new Error('Agente seleccionado no encontrado.');
            systemPrompt = agent.instructions;
            break;
          }
          case 'read_file': {
            if (!projectId) throw new Error('Selecciona un proyecto para permitir acceso a archivos.');
            const file = readProjectFile(user.id, projectId, templated(cfg.path, flowInputs));
            flowInputs.result = file.content;
            break;
          }
          case 'write_file': {
            if (!projectId) throw new Error('Selecciona un proyecto para permitir escritura de archivos.');
            const result = writeProjectFile(user.id, projectId, templated(cfg.path, flowInputs), templated(cfg.content || '{{result}}', flowInputs));
            flowInputs.result = `Archivo guardado: ${result.path} (${result.bytes} bytes).`;
            break;
          }
          case 'ai': {
            const settings = aiNodeSettings.get(node.id);
            if (!settings) throw new Error('No se pudieron validar los parámetros del nodo IA.');
            const { selected, mode: nodeMode, budget: nodeBudget } = settings;
            const prompt = templated(cfg.prompt || '{{result}}', flowInputs);
            if (estimateTextUnits(prompt) + estimateTextUnits(systemPrompt) > nodeBudget.inputContextTokens) throw new Error(`El nodo IA superó el contexto de entrada disponible (${nodeBudget.inputContextTokens} tokens estimados).`);
            const messages: CanonicalMessage[] = [
              ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
              { role: 'user', content: prompt },
            ];
            const result = await completeText(selected.provider, selected.modelId, messages, nodeMode, controller.signal, nodeBudget.outputTokens);
            flowInputs.result = result.text;
            totalText += result.text;
            break;
          }
          case 'http':
            flowInputs.result = await safeHttpRequest(cfg, flowInputs.result, controller.signal);
            break;
          default: throw new Error(`Nodo ${node.type} no implementado.`);
        }
        completed.add(id);
        flowInputs.vars[id] = flowInputs.result;
        totalText += String(flowInputs.result).slice(0, 4000);
        logs.push({ at: new Date().toISOString(), nodeId: id, nodeName: node.name || node.type, status: 'success', message: `Nodo completado. Salida actual: ${String(flowInputs.result).slice(0, 160)}` });
      } catch (error) {
        logs.push({ at: new Date().toISOString(), nodeId: id, nodeName: node.name || node.type, status: 'error', message: error instanceof Error ? error.message : 'El nodo falló.' });
        throw error;
      }
    }
    const elapsed = Date.now() - startedAt;
    const output = { text: String(flowInputs.result), variables: flowInputs.vars };
    const estimatedCredits = estimateTextUnits(inputText) + estimateTextUnits(totalText);
    settleUsage(user.id, reservation, estimatedCredits, { workflowId: workflow.id, estimated: true });
    db.prepare(`UPDATE workflow_runs SET status='complete',output_json=?,logs_json=?,finished_at=? WHERE id=?`)
      .run(JSON.stringify(output), JSON.stringify(logs), new Date().toISOString(), runId);
    return { id: runId, status: 'complete', output, logs, elapsedMs: elapsed, estimatedCredits };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error de ejecución desconocido.';
    releaseUsage(user.id, reservation, 'failed', { workflowId: workflow.id, error: message });
    db.prepare(`UPDATE workflow_runs SET status='failed',error=?,logs_json=?,finished_at=? WHERE id=?`)
      .run(message.slice(0, 500), JSON.stringify(logs), new Date().toISOString(), runId);
    throw error;
  } finally {
    clearTimeout(executionTimer);
    running.set(user.id, Math.max(0, (running.get(user.id) || 1) - 1));
  }
}

export function validateWorkflow(nodes: FlowNode[], edges: FlowEdge[]) { return validateGraph(nodes, edges); }
