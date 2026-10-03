import { z } from 'zod';
import { defineTool, cap, toolResult } from './base.js';
import * as search from '../services/search.service.js';
import * as memory from '../services/memory.service.js';
import * as images from '../services/image.service.js';
import * as github from '../services/github.service.js';

export const workspaceSearchTool = defineTool({
  name: 'workspace_search',
  description: 'Search across ForgeAI: chats, messages, agents, plugins, files and workspaces.',
  permissions: [],
  schema: z.object({ query: z.string().min(1).max(200) }),
  async execute({ query }) {
    const results = search.searchAll(query, { limit: 5 });
    const counts = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.length]));
    return toolResult(`Search "${query}": ${JSON.stringify(counts)}`, results);
  },
});

export const rememberTool = defineTool({
  name: 'remember',
  description: 'Store a durable fact in agent/workspace memory. Secrets are automatically refused.',
  permissions: [],
  schema: z.object({
    content: z.string().min(1).max(2000),
    scope: z.enum(['agent', 'workspace']).optional().default('agent'),
  }),
  async execute({ content, scope = 'agent' }, ctx) {
    const id = memory.remember({ scope, ownerId: scope === 'agent' ? (ctx.agent?.id || '') : '', content });
    return toolResult(id ? `Remembered (scope ${scope}).` : 'Nothing stored.', { id, scope });
  },
});

export const recallTool = defineTool({
  name: 'recall',
  description: 'Retrieve stored memories for the agent or workspace.',
  permissions: [],
  schema: z.object({
    query: z.string().max(300).optional().default(''),
    scope: z.enum(['agent', 'workspace', 'conversation']).optional().default('agent'),
  }),
  async execute({ query = '', scope = 'agent' }, ctx) {
    const ownerId = scope === 'agent' ? (ctx.agent?.id || '') : scope === 'conversation' ? (ctx.chatId || '') : '';
    const items = memory.recall({ scope, ownerId, query });
    return toolResult(`${items.length} memory item(s).`, { items });
  },
});

export const generateImageTool = defineTool({
  name: 'generate_image',
  description: 'Generate an image through the configured image provider (or DEMO placeholder when none is configured).',
  permissions: [],
  schema: z.object({
    prompt: z.string().min(1).max(2000),
    aspect: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4']).optional().default('1:1'),
  }),
  async execute({ prompt, aspect = '1:1' }) {
    const [row] = await images.generateImages({ prompt, negativePrompt: '', aspect, resolution: '1024', count: 1, style: 'auto' });
    return toolResult(`Image generated: ${row.path}${row.demo ? ' (DEMO placeholder)' : ''}`, { id: row.id, path: row.path, demo: row.demo });
  },
});

const ghOwnerRepo = {
  owner: z.string().min(1).max(100),
  repo: z.string().min(1).max(100),
};

export const ghListReposTool = defineTool({
  name: 'github_list_repos',
  description: 'List GitHub repositories the connected account can access.',
  permissions: ['GITHUB_ACCESS'],
  schema: z.object({}),
  async execute(_args, ctx) {
    const repos = await github.listRepos(ctx.userId);
    return toolResult(`${repos.length} repositories.`, { repos: repos.slice(0, 30) });
  },
});

export const ghReadFileTool = defineTool({
  name: 'github_read_file',
  description: 'Read a file from a GitHub repository.',
  permissions: ['GITHUB_ACCESS'],
  schema: z.object({
    ...ghOwnerRepo,
    path: z.string().min(1).max(500),
    ref: z.string().max(200).optional(),
  }),
  async execute({ owner, repo, path, ref }, ctx) {
    const file = await github.readFile(owner, repo, path, ref, ctx.userId);
    return toolResult(`Read ${owner}/${repo}/${path}`, { ...file, content: cap(file.content) });
  },
});

export const ghWriteFileTool = defineTool({
  name: 'github_create_file',
  description: 'Create or update a file in a GitHub repository (commits it). Dangerous: requires confirmation.',
  permissions: ['GITHUB_ACCESS'],
  dangerous: true,
  schema: z.object({
    ...ghOwnerRepo,
    path: z.string().min(1).max(500),
    content: z.string().max(500000),
    message: z.string().min(1).max(300),
    branch: z.string().max(200).optional(),
  }),
  async execute(args, ctx) {
    const res = await github.createOrUpdateFile(args, ctx.userId);
    return toolResult(`Committed ${args.path} to ${args.owner}/${args.repo}`, res);
  },
});

export const ghCreateBranchTool = defineTool({
  name: 'github_create_branch',
  description: 'Create a branch in a GitHub repository. Dangerous: requires confirmation.',
  permissions: ['GITHUB_ACCESS'],
  dangerous: true,
  schema: z.object({ ...ghOwnerRepo, branch: z.string().min(1).max(200), from: z.string().max(200).optional() }),
  async execute(args, ctx) {
    const res = await github.createBranch(args, ctx.userId);
    return toolResult(`Branch ${args.branch} created.`, res);
  },
});

export const ghCreateIssueTool = defineTool({
  name: 'github_create_issue',
  description: 'Open an issue in a GitHub repository. Dangerous: requires confirmation.',
  permissions: ['GITHUB_ACCESS'],
  dangerous: true,
  schema: z.object({
    ...ghOwnerRepo,
    title: z.string().min(1).max(300),
    body: z.string().max(20000).optional().default(''),
    labels: z.array(z.string().max(60)).max(10).optional().default([]),
  }),
  async execute(args, ctx) {
    const res = await github.createIssue(args, ctx.userId);
    return toolResult(`Issue #${res.number} opened.`, res);
  },
});

export const ghCreatePrTool = defineTool({
  name: 'github_create_pr',
  description: 'Open a pull request in a GitHub repository. Dangerous: requires confirmation.',
  permissions: ['GITHUB_ACCESS'],
  dangerous: true,
  schema: z.object({
    ...ghOwnerRepo,
    title: z.string().min(1).max(300),
    head: z.string().min(1).max(200),
    base: z.string().min(1).max(200),
    body: z.string().max(20000).optional().default(''),
  }),
  async execute(args, ctx) {
    const res = await github.createPullRequest(args, ctx.userId);
    return toolResult(`Pull request #${res.number} opened.`, res);
  },
});

export const workspaceTools = [workspaceSearchTool, rememberTool, recallTool, generateImageTool];
export const githubTools = [ghListReposTool, ghReadFileTool, ghWriteFileTool, ghCreateBranchTool, ghCreateIssueTool, ghCreatePrTool];
