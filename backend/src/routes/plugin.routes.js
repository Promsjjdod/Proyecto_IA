import { Router } from 'express';
import { parse, idSchema, z } from '../core/validate.js';
import * as manager from '../plugins/manager.js';
import { toolCatalog } from '../tools/registry.js';
import { PERMISSIONS } from '../config/env.js';

export const pluginRoutes = Router();

pluginRoutes.get('/plugins', (_req, res) => {
  const plugins = manager.listPlugins().map((p) => ({ ...p, config: manager.publicConfig(p) }));
  res.json({ plugins, categories: [...new Set(plugins.map((p) => p.category))].sort(), permissions: PERMISSIONS });
});

pluginRoutes.post('/plugins/sync', (_req, res) => {
  manager.syncPlugins();
  res.json({ plugins: manager.listPlugins().map((p) => ({ ...p, config: manager.publicConfig(p) })) });
});

pluginRoutes.post('/plugins/:id/install', (req, res) => {
  const id = parse(idSchema, req.params.id, 'plugin id');
  res.json({ plugin: manager.installPlugin(id) });
});

pluginRoutes.post('/plugins/:id/enable', (req, res) => {
  const id = parse(idSchema, req.params.id, 'plugin id');
  res.json({ plugin: manager.enablePlugin(id) });
});

pluginRoutes.post('/plugins/:id/disable', (req, res) => {
  const id = parse(idSchema, req.params.id, 'plugin id');
  res.json({ plugin: manager.disablePlugin(id) });
});

pluginRoutes.post('/plugins/:id/uninstall', (req, res) => {
  const id = parse(idSchema, req.params.id, 'plugin id');
  res.json({ plugin: manager.uninstallPlugin(id) });
});

pluginRoutes.patch('/plugins/:id/config', (req, res) => {
  const id = parse(idSchema, req.params.id, 'plugin id');
  const values = parse(z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])), req.body, 'plugin config');
  const row = manager.configurePlugin(id, values);
  res.json({ plugin: { ...row, config: manager.publicConfig(row) } });
});

/** Tools available in this installation (builtin + packs + enabled plugins). */
pluginRoutes.get('/tools', (_req, res) => {
  res.json({ tools: toolCatalog() });
});
