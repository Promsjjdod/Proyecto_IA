import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';
import type { Database as SqlJsDatabase, Statement as SqlJsStatement, BindParams } from 'sql.js';
import { DB_FILE, DATA_DIR, PROJECT_DIR, UPLOAD_DIR, BUILTIN_AGENTS } from './config.js';
import { hashPassword } from './security.js';

for (const directory of [DATA_DIR, PROJECT_DIR, UPLOAD_DIR]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const wasmPath = path.resolve('node_modules/sql.js/dist/sql-wasm.wasm');
const SQL = await initSqlJs({ locateFile: () => wasmPath });

function normalizedParams(args: unknown[]): BindParams | undefined {
  if (!args.length) return undefined;
  return args.map((value) => value === undefined ? null : value) as BindParams;
}
class PersistentSqlite {
  private raw: SqlJsDatabase;
  private transactionDepth = 0;
  constructor() {
    const existing = fs.existsSync(DB_FILE) ? new Uint8Array(fs.readFileSync(DB_FILE)) : undefined;
    this.raw = existing ? new SQL.Database(existing) : new SQL.Database();
    this.raw.run('PRAGMA foreign_keys=ON');
  }
  private persist() {
    if (this.transactionDepth) return;
    const temp = `${DB_FILE}.tmp`;
    const snapshot = this.raw.export();
    // sql.js export resets connection-scoped pragmas; restore FK enforcement before the next statement.
    this.raw.run('PRAGMA foreign_keys=ON');
    fs.writeFileSync(temp, Buffer.from(snapshot), { mode: 0o600 });
    fs.renameSync(temp, DB_FILE);
  }
  prepare(sql: string) {
    const owner = this;
    return {
      get(...args: unknown[]) {
        const statement: SqlJsStatement = owner.raw.prepare(sql);
        try {
          const values = normalizedParams(args);
          if (values) statement.bind(values);
          return statement.step() ? statement.getAsObject() : undefined;
        } finally { statement.free(); }
      },
      all(...args: unknown[]) {
        const statement: SqlJsStatement = owner.raw.prepare(sql);
        const rows: Record<string, unknown>[] = [];
        try {
          const values = normalizedParams(args);
          if (values) statement.bind(values);
          while (statement.step()) rows.push(statement.getAsObject());
          return rows;
        } finally { statement.free(); }
      },
      run(...args: unknown[]) {
        const statement: SqlJsStatement = owner.raw.prepare(sql);
        try {
          const values = normalizedParams(args);
          if (values) statement.bind(values);
          statement.step();
          const changes = owner.raw.getRowsModified();
          const idRow = owner.raw.exec('SELECT last_insert_rowid() AS id')[0]?.values[0]?.[0] ?? 0;
          owner.persist();
          return { changes, lastInsertRowid: Number(idRow) };
        } finally { statement.free(); }
      },
    };
  }
  exec(sql: string) { this.raw.exec(sql); this.persist(); }
  pragma(statement: string) {
    if (/journal_mode|busy_timeout/i.test(statement)) return;
    this.raw.run(`PRAGMA ${statement}`);
    this.persist();
  }
  transaction<T extends (...args: any[]) => any>(operation: T) {
    const run = (...args: Parameters<T>): ReturnType<T> => {
      this.raw.run('BEGIN');
      this.transactionDepth += 1;
      try {
        const result = operation(...args);
        this.raw.run('COMMIT');
        this.transactionDepth -= 1;
        this.persist();
        return result;
      } catch (error) {
        try { this.raw.run('ROLLBACK'); } finally { this.transactionDepth -= 1; }
        throw error;
      }
    };
    (run as T & { immediate: T }).immediate = run as T;
    return run as T & { immediate: T };
  }
  close() { this.persist(); this.raw.close(); }
}

export const db = new PersistentSqlite();
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
  credits INTEGER NOT NULL DEFAULT 50000,
  daily_limit INTEGER NOT NULL DEFAULT 15000,
  monthly_limit INTEGER NOT NULL DEFAULT 100000,
  preferences_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  secret_encrypted TEXT NOT NULL DEFAULT '',
  auth_config_json TEXT NOT NULL DEFAULT '{}',
  last_checked_at TEXT,
  status TEXT NOT NULL DEFAULT 'not-tested',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, name)
);
CREATE TABLE IF NOT EXISTS provider_models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('detected','manual')),
  status TEXT NOT NULL DEFAULT 'unknown',
  favorite INTEGER NOT NULL DEFAULT 0,
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  context_tokens INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider_id, model_id)
);
CREATE INDEX IF NOT EXISTS provider_models_provider_idx ON provider_models(provider_id);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chats_recent_idx ON chats(user_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('system','user','assistant')),
  content TEXT NOT NULL,
  provider_id TEXT,
  model_id TEXT,
  mode TEXT,
  agent_id TEXT,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  meta_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_chat_idx ON messages(chat_id, created_at);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT 'sparkles',
  instructions TEXT NOT NULL,
  provider_id TEXT,
  model_id TEXT,
  mode TEXT NOT NULL DEFAULT 'MEDIO',
  tools_json TEXT NOT NULL DEFAULT '[]',
  limits_json TEXT NOT NULL DEFAULT '{}',
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  disk_path TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS file_revisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS file_revisions_path_idx ON file_revisions(project_id, relative_path, created_at DESC);
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  nodes_json TEXT NOT NULL DEFAULT '[]',
  edges_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  logs_json TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT,
  operation TEXT NOT NULL,
  credits INTEGER NOT NULL DEFAULT 0,
  reserved INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  meta_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS usage_user_date_idx ON usage(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_user_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

export function createUserDefaults(userId: string) {
  const now = new Date().toISOString();
  const projectId = cryptoId();
  const createProject = db.prepare('INSERT INTO projects(id,user_id,name,created_at,updated_at) VALUES(?,?,?,?,?)');
  createProject.run(projectId, userId, 'Mi primer proyecto', now, now);
  const addAgent = db.prepare(`INSERT INTO agents(id,user_id,name,description,icon,instructions,mode,tools_json,limits_json,is_builtin,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,1,?,?)`);
  for (const agent of BUILTIN_AGENTS) {
    addAgent.run(cryptoId(), userId, agent.name, agent.description, agent.icon, agent.prompt, agent.mode,
      JSON.stringify(agent.tools), JSON.stringify({ maxActions: 8, timeoutSeconds: 120, fileAccess: agent.tools.length > 0, imageAccess: false, audioAccess: false, memoryEnabled: false }), now, now);
  }
  return projectId;
}

function cryptoId() { return globalThis.crypto.randomUUID(); }

export function bootstrapAdminFromEnvironment() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) return;
  if (password.length < 12) {
    console.warn('Bootstrap administrator was not created: BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters.');
    return;
  }
  const found = db.prepare('SELECT id FROM users WHERE email=?').get(email) as { id: string } | undefined;
  if (found) return;
  const id = cryptoId();
  db.prepare(`INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)`).run(
    id, email, email.split('@')[0] || 'Admin', hashPassword(password), 'admin', new Date().toISOString(),
  );
  createUserDefaults(id);
  console.log(`Bootstrapped administrator account for ${email}.`);
}

export function databasePath() { return path.resolve(DB_FILE); }
