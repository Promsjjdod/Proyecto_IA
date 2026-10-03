import fs from 'node:fs';
import path from 'node:path';
import { eq, asc } from 'drizzle-orm';
import { db, schema } from '../database/index.js';
import { config } from '../config/env.js';
import { randomId } from '../core/crypto.js';
import { notFound } from '../core/errors.js';
import { emit } from '../core/events.js';
import { createLogger } from '../core/logger.js';
import { getAdapter, resolveDefaultProvider, listProviderRecords } from '../providers/registry.js';
import { toolsForAgent } from '../plugins/manager.js';
import { effectivePermissions } from '../tools/permissions.js';
import { executeToolCall } from './tool-exec.service.js';
import { getSettings } from './settings.service.js';

const log = createLogger('tasks');

const running = new Map(); // taskId -> { cancelled }

export function listTasks() {
  return db.select().from(schema.tasks).orderBy(asc(schema.tasks.createdAt)).all().reverse();
}

export function getTask(id) {
  const row = db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
  if (!row) throw notFound('Task not found.');
  return row;
}

export function getSteps(taskId) {
  return db.select().from(schema.taskSteps).where(eq(schema.taskSteps.taskId, taskId)).orderBy(asc(schema.taskSteps.position)).all();
}

export function cancelTask(id) {
  getTask(id);
  const state = running.get(id);
  if (state) state.cancelled = true;
  updateTask(id, { status: 'cancelled', finishedAt: Date.now() });
  emit(`task:${id}`, { type: 'task_updated', task: getTask(id), steps: getSteps(id) });
  return getTask(id);
}

function updateTask(id, patch) {
  db.update(schema.tasks).set({ ...patch, updatedAt: Date.now() }).where(eq(schema.tasks.id, id)).run();
}

function pushEvent(taskId, type, data) {
  emit(`task:${taskId}`, { type, ...data });
}

function addStep(taskId, { phase, name, tool = null, detail = '' }, position) {
  const id = randomId('step');
  db.insert(schema.taskSteps).values({
    id, taskId, phase, name, tool, detail, status: 'pending', position, createdAt: undefined, startedAt: null, finishedAt: null,
  }).run();
  return id;
}

function setStep(id, patch) {
  db.update(schema.taskSteps).set(patch).where(eq(schema.taskSteps.id, id)).run();
}

export function createTask({ prompt, agentId, chatId = null, title }, userId) {
  const id = randomId('task');
  const now = Date.now();
  const agent = agentId
    ? db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).get()
    : db.select().from(schema.agents).where(eq(schema.agents.id, 'automation')).get();
  db.insert(schema.tasks).values({
    id,
    chatId,
    agentId: agent?.id || null,
    title: title || prompt.replace(/\s+/g, ' ').slice(0, 60),
    prompt,
    status: 'queued',
    progress: 0,
    createdAt: now,
    updatedAt: now,
  }).run();
  const state = { cancelled: false };
  running.set(id, state);
  setImmediate(() => runTask(id, userId, state).catch((err) => {
    log.error('task crashed', { taskId: id, error: err.message });
    updateTask(id, { status: 'failed', error: err.message, finishedAt: Date.now() });
    pushEvent(id, 'task_updated', { task: getTask(id), steps: getSteps(id) });
  }));
  return getTask(id);
}

/** Ask the model for a JSON plan; fall back to a deterministic heuristic plan. */
async function buildPlan(task, agent, adapter, model, tools) {
  const toolNames = tools.map((t) => t.name);
  const heuristic = () => {
    const keywords = (task.prompt.match(/[\w./-]{3,}/g) || []).slice(0, 6);
    return [
      { phase: 'analyze', name: 'Inspect workspace layout', tool: 'list_dir', args: { path: '', recursive: false } },
      { phase: 'analyze', name: `Search for relevant code (${keywords[0] || 'project'})`, tool: 'search_files', args: { query: keywords[0] || 'README', content: true } },
      { phase: 'execute', name: 'Read the most relevant file', tool: 'read_file', args: { path: keywords.find((k) => k.includes('.')) || 'README.md' } },
      { phase: 'verify', name: 'Verify changes are consistent', tool: 'read_file', args: { path: keywords.find((k) => k.includes('.')) || 'README.md' } },
    ].filter((s) => toolNames.includes(s.tool));
  };

  if (!adapter || adapter.kind === 'demo') return heuristic();
  try {
    const request = {
      model,
      messages: [
        { role: 'system', content: 'You plan tasks for an automation agent. Reply ONLY with JSON: {"steps":[{"phase":"analyze|execute|verify","name":"...","tool":"...","args":{...}}]} using at most 8 steps and only these tools: ' + toolNames.join(', ') },
        { role: 'user', content: task.prompt },
      ],
      temperature: 0.2,
      maxTokens: 1200,
    };
    let text = '';
    for await (const ev of adapter.streamChat(request)) {
      if (ev.type === 'delta') text += ev.text;
    }
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return heuristic();
    const parsed = JSON.parse(match[0]);
    const steps = (parsed.steps || [])
      .filter((s) => s && toolNames.includes(s.tool) && ['analyze', 'execute', 'verify'].includes(s.phase))
      .slice(0, 8)
      .map((s) => ({ phase: s.phase, name: String(s.name || s.tool).slice(0, 120), tool: s.tool, args: s.args || {} }));
    return steps.length ? steps : heuristic();
  } catch (err) {
    log.warn('plan generation failed, using heuristic', { error: err.message });
    return heuristic();
  }
}

async function runTask(taskId, userId, state) {
  const settings = getSettings();
  const task = getTask(taskId);
  const agent = task.agentId ? db.select().from(schema.agents).where(eq(schema.agents.id, task.agentId)).get() : null;
  const granted = effectivePermissions(agent);

  updateTask(taskId, { status: 'planning', progress: 5 });
  pushEvent(taskId, 'task_updated', { task: getTask(taskId), steps: [] });

  const record = resolveDefaultProvider() || listProviderRecords().find((p) => p.kind === 'demo');
  const adapter = record ? getAdapter(record) : null;
  let model = settings.models.defaultModel || '';
  if (adapter && !model) {
    try { model = (await adapter.listModels())[0]?.id || ''; } catch { model = ''; }
  }

  const tools = await toolsForAgent(agent || { tools: ['read_file', 'list_dir', 'search_files'], plugins: [] });
  const usable = tools.filter((t) => (t.permissions || []).every((p) => granted.includes(p)) || t.dangerous);

  // ---- PLAN
  const planStepId = addStep(taskId, { phase: 'plan', name: 'Build execution plan' }, 0);
  setStep(planStepId, { status: 'running', startedAt: Date.now() });
  pushEvent(taskId, 'step_updated', { step: { id: planStepId, status: 'running' } });
  const plan = await buildPlan(task, agent, adapter, model, usable);
  updateTask(taskId, { plan, status: 'running' });
  setStep(planStepId, { status: 'done', finishedAt: Date.now(), detail: `${plan.length} step(s) planned`, output: { plan } });
  pushEvent(taskId, 'task_updated', { task: getTask(taskId), steps: getSteps(taskId) });

  // ---- steps
  const ctx = { userId, taskId, chatId: task.chatId, agent, granted, workspaceRoot: config.workspaceRoot };
  let position = 1;
  const results = [];
  const total = plan.length + 1; // + result step
  let done = 1;

  for (const planned of plan) {
    if (state.cancelled) return;
    const tool = usable.find((t) => t.name === planned.tool);
    const stepId = addStep(taskId, { phase: planned.phase, name: planned.name, tool: planned.tool }, position);
    position += 1;
    setStep(stepId, { status: 'running', startedAt: Date.now() });
    pushEvent(taskId, 'step_updated', { step: { id: stepId, status: 'running', phase: planned.phase, name: planned.name, tool: planned.tool } });

    if (!tool) {
      setStep(stepId, { status: 'skipped', finishedAt: Date.now(), error: `Tool ${planned.tool} not available.` });
    } else {
      const result = await executeToolCall(tool, planned.args || {}, ctx, {
        notify: (type, data) => pushEvent(taskId, type, data),
        settings,
      });
      if (result.ok) {
        setStep(stepId, { status: 'done', finishedAt: Date.now(), detail: result.summary, output: { data: safe(result.data) } });
        results.push(`- ${planned.name}: ${result.summary}`);
      } else {
        setStep(stepId, { status: 'failed', finishedAt: Date.now(), error: result.error });
        results.push(`- ${planned.name}: FAILED - ${result.error}`);
      }
    }
    done += 1;
    updateTask(taskId, { progress: Math.round((done / total) * 90) });
    pushEvent(taskId, 'task_updated', { task: getTask(taskId), steps: getSteps(taskId) });
  }

  // ---- RESULT
  const resultStepId = addStep(taskId, { phase: 'result', name: 'Summarize outcome' }, position);
  setStep(resultStepId, { status: 'running', startedAt: Date.now() });
  let summary = `## Task result\n\n${results.join('\n') || 'No actions were executed.'}`;
  if (adapter && adapter.kind !== 'demo' && model) {
    try {
      let text = '';
      for await (const ev of adapter.streamChat({
        model,
        messages: [
          { role: 'system', content: 'Summarize the outcome of an automation task. Only actions, results and errors. Markdown, concise.' },
          { role: 'user', content: `Task: ${task.prompt}\n\nActions:\n${results.join('\n')}` },
        ],
        temperature: 0.3,
        maxTokens: 800,
      })) if (ev.type === 'delta') text += ev.text;
      if (text.trim()) summary = text;
    } catch { /* keep local summary */ }
  }
  setStep(resultStepId, { status: 'done', finishedAt: Date.now(), detail: 'Summary ready', output: { summary } });
  const failed = results.some((r) => r.includes('FAILED'));
  updateTask(taskId, { status: failed ? 'completed' : 'completed', result: summary, progress: 100, finishedAt: Date.now() });
  running.delete(taskId);
  pushEvent(taskId, 'task_updated', { task: getTask(taskId), steps: getSteps(taskId) });
  log.info('task finished', { taskId, status: 'completed', steps: plan.length });
}

function safe(data) {
  try {
    const s = JSON.stringify(data);
    return s.length > 6000 ? { truncated: true, preview: s.slice(0, 6000) } : data;
  } catch {
    return undefined;
  }
}
