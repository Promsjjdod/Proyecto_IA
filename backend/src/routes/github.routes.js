import { Router } from 'express';
import { parse, z } from '../core/validate.js';
import * as github from '../services/github.service.js';

export const githubRoutes = Router();

githubRoutes.get('/github/status', (req, res) => {
  res.json(github.status(req.user?.id || 'local'));
});

githubRoutes.get('/github/oauth/start', (_req, res) => {
  const { url } = github.startOAuth();
  res.json({ url });
});

githubRoutes.get('/github/oauth/callback', async (req, res) => {
  const code = String(req.query.code || '');
  const state = String(req.query.state || '');
  try {
    await github.handleCallback({ code, state });
    res.setHeader('Content-Type', 'text/html');
    res.send('<html><body style="font-family:system-ui;background:#101114;color:#eee;display:grid;place-items:center;height:100vh"><div style="text-align:center"><h2>GitHub connected</h2><p>You can close this tab and return to ForgeAI.</p></div></body></html>');
  } catch (err) {
    res.status(400).setHeader('Content-Type', 'text/html');
    res.send(`<html><body style="font-family:system-ui;background:#101114;color:#eee;display:grid;place-items:center;height:100vh"><div style="text-align:center"><h2>GitHub connection failed</h2><p>${err.message}</p></div></body></html>`);
  }
});

githubRoutes.post('/github/connect-pat', (req, res) => {
  const { token } = parse(z.object({ token: z.string().min(10).max(500) }), req.body, 'token');
  github.connectPat(token).then((status) => res.json(status)).catch((err) => res.status(400).json({ error: { message: err.message } }));
});

githubRoutes.post('/github/disconnect', (req, res) => {
  res.json(github.disconnect(req.user?.id || 'local'));
});

githubRoutes.get('/github/repos', async (req, res) => {
  res.json({ repos: await github.listRepos(req.user?.id || 'local') });
});

githubRoutes.get('/github/file', async (req, res) => {
  const q = parse(z.object({
    owner: z.string().min(1), repo: z.string().min(1), path: z.string().min(1), ref: z.string().optional(),
  }), req.query, 'query');
  res.json(await github.readFile(q.owner, q.repo, q.path, q.ref, req.user?.id || 'local'));
});

githubRoutes.post('/github/file', async (req, res) => {
  const body = parse(z.object({
    owner: z.string().min(1), repo: z.string().min(1), path: z.string().min(1),
    content: z.string(), message: z.string().min(1).max(300), branch: z.string().max(200).optional(),
  }), req.body, 'file');
  res.json(await github.createOrUpdateFile(body, req.user?.id || 'local'));
});

githubRoutes.post('/github/branch', async (req, res) => {
  const body = parse(z.object({
    owner: z.string().min(1), repo: z.string().min(1), branch: z.string().min(1).max(200), from: z.string().max(200).optional(),
  }), req.body, 'branch');
  res.json(await github.createBranch(body, req.user?.id || 'local'));
});

githubRoutes.post('/github/commit', async (req, res) => {
  const body = parse(z.object({
    owner: z.string().min(1), repo: z.string().min(1), branch: z.string().min(1).max(200),
    message: z.string().min(1).max(300),
    changes: z.array(z.object({ path: z.string().min(1), content: z.string().nullable() })).min(1).max(50),
  }), req.body, 'commit');
  res.json(await github.createCommit(body, req.user?.id || 'local'));
});

githubRoutes.post('/github/issue', async (req, res) => {
  const body = parse(z.object({
    owner: z.string().min(1), repo: z.string().min(1), title: z.string().min(1).max(300),
    body: z.string().max(20000).optional().default(''), labels: z.array(z.string()).max(10).optional().default([]),
  }), req.body, 'issue');
  res.json(await github.createIssue(body, req.user?.id || 'local'));
});

githubRoutes.post('/github/pr', async (req, res) => {
  const body = parse(z.object({
    owner: z.string().min(1), repo: z.string().min(1), title: z.string().min(1).max(300),
    head: z.string().min(1).max(200), base: z.string().min(1).max(200), body: z.string().max(20000).optional().default(''),
  }), req.body, 'pull request');
  res.json(await github.createPullRequest(body, req.user?.id || 'local'));
});
