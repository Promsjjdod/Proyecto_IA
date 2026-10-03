import { eq, desc } from 'drizzle-orm';
import { db, schema } from '../database/index.js';
import { config } from '../config/env.js';
import { encryptSecret, decryptSecret, randomId, randomToken, maskSecret } from '../core/crypto.js';
import { badRequest, unauthorized, notFound } from '../core/errors.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('github');
const API = 'https://api.github.com';

/** Short-lived OAuth state tokens (server memory only). */
const oauthStates = new Map();

export function oauthConfigured() {
  return Boolean(config.github.clientId && config.github.clientSecret);
}

export function status(userId = 'local') {
  const acc = db.select().from(schema.githubAccounts).where(eq(schema.githubAccounts.userId, userId)).orderBy(desc(schema.githubAccounts.createdAt)).get();
  if (!acc) {
    return {
      connected: false,
      oauthConfigured: oauthConfigured(),
      callbackUrl: config.github.callbackUrl,
      instructions: oauthConfigured()
        ? 'Click "Connect GitHub" to authorize ForgeAI with your GitHub account.'
        : 'Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in .env (OAuth app callback: ' + config.github.callbackUrl + '), or connect with a Personal Access Token instead.',
    };
  }
  return {
    connected: true,
    login: acc.login,
    avatarUrl: acc.avatarUrl,
    scopes: acc.scopes,
    authMethod: acc.authMethod,
    tokenMasked: maskSecret(safeToken(acc)),
    oauthConfigured: oauthConfigured(),
  };
}

function safeToken(acc) {
  try { return decryptSecret(acc.tokenEnc) || ''; } catch { return ''; }
}

export function startOAuth() {
  if (!oauthConfigured()) {
    throw badRequest('GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in .env, or connect with a Personal Access Token.');
  }
  const state = randomToken(24);
  oauthStates.set(state, Date.now());
  for (const [k, v] of oauthStates) if (Date.now() - v > 10 * 60 * 1000) oauthStates.delete(k);
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', config.github.clientId);
  url.searchParams.set('scope', 'repo read:user');
  url.searchParams.set('state', state);
  return { url: url.toString(), state };
}

export async function handleCallback({ code, state }) {
  if (!state || !oauthStates.has(state)) throw badRequest('Invalid or expired OAuth state. Start the flow again.');
  oauthStates.delete(state);
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: config.github.clientId,
      client_secret: config.github.clientSecret,
      code,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw badRequest('GitHub token exchange failed.');
  const body = await res.json();
  if (!body.access_token) throw badRequest(body.error_description || 'GitHub did not return an access token.');
  return await storeToken(body.access_token, 'oauth');
}

export async function connectPat(token) {
  if (!token || token.length < 10) throw badRequest('That does not look like a GitHub token.');
  return await storeToken(token, 'pat');
}

async function storeToken(token, method) {
  const me = await apiGet('/user', token);
  const userId = 'local';
  const existing = db.select().from(schema.githubAccounts).where(eq(schema.githubAccounts.userId, userId)).get();
  const scopes = method === 'pat' ? 'personal-access-token' : 'repo,read:user';
  if (existing) {
    db.update(schema.githubAccounts).set({
      login: me.login, avatarUrl: me.avatar_url, tokenEnc: encryptSecret(token), scopes, authMethod: method,
    }).where(eq(schema.githubAccounts.id, existing.id)).run();
  } else {
    db.insert(schema.githubAccounts).values({
      id: randomId('gh'), userId, login: me.login, avatarUrl: me.avatar_url,
      tokenEnc: encryptSecret(token), scopes, authMethod: method, createdAt: Date.now(),
    }).run();
  }
  log.info('github account connected', { login: me.login, method });
  return status(userId);
}

export function disconnect(userId = 'local') {
  db.delete(schema.githubAccounts).where(eq(schema.githubAccounts.userId, userId)).run();
  return { connected: false };
}

function tokenFor(userId = 'local') {
  const acc = db.select().from(schema.githubAccounts).where(eq(schema.githubAccounts.userId, userId)).get();
  const token = acc ? safeToken(acc) : '';
  if (!token && config.github.pat) return config.github.pat;
  if (!token) throw unauthorized('GitHub is not connected. Connect from Settings → GitHub first.');
  return token;
}

async function apiGet(path, token, params) {
  const url = new URL(API + path);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ForgeAI',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw badRequest(`GitHub API error ${res.status}: ${body?.message || res.statusText}`);
  }
  return res.json();
}

async function apiWrite(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'ForgeAI',
    },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw badRequest(`GitHub API error ${res.status}: ${j?.message || res.statusText}`);
  }
  return res.status === 204 ? null : res.json();
}

export async function listRepos(userId = 'local') {
  const token = tokenFor(userId);
  const repos = await apiGet('/user/repos', token, { sort: 'updated', per_page: '50', affiliation: 'owner,collaborator,organization_member' });
  return repos.map((r) => ({
    fullName: r.full_name, name: r.name, private: r.private, defaultBranch: r.default_branch,
    description: r.description, stars: r.stargazers_count, language: r.language, updatedAt: r.updated_at,
  }));
}

export async function readFile(owner, repo, filePath, ref, userId = 'local') {
  const token = tokenFor(userId);
  const data = await apiGet(`/repos/${owner}/${repo}/contents/${filePath.replace(/^\/+/, '')}`, token, ref ? { ref } : undefined);
  const content = data.content ? Buffer.from(data.content, 'base64').toString('utf8') : '';
  return { path: data.path, sha: data.sha, size: data.size, content };
}

export async function createOrUpdateFile({ owner, repo, path: filePath, content, message, branch }, userId = 'local') {
  const token = tokenFor(userId);
  let sha;
  try {
    const existing = await readFile(owner, repo, filePath, branch, userId);
    sha = existing.sha;
  } catch { /* new file */ }
  const res = await apiWrite('PUT', `/repos/${owner}/${repo}/contents/${filePath.replace(/^\/+/, '')}`, token, {
    message, content: Buffer.from(content, 'utf8').toString('base64'), ...(sha ? { sha } : {}), ...(branch ? { branch } : {}),
  });
  return { commit: res?.commit?.sha, path: res?.content?.path };
}

export async function createBranch({ owner, repo, branch, from }, userId = 'local') {
  const token = tokenFor(userId);
  const base = await apiGet(`/repos/${owner}/${repo}/git/ref/heads/${from || 'main'}`, token);
  const res = await apiWrite('POST', `/repos/${owner}/${repo}/git/refs`, token, {
    ref: `refs/heads/${branch}`, sha: base.object.sha,
  });
  return { ref: res?.ref, sha: res?.object?.sha };
}

export async function createCommit({ owner, repo, branch, message, changes }, userId = 'local') {
  const token = tokenFor(userId);
  const ref = await apiGet(`/repos/${owner}/${repo}/git/ref/heads/${branch}`, token);
  const commit = await apiGet(`/repos/${owner}/${repo}/git/commits/${ref.object.sha}`, token);
  const tree = await apiWrite('POST', `/repos/${owner}/${repo}/git/trees`, token, {
    base_tree: commit.tree.sha,
    tree: changes.map((c) => ({
      path: c.path, mode: '100644', type: 'blob',
      content: c.content === null ? undefined : c.content,
      ...(c.content === null ? { sha: null } : {}),
    })),
  });
  const newCommit = await apiWrite('POST', `/repos/${owner}/${repo}/git/commits`, token, {
    message, tree: tree.sha, parents: [ref.object.sha],
  });
  await apiWrite('PATCH', `/repos/${owner}/${repo}/git/refs/heads/${branch}`, token, { sha: newCommit.sha });
  return { sha: newCommit.sha };
}

export async function createIssue({ owner, repo, title, body, labels }, userId = 'local') {
  const token = tokenFor(userId);
  const res = await apiWrite('POST', `/repos/${owner}/${repo}/issues`, token, { title, body, labels });
  return { number: res.number, url: res.html_url };
}

export async function createPullRequest({ owner, repo, title, head, base, body }, userId = 'local') {
  const token = tokenFor(userId);
  const res = await apiWrite('POST', `/repos/${owner}/${repo}/pulls`, token, { title, head, base, body });
  return { number: res.number, url: res.html_url };
}
