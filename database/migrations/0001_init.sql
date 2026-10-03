-- ForgeAI migration 0001: initial schema
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  user_agent TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'New chat',
  model TEXT NOT NULL DEFAULT '',
  provider_id TEXT NOT NULL DEFAULT '',
  agent_id TEXT,
  folder TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  system_prompt TEXT NOT NULL DEFAULT '',
  temperature REAL,
  max_tokens INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chats_user_idx ON chats(user_id);
CREATE INDEX IF NOT EXISTS chats_updated_idx ON chats(updated_at);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  model TEXT,
  provider_id TEXT,
  agent_id TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  tokens_per_sec REAL,
  duration_ms INTEGER,
  error TEXT,
  meta TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_chat_idx ON messages(chat_id);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '◈',
  model TEXT NOT NULL DEFAULT '',
  provider_id TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  tools TEXT NOT NULL DEFAULT '[]',
  plugins TEXT NOT NULL DEFAULT '[]',
  memory TEXT NOT NULL DEFAULT '{}',
  context_window INTEGER NOT NULL DEFAULT 128000,
  temperature REAL NOT NULL DEFAULT 0.7,
  max_tokens INTEGER NOT NULL DEFAULT 4096,
  permissions TEXT NOT NULL DEFAULT '[]',
  builtin INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  base_url TEXT NOT NULL DEFAULT '',
  api_version TEXT NOT NULL DEFAULT '',
  api_key_enc TEXT,
  headers TEXT NOT NULL DEFAULT '{}',
  body_params TEXT NOT NULL DEFAULT '{}',
  context_window INTEGER NOT NULL DEFAULT 128000,
  tags TEXT NOT NULL DEFAULT '[]',
  icon TEXT NOT NULL DEFAULT '◆',
  pricing_input REAL NOT NULL DEFAULT 0,
  pricing_output REAL NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  response_mode TEXT NOT NULL DEFAULT 'openai-sse',
  chat_path TEXT NOT NULL DEFAULT '/chat/completions',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS models_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  name TEXT NOT NULL,
  context INTEGER,
  size TEXT,
  status TEXT NOT NULL DEFAULT 'available',
  updated_at INTEGER NOT NULL,
  UNIQUE(provider_id, model_id)
);

CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '▣',
  version TEXT NOT NULL DEFAULT '0.1.0',
  author TEXT NOT NULL DEFAULT 'ForgeAI',
  category TEXT NOT NULL DEFAULT 'Utilities',
  permissions TEXT NOT NULL DEFAULT '[]',
  tools TEXT NOT NULL DEFAULT '[]',
  config TEXT NOT NULL DEFAULT '{}',
  config_schema TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'installed',
  source TEXT NOT NULL DEFAULT 'builtin',
  installed_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  root TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  folder TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL DEFAULT 0,
  storage_path TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'binary',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS files_ws_idx ON files(workspace_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  chat_id TEXT,
  agent_id TEXT,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  plan TEXT,
  result TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS task_steps (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  detail TEXT NOT NULL DEFAULT '',
  tool TEXT,
  output TEXT,
  error TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS steps_task_idx ON task_steps(task_id);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  owner_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'fact',
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  chat_id TEXT,
  task_id TEXT,
  tool TEXT NOT NULL,
  args TEXT NOT NULL DEFAULT '{}',
  permissions TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  decision_note TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  negative_prompt TEXT NOT NULL DEFAULT '',
  aspect TEXT NOT NULL DEFAULT '1:1',
  resolution TEXT NOT NULL DEFAULT '1024',
  style TEXT NOT NULL DEFAULT 'auto',
  model TEXT,
  provider_id TEXT,
  path TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  seed TEXT,
  demo INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  duration INTEGER NOT NULL DEFAULT 5,
  resolution TEXT NOT NULL DEFAULT '720p',
  aspect TEXT NOT NULL DEFAULT '16:9',
  style TEXT NOT NULL DEFAULT 'auto',
  status TEXT NOT NULL DEFAULT 'queued',
  path TEXT,
  error TEXT,
  provider_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS github_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  login TEXT NOT NULL,
  avatar_url TEXT,
  token_enc TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '',
  auth_method TEXT NOT NULL DEFAULT 'oauth',
  created_at INTEGER NOT NULL
);
