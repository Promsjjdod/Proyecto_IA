import { Router } from 'express';
import { parse, taskCreateSchema, idSchema } from '../core/validate.js';
import * as tasks from '../services/task.service.js';
import { attachSSE, bus } from '../core/events.js';
import { resolveApproval, listApprovals, approvalDecisionSchema } from '../tools/permissions.js';
import { notFound } from '../core/errors.js';

export const taskRoutes = Router();

taskRoutes.get('/tasks', (_req, res) => {
  res.json({ tasks: tasks.listTasks().map((t) => ({ ...t, steps: tasks.getSteps(t.id) })) });
});

taskRoutes.post('/tasks', (req, res) => {
  const body = parse(taskCreateSchema, req.body, 'task');
  res.status(201).json({ task: tasks.createTask(body, req.user.id) });
});

taskRoutes.get('/tasks/:id', (req, res) => {
  const id = parse(idSchema, req.params.id, 'task id');
  res.json({ task: tasks.getTask(id), steps: tasks.getSteps(id) });
});

taskRoutes.post('/tasks/:id/cancel', (req, res) => {
  const id = parse(idSchema, req.params.id, 'task id');
  res.json({ task: tasks.cancelTask(id) });
});

/** Live progress stream for a WORK task. */
taskRoutes.get('/tasks/:id/events', (req, res) => {
  const id = parse(idSchema, req.params.id, 'task id');
  tasks.getTask(id);
  const sse = attachSSE(req, res);
  const listener = (event) => { sse.send(event.type, event); };
  const approvalListener = (event) => {
    if (event.taskId === id) sse.send(event.type, event);
  };
  bus.on(`task:${id}`, listener);
  bus.on('approvals', approvalListener);
  res.on('close', () => {
    bus.off(`task:${id}`, listener);
    bus.off('approvals', approvalListener);
  });
  sse.send('task_updated', { task: tasks.getTask(id), steps: tasks.getSteps(id) });
});

// ---------------------------------------------------------------- approvals
taskRoutes.get('/approvals/all', (_req, res) => {
  res.json({ approvals: listApprovals() });
});

taskRoutes.post('/approvals/:id', (req, res) => {
  const id = parse(idSchema, req.params.id, 'approval id');
  const body = parse(approvalDecisionSchema, req.body, 'decision');
  const rec = resolveApproval(id, body.decision, body.note);
  if (!rec) throw notFound('Approval not found or already resolved.');
  res.json({ approval: rec });
});
