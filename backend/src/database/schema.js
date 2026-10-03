import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

const json = (name) => text(name, { mode: 'json' });

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email'),
  passwordHash: text('password_hash'),
  role: text('role').notNull().default('owner'),
  createdAt: integer('created_at').notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  userAgent: text('user_agent'),
  ip: text('ip'),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

export const chats = sqliteTable('chats', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  title: text('title').notNull().default('New chat'),
  model: text('model').notNull().default(''),
  providerId: text('provider_id').notNull().default(''),
  agentId: text('agent_id'),
  folder: text('folder').notNull().default(''),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
  systemPrompt: text('system_prompt').notNull().default(''),
  temperature: real('temperature'),
  maxTokens: integer('max_tokens'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => [index('chats_user_idx').on(t.userId), index('chats_updated_idx').on(t.updatedAt)]);

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  chatId: text('chat_id').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull().default(''),
  model: text('model'),
  providerId: text('provider_id'),
  agentId: text('agent_id'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  tokensPerSec: real('tokens_per_sec'),
  durationMs: integer('duration_ms'),
  error: text('error'),
  meta: json('meta'),
  createdAt: integer('created_at').notNull(),
}, (t) => [index('messages_chat_idx').on(t.chatId)]);

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  avatar: text('avatar').notNull().default('◈'),
  model: text('model').notNull().default(''),
  providerId: text('provider_id').notNull().default(''),
  systemPrompt: text('system_prompt').notNull().default(''),
  tools: json('tools').notNull().default([]),
  plugins: json('plugins').notNull().default([]),
  memory: json('memory').notNull().default({ conversation: true, agent: true, workspace: false, retention: 'persistent' }),
  contextWindow: integer('context_window').notNull().default(128000),
  temperature: real('temperature').notNull().default(0.7),
  maxTokens: integer('max_tokens').notNull().default(4096),
  permissions: json('permissions').notNull().default(['READ_FILES']),
  builtin: integer('builtin', { mode: 'boolean' }).notNull().default(false),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const providers = sqliteTable('providers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  baseUrl: text('base_url').notNull().default(''),
  apiVersion: text('api_version').notNull().default(''),
  apiKeyEnc: text('api_key_enc'),
  headers: json('headers').notNull().default({}),
  bodyParams: json('body_params').notNull().default({}),
  contextWindow: integer('context_window').notNull().default(128000),
  tags: json('tags').notNull().default([]),
  icon: text('icon').notNull().default('◆'),
  pricingInput: real('pricing_input').notNull().default(0),
  pricingOutput: real('pricing_output').notNull().default(0),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  responseMode: text('response_mode').notNull().default('openai-sse'),
  chatPath: text('chat_path').notNull().default('/chat/completions'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const modelsCache = sqliteTable('models_cache', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  providerId: text('provider_id').notNull(),
  modelId: text('model_id').notNull(),
  name: text('name').notNull(),
  context: integer('context'),
  size: text('size'),
  status: text('status').notNull().default('available'),
  updatedAt: integer('updated_at').notNull(),
}, (t) => [uniqueIndex('models_unique_idx').on(t.providerId, t.modelId)]);

export const plugins = sqliteTable('plugins', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  icon: text('icon').notNull().default('▣'),
  version: text('version').notNull().default('0.1.0'),
  author: text('author').notNull().default('ForgeAI'),
  category: text('category').notNull().default('Utilities'),
  permissions: json('permissions').notNull().default([]),
  tools: json('tools').notNull().default([]),
  config: json('config').notNull().default({}),
  configSchema: json('config_schema').notNull().default({}),
  status: text('status').notNull().default('installed'),
  source: text('source').notNull().default('builtin'),
  installedAt: integer('installed_at'),
  updatedAt: integer('updated_at').notNull(),
});

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  root: text('root').notNull().default(''),
  createdAt: integer('created_at').notNull(),
});

export const files = sqliteTable('files', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  folder: text('folder').notNull().default(''),
  name: text('name').notNull(),
  originalName: text('original_name').notNull(),
  mime: text('mime').notNull().default('application/octet-stream'),
  size: integer('size').notNull().default(0),
  storagePath: text('storage_path').notNull(),
  kind: text('kind').notNull().default('binary'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => [index('files_ws_idx').on(t.workspaceId)]);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: json('value'),
  updatedAt: integer('updated_at').notNull(),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  chatId: text('chat_id'),
  agentId: text('agent_id'),
  title: text('title').notNull(),
  prompt: text('prompt').notNull(),
  status: text('status').notNull().default('queued'),
  progress: integer('progress').notNull().default(0),
  plan: json('plan'),
  result: text('result'),
  error: text('error'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  finishedAt: integer('finished_at'),
});

export const taskSteps = sqliteTable('task_steps', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  phase: text('phase').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull().default('pending'),
  detail: text('detail').notNull().default(''),
  tool: text('tool'),
  output: json('output'),
  error: text('error'),
  position: integer('position').notNull().default(0),
  startedAt: integer('started_at'),
  finishedAt: integer('finished_at'),
}, (t) => [index('steps_task_idx').on(t.taskId)]);

export const memories = sqliteTable('memories', {
  id: text('id').primaryKey(),
  scope: text('scope').notNull(),
  ownerId: text('owner_id').notNull().default(''),
  kind: text('kind').notNull().default('fact'),
  content: text('content').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  lastUsedAt: integer('last_used_at'),
});

export const approvals = sqliteTable('approvals', {
  id: text('id').primaryKey(),
  chatId: text('chat_id'),
  taskId: text('task_id'),
  tool: text('tool').notNull(),
  args: json('args').notNull().default({}),
  permissions: json('permissions').notNull().default([]),
  status: text('status').notNull().default('pending'),
  decisionNote: text('decision_note'),
  createdAt: integer('created_at').notNull(),
  resolvedAt: integer('resolved_at'),
});

export const images = sqliteTable('images', {
  id: text('id').primaryKey(),
  prompt: text('prompt').notNull(),
  negativePrompt: text('negative_prompt').notNull().default(''),
  aspect: text('aspect').notNull().default('1:1'),
  resolution: text('resolution').notNull().default('1024'),
  style: text('style').notNull().default('auto'),
  model: text('model'),
  providerId: text('provider_id'),
  path: text('path').notNull(),
  width: integer('width'),
  height: integer('height'),
  seed: text('seed'),
  demo: integer('demo', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
});

export const videos = sqliteTable('videos', {
  id: text('id').primaryKey(),
  prompt: text('prompt').notNull(),
  duration: integer('duration').notNull().default(5),
  resolution: text('resolution').notNull().default('720p'),
  aspect: text('aspect').notNull().default('16:9'),
  style: text('style').notNull().default('auto'),
  status: text('status').notNull().default('queued'),
  path: text('path'),
  error: text('error'),
  providerId: text('provider_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const githubAccounts = sqliteTable('github_accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  login: text('login').notNull(),
  avatarUrl: text('avatar_url'),
  tokenEnc: text('token_enc').notNull(),
  scopes: text('scopes').notNull().default(''),
  authMethod: text('auth_method').notNull().default('oauth'),
  createdAt: integer('created_at').notNull(),
});

export const schema = {
  users, sessions, chats, messages, agents, providers, modelsCache,
  plugins, workspaces, files, settings, tasks, taskSteps, memories,
  approvals, images, videos, githubAccounts,
};
