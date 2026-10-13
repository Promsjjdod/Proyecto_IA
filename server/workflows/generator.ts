import { db } from '../db.js';
import { budgetForMode, MODE_POLICIES, normalizeUsageMode, outputLimitForRequest, TASK_TOKEN_BUDGET } from '../config.js';
import type { AuthUser } from '../auth.js';
import { completeText } from '../providers/index.js';
import type { CanonicalMessage, ProviderRecord } from '../providers/types.js';
import { decryptSecret } from '../security.js';
import { estimateTextUnits, releaseUsage, reserveUsage, settleUsage } from '../usage.js';
import { cleanRelativePath, validateFileName } from '../workspaces/paths.js';
import { NODE_TYPES, validateWorkflow, type FlowEdge, type FlowNode } from './engine.js';
import { appendContinuation, buildContinuationMessages } from '../continuation.js';

const AVAILABLE_MODEL_STATUSES = new Set(['available', 'ready']);
const USAGE_MODE = 'HIGH';
const MAX_REQUEST_CHARS = 5_000;
const MAX_PLAN_JSON_BYTES = TASK_TOKEN_BUDGET * 4;
const runningGeneration = new Set<string>();

export type WorkflowGeneratorModelOption = { id: string; displayName: string; favorite: boolean };
export type WorkflowGeneratorProviderOption = {
  id: string;
  name: string;
  type: string;
  status: string;
  ready: boolean;
  reason: string;
  models: WorkflowGeneratorModelOption[];
};
export type WorkflowGeneratorOptions = {
  configuredProviderCount: number;
  secondProvider: (WorkflowGeneratorProviderOption & { modelId: string | null; modelName: string | null }) | null;
  secondProviderReason: string;
  providers: WorkflowGeneratorProviderOption[];
};
type SelectedGenerator = {
  provider: ProviderRecord;
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  contextTokens: number | null;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
};

function fail(message: string, status: number, code?: string) {
  return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

function providerConfigProblem(provider: ProviderRecord & { status: string }) {
  if (provider.status !== 'connected') return 'El proveedor no figura como conectado. Probalo desde Proveedores.';
  if (provider.type !== 'ollama' && !provider.secret_encrypted) return 'Falta configurar la credencial de este proveedor.';
  if (provider.secret_encrypted) {
    try { decryptSecret(provider.secret_encrypted); }
    catch { return 'No se pudo validar la credencial guardada. Reconfigurala desde Proveedores.'; }
  }
  return '';
}

function providerModels(providerId: string) {
  return db.prepare(`SELECT model_id,display_name,favorite,status,context_tokens,max_input_tokens,max_output_tokens
    FROM provider_models WHERE provider_id=? ORDER BY favorite DESC,display_name COLLATE NOCASE,model_id`).all(providerId) as {
    model_id: string; display_name: string; favorite: number; status: string;
    context_tokens: number | null; max_input_tokens: number | null; max_output_tokens: number | null;
  }[];
}

/** Uses the same stable order as GET /api/providers; credentials never leave this module. */
export function getWorkflowGeneratorOptions(userId: string): WorkflowGeneratorOptions {
  const rows = db.prepare('SELECT * FROM providers WHERE user_id=? ORDER BY name').all(userId) as (ProviderRecord & { status: string })[];
  const providers: WorkflowGeneratorProviderOption[] = rows.map((provider) => {
    const configProblem = providerConfigProblem(provider);
    const models = providerModels(provider.id).filter((model) => AVAILABLE_MODEL_STATUSES.has(model.status));
    const reason = configProblem || (models.length ? '' : 'No hay modelos disponibles confirmados. Sincronizá los modelos del proveedor para continuar.');
    return {
      id: provider.id, name: provider.name, type: provider.type, status: provider.status,
      ready: !reason,
      reason,
      models: models.map((model) => ({ id: model.model_id, displayName: model.display_name, favorite: Boolean(model.favorite) })),
    };
  });

  const configuredSecond = providers[1] || null;
  const secondProvider = configuredSecond ? {
    ...configuredSecond,
    modelId: configuredSecond.models[0]?.id || null,
    modelName: configuredSecond.models[0]?.displayName || null,
  } : null;
  const secondProviderReason = secondProvider
    ? (secondProvider.ready ? '' : secondProvider.reason)
    : 'Configurá al menos dos proveedores para usar automáticamente el segundo. También podés seleccionar otro proveedor disponible.';
  return { configuredProviderCount: providers.length, secondProvider, secondProviderReason, providers };
}

function chooseGenerator(userId: string, requestedProviderId?: string, requestedModelId?: string): SelectedGenerator {
  const options = getWorkflowGeneratorOptions(userId);
  const selected = requestedProviderId
    ? options.providers.find((provider) => provider.id === requestedProviderId)
    : options.secondProvider;
  if (!selected) {
    if (requestedProviderId) throw fail('El proveedor elegido no existe en tu cuenta.', 404, 'GENERATOR_PROVIDER_NOT_FOUND');
    throw fail(options.secondProviderReason, 409, 'SECOND_PROVIDER_UNAVAILABLE');
  }
  if (!selected.ready) throw fail(selected.reason, 409, 'GENERATOR_PROVIDER_UNAVAILABLE');
  const modelOption = requestedModelId
    ? selected.models.find((model) => model.id === requestedModelId)
    : selected.models[0];
  if (!modelOption) throw fail('Elegí un modelo disponible y confirmado para este proveedor.', 409, 'GENERATOR_MODEL_UNAVAILABLE');

  const provider = db.prepare('SELECT * FROM providers WHERE id=? AND user_id=?').get(selected.id, userId) as ProviderRecord | undefined;
  const model = db.prepare(`SELECT context_tokens,max_input_tokens,max_output_tokens,status FROM provider_models
    WHERE provider_id=? AND model_id=?`).get(selected.id, modelOption.id) as {
    context_tokens: number | null; max_input_tokens: number | null; max_output_tokens: number | null; status: string;
  } | undefined;
  if (!provider || !model || !AVAILABLE_MODEL_STATUSES.has(model.status)) throw fail('El proveedor o modelo dejó de estar disponible. Actualizá Proveedores e intentá de nuevo.', 409, 'GENERATOR_MODEL_UNAVAILABLE');
  return {
    provider, providerId: provider.id, providerName: provider.name, modelId: modelOption.id, modelName: modelOption.displayName,
    contextTokens: model.context_tokens, maxInputTokens: model.max_input_tokens, maxOutputTokens: model.max_output_tokens,
  };
}

function unsupportedCapability(request: string) {
  if (/\b(?:mis|my)\s+tareas?\b|\b(?:gmail|outlook|slack|notion|trello|asana|jira|google calendar|calendario)\b/i.test(request)) {
    return 'No hay un conector de tareas, calendario o mensajería configurado en Nexus. Podés describir un flujo que procese texto que pegues como entrada, o configurar una URL HTTPS exacta en la allowlist del servidor.';
  }
  if (/\b(?:cada día|todos los días|diariament\w*|cada semana|semanalment\w*|cron|programad[oa]s?|scheduled|schedule)\b/i.test(request)) {
    return 'Los disparadores programados todavía no están implementados. Por ahora el flujo queda preparado para ejecutarlo manualmente cuando quieras.';
  }
  return '';
}

function allowedHttpHosts() {
  return (process.env.WORKFLOW_HTTP_ALLOWED_HOSTS || '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
}

function suppliedHttpsUrls(request: string) {
  const matches = request.match(/https:\/\/[^\s<>"'`]+/gi) || [];
  const result: URL[] = [];
  for (const match of matches) {
    const cleaned = match.replace(/[),.;!?]+$/g, '');
    try { result.push(new URL(cleaned)); } catch { /* invalid user text is not a URL */ }
  }
  return result;
}

function boundedText(value: unknown, label: string, maxLength: number, fallback = '') {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || value.length > maxLength) throw fail(`El plan generado contiene un campo ${label} no válido. No se guardó ninguna automatización.`, 422, 'INVALID_GENERATED_WORKFLOW');
  return value.trim();
}

function validRelativeFilePath(value: unknown) {
  try {
    const relative = cleanRelativePath(value);
    if (!relative) throw new Error('La ruta está vacía.');
    validateFileName(relative);
    return relative;
  } catch {
    throw fail('La IA propuso una ruta de archivo no válida. Revisá la solicitud e intentá de nuevo; no se guardó nada.', 422, 'INVALID_GENERATED_WORKFLOW');
  }
}

/** Converts provider output into a small, validated workflow draft; nothing is persisted here. */
export function parseGeneratedWorkflowPlan(text: string, context: { userId: string; request: string; generator: SelectedGenerator }) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_PLAN_JSON_BYTES) throw fail('La respuesta de la IA está vacía o supera el presupuesto global permitido. No se guardó ninguna automatización.', 422, 'INVALID_GENERATED_WORKFLOW');
  const withoutFence = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const firstBrace = withoutFence.indexOf('{');
  const lastBrace = withoutFence.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace < firstBrace) throw fail('La IA no devolvió una estructura de automatización válida. No se guardó nada; podés ajustar la instrucción e intentar de nuevo.', 422, 'INVALID_GENERATED_WORKFLOW');
  let raw: any;
  try { raw = JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1)); }
  catch { throw fail('La IA devolvió un plan que no se pudo leer. No se guardó nada; intentá generar el flujo otra vez.', 422, 'INVALID_GENERATED_WORKFLOW'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw fail('La respuesta de la IA no contiene un plan de automatización válido.', 422, 'INVALID_GENERATED_WORKFLOW');
  const unsupported = boundedText(raw.unsupportedReason, 'de compatibilidad', 500);
  if (unsupported) throw fail(unsupported, 422, 'UNSUPPORTED_REQUEST');

  const name = boundedText(raw.name, 'nombre', 100);
  const description = boundedText(raw.description, 'descripción', 500);
  if (!name) throw fail('El plan generado no tiene nombre. No se guardó nada.', 422, 'INVALID_GENERATED_WORKFLOW');
  if (!Array.isArray(raw.nodes) || raw.nodes.length < 3 || raw.nodes.length > 40 || !Array.isArray(raw.edges) || raw.edges.length > 80) {
    throw fail('El plan debe tener entre 3 y 40 nodos y hasta 80 conexiones. No se guardó nada.', 422, 'INVALID_GENERATED_WORKFLOW');
  }

  const originalIds = new Set<string>();
  const idMap = new Map<string, string>();
  for (let index = 0; index < raw.nodes.length; index += 1) {
    const rawId = raw.nodes[index]?.id;
    if (typeof rawId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(rawId) || originalIds.has(rawId)) throw fail('El plan contiene identificadores de nodo inválidos o repetidos.', 422, 'INVALID_GENERATED_WORKFLOW');
    originalIds.add(rawId);
    idMap.set(rawId, `n${index + 1}`);
  }

  const requestUrls = suppliedHttpsUrls(context.request);
  const hosts = new Set(allowedHttpHosts());
  const nodes: FlowNode[] = raw.nodes.map((rawNode: any, index: number) => {
    if (!rawNode || typeof rawNode !== 'object' || Array.isArray(rawNode) || typeof rawNode.type !== 'string' || !NODE_TYPES.has(rawNode.type)) {
      throw fail('La IA propuso un tipo de paso que el motor de automatizaciones no admite. No se guardó nada.', 422, 'INVALID_GENERATED_WORKFLOW');
    }
    const type = rawNode.type as string;
    const rawConfig = rawNode.config ?? {};
    if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) throw fail('La configuración de un paso no es válida.', 422, 'INVALID_GENERATED_WORKFLOW');
    const nameForNode = boundedText(rawNode.name, 'nombre de nodo', 100, type);
    let config: Record<string, unknown> = {};
    if (type === 'text') config = { text: boundedText(rawConfig.text ?? rawConfig.value, 'texto', 4_000) };
    else if (type === 'ai') {
      const mode = normalizeUsageMode(rawConfig.mode) || 'MEDIO';
      config = { prompt: boundedText(rawConfig.prompt, 'instrucción de IA', 4_000, '{{result}}'), mode, providerId: context.generator.providerId, modelId: context.generator.modelId };
    } else if (type === 'agent') {
      const agentId = boundedText(rawConfig.agentId, 'habilidad asociada', 80);
      const owned = agentId && db.prepare('SELECT 1 FROM agents WHERE id=? AND user_id=?').get(agentId, context.userId);
      if (!owned) throw fail('La IA propuso una habilidad que no pertenece a tu cuenta. Elegí una habilidad guardada o quitá ese paso.', 422, 'INVALID_GENERATED_WORKFLOW');
      config = { agentId };
    } else if (type === 'read_file') config = { path: validRelativeFilePath(rawConfig.path) };
    else if (type === 'write_file') {
      const filePath = validRelativeFilePath(rawConfig.path);
      const content = boundedText(rawConfig.content, 'contenido del archivo', 1_000_000, '{{result}}');
      config = { path: filePath, content };
    } else if (type === 'transform') {
      const operation = String(rawConfig.operation || 'trim');
      if (!['trim', 'uppercase', 'lowercase', 'prepend', 'append'].includes(operation)) throw fail('La IA propuso una transformación que no existe en Nexus.', 422, 'INVALID_GENERATED_WORKFLOW');
      config = { operation, ...(operation === 'prepend' || operation === 'append' ? { text: boundedText(rawConfig.text, 'texto de transformación', 2_000) } : {}) };
    } else if (type === 'condition') config = { contains: boundedText(rawConfig.contains, 'condición', 500) };
    else if (type === 'http') {
      const method = String(rawConfig.method || 'GET').toUpperCase();
      let url: URL;
      try { url = new URL(boundedText(rawConfig.url, 'URL', 2_000)); }
      catch { throw fail('La IA solo puede proponer una URL HTTPS exacta que hayas incluido en tu instrucción.', 422, 'UNSUPPORTED_REQUEST'); }
      const exactUserUrl = requestUrls.some((candidate) => candidate.href.replace(/\/$/, '') === url.href.replace(/\/$/, ''));
      if (url.protocol !== 'https:' || url.username || url.password || !hosts.has(url.hostname.toLowerCase()) || !exactUserUrl) {
        throw fail('La petición HTTP requiere una URL HTTPS exacta incluida por vos y un host habilitado en WORKFLOW_HTTP_ALLOWED_HOSTS. No se inventó ni ejecutó ninguna integración.', 422, 'UNSUPPORTED_REQUEST');
      }
      if (!['GET', 'POST'].includes(method)) throw fail('El nodo HTTP solo admite GET y POST.', 422, 'INVALID_GENERATED_WORKFLOW');
      config = { method, url: url.href, ...(method === 'POST' ? { body: boundedText(rawConfig.body, 'cuerpo HTTP', 8_000, '{{input}}') } : {}) };
    }
    return { id: idMap.get(rawNode.id)!, type, name: nameForNode || `Paso ${index + 1}`, config };
  });

  const edges: FlowEdge[] = raw.edges.map((edge: any) => {
    if (!edge || typeof edge.source !== 'string' || typeof edge.target !== 'string') throw fail('El plan contiene una conexión inválida.', 422, 'INVALID_GENERATED_WORKFLOW');
    const source = idMap.get(edge.source); const target = idMap.get(edge.target);
    if (!source || !target) throw fail('Una conexión apunta a un paso inexistente.', 422, 'INVALID_GENERATED_WORKFLOW');
    return { source, target, ...(edge.sourceHandle === undefined ? {} : { sourceHandle: edge.sourceHandle }) };
  });

  if (nodes.filter((node) => node.type === 'start').length !== 1 || !nodes.some((node) => node.type === 'input') || !nodes.some((node) => node.type === 'output' || node.type === 'end')) {
    throw fail('El flujo debe incluir un disparador manual, una entrada y al menos una salida.', 422, 'INVALID_GENERATED_WORKFLOW');
  }
  try { validateWorkflow(nodes, edges); }
  catch (error) { throw fail(error instanceof Error ? error.message : 'El grafo no pasó la validación.', 422, 'INVALID_GENERATED_WORKFLOW'); }

  const start = nodes.find((node) => node.type === 'start')!;
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) adjacency.set(edge.source, [...(adjacency.get(edge.source) || []), edge.target]);
  const reachable = new Set<string>([start.id]); const queue = [start.id];
  while (queue.length) for (const next of adjacency.get(queue.shift()!) || []) if (!reachable.has(next)) { reachable.add(next); queue.push(next); }
  if (reachable.size !== nodes.length) throw fail('El plan contiene pasos desconectados del disparador. No se guardó nada.', 422, 'INVALID_GENERATED_WORKFLOW');
  for (const condition of nodes.filter((node) => node.type === 'condition')) {
    const branches = new Set(edges.filter((edge) => edge.source === condition.id).map((edge) => edge.sourceHandle));
    if (!branches.has('true') || !branches.has('false')) throw fail('Cada paso Condición necesita una conexión para las ramas verdadera y falsa.', 422, 'INVALID_GENERATED_WORKFLOW');
  }
  return { name, description, nodes, edges };
}

function systemPrompt(allowedHosts: string[]) {
  return `Sos un generador de borradores de automatización para Nexus AI Workspace. Respondé únicamente con un objeto JSON, sin Markdown ni texto fuera del JSON.

Esquema: {"name":"...","description":"...","unsupportedReason":null,"nodes":[{"id":"start","type":"start","name":"Inicio manual","config":{}},{"id":"input","type":"input","name":"Entrada de texto","config":{}},{"id":"step","type":"...","name":"...","config":{}}],"edges":[{"source":"start","target":"input"}]}. Cada id debe ser único y las referencias de edges deben coincidir.

Tipos realmente implementados: start (disparo manual), input (recibe el texto ingresado al ejecutar), text (config.text con texto y plantillas {{input}}/{{result}}), ai (config.prompt y opcional config.mode), transform (config.operation: trim, uppercase, lowercase, prepend o append; prepend/append aceptan config.text), condition (config.contains; conectá dos salidas con sourceHandle true y false), read_file (config.path relativo a un proyecto, solo cuando la persona lo pidió), write_file (config.path relativo y config.content; nunca afirma que ya escribió; la escritura requiere confirmación al ejecutar), http (solo GET/POST a una URL HTTPS exacta que la persona escribió; los únicos hosts permitidos son: ${allowedHosts.join(', ') || 'ninguno'}), output y end.

Todos los nodos deben formar un grafo acíclico conectado que empiece en start, incluya input y termine en output/end. No incluyas posiciones. Para nodos ai, el backend añadirá de forma segura el proveedor/modelo elegidos. No inventes integraciones, cuentas, conectores, herramientas, URLs, archivos existentes, disparadores programados, llamadas ejecutadas ni datos del usuario. Nexus no tiene conectores de tareas/calendario/correo ni programación de ejecuciones. Si la solicitud depende de algo ausente, devolvé {"unsupportedReason":"explicación breve y alternativa posible"} y no inventes nodos para simularlo. Un flujo para procesar texto pegado manualmente sí está soportado. El borrador no se guarda hasta que el usuario lo revise y pulse Guardar.`;
}

function providerUsage(result: { text: string; usage?: any }, prompt: string) {
  const input = Number(result.usage?.prompt_tokens ?? result.usage?.input_tokens ?? result.usage?.promptTokenCount);
  const output = Number(result.usage?.completion_tokens ?? result.usage?.output_tokens ?? result.usage?.candidatesTokenCount);
  const inputMeasured = Number.isSafeInteger(input) && input >= 0;
  const outputMeasured = Number.isSafeInteger(output) && output >= 0;
  return {
    input: inputMeasured ? input : estimateTextUnits(prompt),
    output: outputMeasured ? output : estimateTextUnits(result.text),
    estimated: !inputMeasured || !outputMeasured,
  };
}
function workflowFinishStatus(reason: unknown) {
  const normalized = String(reason || '').toLowerCase().split(':').at(-1);
  if (['length', 'max_tokens', 'max_tokens_reached', 'max_output_tokens', 'max_completion_tokens', 'token_limit_reached'].includes(normalized || '')) return 'incomplete';
  if (['stop', 'end_turn', 'stop_sequence', 'message_stop', 'finished_stop', 'response'].includes(normalized || '')) return 'complete';
  return 'unverified';
}
export async function generateWorkflowDraft(user: AuthUser, requestText: string, requestedProviderId?: string, requestedModelId?: string, requestId?: string) {
  if (typeof requestText !== 'string') throw fail('La instrucción para generar una automatización debe ser texto.', 400, 'INVALID_REQUEST');
  const request = requestText.trim();
  if (!request || request.length > MAX_REQUEST_CHARS) throw fail(`Escribí una instrucción de hasta ${MAX_REQUEST_CHARS.toLocaleString()} caracteres.`, 400, 'INVALID_REQUEST');
  const unsupported = unsupportedCapability(request);
  if (unsupported) throw fail(unsupported, 422, 'UNSUPPORTED_REQUEST');
  if (runningGeneration.has(user.id)) throw fail('Ya se está generando una automatización para esta cuenta.', 429, 'GENERATION_IN_PROGRESS');
  const selected = chooseGenerator(user.id, requestedProviderId, requestedModelId);
  const budget = budgetForMode(USAGE_MODE, { contextTokens: selected.contextTokens, maxInputTokens: selected.maxInputTokens, maxOutputTokens: selected.maxOutputTokens });
  if (budget.outputTokens === null || (budget.inputContextTokens !== null && budget.inputContextTokens < 1)) throw fail('No se conocen límites suficientes para este modelo. Configurá los límites documentados en Proveedores.', 409, 'MODEL_BUDGET_TOO_SMALL');
  const messages: CanonicalMessage[] = [
    { role: 'system', content: `${MODE_POLICIES[USAGE_MODE].instruction}\n\n${systemPrompt(allowedHttpHosts())}` },
    { role: 'user', content: `Solicitud del usuario:\n${request}` },
  ];
  const continuationBase = [...messages];
  const promptText = messages.map((message) => message.content).join('\n\n');
  if (budget.inputContextTokens !== null && estimateTextUnits(promptText) > budget.inputContextTokens) throw fail('La instrucción y el esquema superan el límite de entrada configurado de este modelo. Reducí el texto o elegí otro modelo.', 413, 'MODEL_CONTEXT_TOO_SMALL');
  const idempotency = String(requestId || crypto.randomUUID());
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(idempotency)) throw fail('Identificador de generación no válido.', 400, 'INVALID_REQUEST_ID');
  const outputLimit = outputLimitForRequest(selected, TASK_TOKEN_BUDGET, estimateTextUnits(promptText));
  if (outputLimit === null || outputLimit < 1) throw fail('No se conoce el máximo de salida documentado para este modelo.', 409, 'MODEL_OUTPUT_LIMIT_UNKNOWN');
  const reservation = reserveUsage(user, `workflow-generator:${idempotency}`, 'workflow-generator', estimateTextUnits(promptText), outputLimit, { providerId: selected.providerId, modelId: selected.modelId, mode: USAGE_MODE });
  runningGeneration.add(user.id);
  let settled = false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('La generación superó el límite de tiempo.')), 90_000);
    timer.unref();
    let generatedText = '';
    let outputTokens = 0;
    let inputTokens = 0;
    let estimated = false;
    let finalReason: unknown = null;
    let completed = false;
    try {
      for (let round = 0; round < 1024 && outputTokens < TASK_TOKEN_BUDGET; round += 1) {
        const currentPrompt = messages.map((message) => message.content).join('\n\n');
        const remaining = TASK_TOKEN_BUDGET - outputTokens;
        const requestLimit = outputLimitForRequest(selected, remaining, estimateTextUnits(currentPrompt));
        if (requestLimit === null || requestLimit < 1) throw fail('Se agotó el presupuesto disponible o el contexto del modelo antes de completar el borrador.', 422, 'INCOMPLETE_GENERATION');
        const result = await completeText(selected.provider, selected.modelId, messages, USAGE_MODE, controller.signal, requestLimit);
        finalReason = result.finishReason;
        generatedText = appendContinuation(generatedText, result.text);
        const usage = providerUsage(result, currentPrompt);
        outputTokens += usage.output;
        if (outputTokens > TASK_TOKEN_BUDGET) throw fail('La generación superó el presupuesto global del borrador; no se guardó.', 422, 'INCOMPLETE_GENERATION');
        inputTokens += usage.input;
        estimated ||= usage.estimated;
        const status = workflowFinishStatus(finalReason);
        if (status === 'complete') { completed = true; break; }
        if (status !== 'incomplete') throw fail(`El proveedor no confirmó la finalización del borrador (${String(finalReason || 'sin motivo')}).`, 502, 'UNVERIFIED_GENERATION');
        if (!result.text || usage.output < 1 || round === 1023) throw fail('La generación del borrador quedó incompleta por falta de progreso o por el límite seguro de continuaciones.', 422, 'INCOMPLETE_GENERATION');
        messages.splice(0, messages.length, ...buildContinuationMessages(
          continuationBase, generatedText,
          'Continúa exactamente después del JSON generado, sin repetir contenido ni cerrar prematuramente el objeto. Devuelve únicamente la continuación.',
          selected, TASK_TOKEN_BUDGET - outputTokens,
        ));
      }
    } catch (error) {
      if ((error as any)?.code) throw error;
      throw fail(error instanceof Error ? error.message : 'No se pudo contactar con el proveedor seleccionado.', 502, 'GENERATOR_PROVIDER_ERROR');
    } finally { clearTimeout(timer); }
    if (!completed) throw fail(finalReason ? `El borrador quedó incompleto (${String(finalReason)}); no se guardó.` : 'Se agotó el presupuesto global del borrador; no se guardó.', 422, 'INCOMPLETE_GENERATION');

    const usage = { input: inputTokens, output: outputTokens, estimated };
    settleUsage(user.id, reservation, usage.input + usage.output, { providerId: selected.providerId, modelId: selected.modelId, mode: USAGE_MODE, operation: 'workflow-generation', estimated: usage.estimated });
    settled = true;
    const plan = parseGeneratedWorkflowPlan(generatedText, { userId: user.id, request, generator: selected });
    return {
      ...plan,
      generatedBy: { providerId: selected.providerId, providerName: selected.providerName, modelId: selected.modelId, modelName: selected.modelName },
      usage: { inputTokens: usage.input, outputTokens: usage.output, estimated: usage.estimated },
    };
  } catch (error) {
    if (!settled) releaseUsage(user.id, reservation, 'failed', { operation: 'workflow-generation', error: error instanceof Error ? error.message : 'Error desconocido.' });
    throw error;
  } finally {
    runningGeneration.delete(user.id);
  }
}
