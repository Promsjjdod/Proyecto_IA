# ForgeAI Architecture

ForgeAI is a local-first AI workspace: a Node.js backend (Express 5 + SQLite via
Drizzle ORM) and a React 19 + Vite frontend, organized as an npm workspace.

```
ForgeAI/
├── backend/            # API server, providers, agents runtime, tools, plugins
│   ├── src/
│   │   ├── config/     # env parsing, paths, constants
│   │   ├── core/       # logger, errors, crypto, validation, rate limit, SSE bus
│   │   ├── database/   # drizzle schema, migrator, seed
│   │   ├── middleware/ # auth (sessions), error handling
│   │   ├── routes/     # REST + SSE endpoints (mounted under /api)
│   │   ├── services/   # chat, tasks (WORK), files, images, video, memory,
│   │   │               # search, settings, github, tool execution pipeline
│   │   ├── providers/  # adapter per kind: openai-compatible, ollama, custom, demo
│   │   ├── tools/      # tool definitions + permission/approval system
│   │   ├── plugins/    # plugin manager (packs live in /plugins)
│   │   └── app.js / server.js
│   └── tests/          # node:test suite (API, DB, providers, chat, agents,
│                       # plugins, permissions, auth)
├── frontend/           # React SPA (Vite, TypeScript, zustand, no CSS framework)
│   └── src/{components,pages,store,lib,styles}
├── agents/             # built-in agent packs (JSON) - user extensible
├── plugins/            # built-in plugin packs (manifest + optional JS tools)
├── providers/          # provider preset packs (JSON)
├── tools/              # declarative HTTP tool packs (JSON)
├── database/           # SQL migrations + seeds README
├── assets/brand/       # original logo set (main, light, mono, icons, favicons)
├── uploads/            # uploaded files (gitignored content)
├── generated/          # images/ and videos/ output (gitignored content)
├── data/               # SQLite db + logs (gitignored)
├── scripts/            # setup/dev/start/migrate/test/doctor launchers
└── docs/               # this documentation
```

## Request flow (chat)

1. `POST /api/chats/:id/completions` opens an SSE stream.
2. `chat.service.runCompletion` persists the user message, resolves provider +
   model (chat → settings default → flagged default → demo fallback), builds
   the message window (conversation memory), system prompt and memory blocks.
3. Tools available to the agent are collected from the tool registry +
   enabled plugins, filtered by effective permissions (global ∩ agent).
4. The provider adapter streams deltas; tool calls loop back through
   `tool-exec.service` (validation → permission check → optional approval →
   execute) up to `advanced.toolLoopMaxIterations`.
5. Messages, usage (tokens, tokens/sec, duration) and tool metadata are
   persisted; the UI receives `delta | tool_event | approval_* | usage |
   message_done | error` events.

## WORK task flow

`task.service` runs asynchronously: PLAN (model JSON plan or deterministic
fallback) → per-step ANALYZE/EXECUTE/VERIFY tool executions (each a
`task_steps` row with status/output/error, streamed over
`GET /api/tasks/:id/events`) → RESULT summary. Only actions, tools, results
and errors are surfaced — never private model reasoning.

## Storage

SQLite (WAL) with Drizzle ORM. Tables: users, sessions, chats, messages,
agents, providers, models_cache, plugins, workspaces, files, settings, tasks,
task_steps, memories, approvals, images, videos, github_accounts.
Migrations are plain SQL in `database/migrations`, tracked in
`forge_migrations`.

## Security model

See `docs/security.md`. Highlights: encrypted secrets (AES-256-GCM), signed
session cookies, permission groups + per-call approvals for dangerous tools,
path-traversal and command-injection guards, SSRF guard on network tools,
configurable CORS, local rate limiting, redacted logs, no stack traces to
clients.
