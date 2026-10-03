# Development

## Requirements

- Node.js ≥ 22.12 (LTS), npm ≥ 10.
- Optional: Ollama for local models; an OpenAI-compatible key for cloud models.

## Daily loop

```bash
npm run setup     # once: .env, deps, migrations, seed
npm run dev       # backend :8000 + frontend :3000 (watch-less, single window)
npm run dev:lan   # same, bound to 0.0.0.0 for LAN devices
npm test          # backend node:test suite + frontend typecheck
npm run doctor    # environment sanity (node, .env, deps, ports, assets)
npm run build     # production bundle (frontend/dist)
npm start         # production mode: static SPA :3000 + API :8000 with /api proxy
```

Windows: `setup.bat` then `start.bat`.

## Backend notes

- ESM JavaScript (no build step): `node backend/src/server.js`.
- Add a route: `backend/src/routes/*.routes.js`, mount in `app.js`.
- Add a tool: `backend/src/tools/*.js` + register in `tools/registry.js`, or
  drop a JSON pack in `/tools`.
- Add a plugin: new folder in `/plugins` (manifest ± index.js), then
  `POST /api/plugins/sync`.
- Add a provider kind: subclass `ProviderAdapter` (`providers/base.js`) and
  register in `providers/registry.js` KINDS.
- Migrations: new SQL file in `database/migrations/000X_name.sql`; keep
  `backend/src/database/schema.js` (Drizzle) in sync for queries.

## Frontend notes

- React 19 + TypeScript + zustand; hand-rolled CSS design system
  (`frontend/src/styles/global.css`) with dark/light themes and accents.
- Pages lazy-load via `React.lazy`; markdown via marked + DOMPurify +
  highlight.js core (curated languages) to keep the bundle lean.
- Streaming: `lib/sse.ts` (POST SSE for completions, GET SSE for tasks).
- State: `store/app.ts` (theme/sidebar/settings/toasts/palette),
  `store/chats.ts` (chats, messages, stream, approvals).

## Testing

`backend/tests/api.test.js` boots the app on an ephemeral port with a throwaway
SQLite file and covers: health, migrations/seed, auth modes, provider secret
protection, chat streaming + persistence, chat CRUD, agents CRUD + validation,
plugin lifecycle, permission guards (calculator/terminal/path traversal),
workspace-tree traversal rejection, search, file upload/preview/rename/delete,
demo image generation, video queue honesty, WORK task completion, settings
patching and memory secret redaction.

## Troubleshooting

- Port in use → `FORGEAI_PORT` / `FORGEAI_FRONTEND_PORT`.
- Backend unreachable from the SPA → check the Vite proxy target port matches
  `FORGEAI_PORT`.
- Ollama offline → System Status shows the exact probe error; start `ollama serve`.
- DB corruption → `npm run db:reset -- --yes && npm run migrate`.
- Logs → `data/logs/` or System Status → logs viewer.
