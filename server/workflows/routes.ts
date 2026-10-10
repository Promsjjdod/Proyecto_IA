import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, type AuthRequest } from '../auth.js';
import { executeWorkflow, validateWorkflow, type FlowNode, type FlowEdge } from './engine.js';

const router = Router();
router.use(requireAuth);
function dto(row: any) { return { id: row.id, name: row.name, description: row.description, nodes: JSON.parse(row.nodes_json || '[]'), edges: JSON.parse(row.edges_json || '[]'), createdAt: row.created_at, updatedAt: row.updated_at }; }
function owned(userId: string, id: string) {
  const row = db.prepare('SELECT * FROM workflows WHERE id=? AND user_id=?').get(id, userId) as any;
  if (!row) throw Object.assign(new Error('Automatización no encontrada.'), { status: 404 });
  return row;
}
function validateFields(input: any) {
  const name = String(input?.name || '').trim();
  const description = String(input?.description || '').trim();
  const nodes = input?.nodes;
  const edges = input?.edges;
  if (name.length < 1 || name.length > 100) throw Object.assign(new Error('El nombre debe tener entre 1 y 100 caracteres.'), { status: 400 });
  if (description.length > 500) throw Object.assign(new Error('La descripción no puede superar 500 caracteres.'), { status: 400 });
  try { validateWorkflow(nodes, edges); } catch (error) { throw Object.assign(error instanceof Error ? error : new Error('Flujo no válido.'), { status: 400 }); }
  return { name, description, nodes, edges };
}
router.get('/', (req: AuthRequest, res) => {
  const rows = db.prepare('SELECT * FROM workflows WHERE user_id=? ORDER BY updated_at DESC').all(req.user!.id) as any[];
  res.json(rows.map(dto));
});
router.post('/', (req: AuthRequest, res, next) => {
  try {
    const value = validateFields(req.body);
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    db.prepare('INSERT INTO workflows(id,user_id,name,description,nodes_json,edges_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id, req.user!.id, value.name, value.description, JSON.stringify(value.nodes), JSON.stringify(value.edges), now, now);
    res.status(201).json(dto(db.prepare('SELECT * FROM workflows WHERE id=?').get(id)));
  } catch (error) { next(error); }
});
router.patch('/:workflowId', (req: AuthRequest, res, next) => {
  try {
    const current = owned(req.user!.id, req.params.workflowId);
    const value = validateFields({ ...req.body, name: req.body?.name ?? current.name, description: req.body?.description ?? current.description,
      nodes: req.body?.nodes ?? JSON.parse(current.nodes_json || '[]'), edges: req.body?.edges ?? JSON.parse(current.edges_json || '[]') });
    const now = new Date().toISOString();
    db.prepare('UPDATE workflows SET name=?,description=?,nodes_json=?,edges_json=?,updated_at=? WHERE id=?')
      .run(value.name, value.description, JSON.stringify(value.nodes), JSON.stringify(value.edges), now, current.id);
    res.json(dto(db.prepare('SELECT * FROM workflows WHERE id=?').get(current.id)));
  } catch (error) { next(error); }
});
router.post('/:workflowId/duplicate', (req: AuthRequest, res, next) => {
  try {
    const source = owned(req.user!.id, req.params.workflowId);
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    db.prepare('INSERT INTO workflows(id,user_id,name,description,nodes_json,edges_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id, req.user!.id, `${source.name} (copia)`.slice(0, 100), source.description, source.nodes_json, source.edges_json, now, now);
    res.status(201).json(dto(db.prepare('SELECT * FROM workflows WHERE id=?').get(id)));
  } catch (error) { next(error); }
});
router.delete('/:workflowId', (req: AuthRequest, res, next) => {
  try {
    owned(req.user!.id, req.params.workflowId);
    if (req.body?.confirm !== true) return res.status(400).json({ error: 'Confirma la eliminación de la automatización y sus registros.' });
    db.prepare('DELETE FROM workflows WHERE id=? AND user_id=?').run(req.params.workflowId, req.user!.id);
    res.json({ ok: true });
  } catch (error) { next(error); }
});
router.post('/:workflowId/run', async (req: AuthRequest, res, next) => {
  try {
    const workflow = owned(req.user!.id, req.params.workflowId);
    const nodes = JSON.parse(workflow.nodes_json || '[]') as FlowNode[];
    const external = nodes.some((node) => node.type === 'ai' || node.type === 'http');
    if (external && req.body?.confirmExternalResources !== true) return res.status(400).json({ error: 'Confirma que este flujo puede enviar datos a un proveedor externo o a un host permitido.' });
    const input = String(req.body?.input || '');
    const projectId = req.body?.projectId ? String(req.body.projectId) : null;
    const result = await executeWorkflow(req.user!, workflow, input, projectId);
    res.json(result);
  } catch (error) { next(error); }
});
router.get('/:workflowId/runs', (req: AuthRequest, res, next) => {
  try {
    owned(req.user!.id, req.params.workflowId);
    const rows = db.prepare('SELECT * FROM workflow_runs WHERE workflow_id=? AND user_id=? ORDER BY started_at DESC LIMIT 50').all(req.params.workflowId, req.user!.id) as any[];
    res.json(rows.map((row) => ({ id: row.id, status: row.status, input: JSON.parse(row.input_json || '{}'), output: JSON.parse(row.output_json || '{}'), logs: JSON.parse(row.logs_json || '[]'), error: row.error, startedAt: row.started_at, finishedAt: row.finished_at })));
  } catch (error) { next(error); }
});
export default router;
