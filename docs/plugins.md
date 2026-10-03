# Plugins

A plugin is a pack under `/plugins/<id>/`:

```
plugins/csv-insight/
├── plugin.json    # manifest
└── index.js       # optional: exports tools (defineTool from backend/src/tools/base.js)
```

## Manifest

```json
{
  "id": "web-fetch",
  "name": "Web Fetch",
  "description": "…",
  "icon": "🌐",
  "version": "1.0.0",
  "author": "ForgeAI",
  "category": "Search",
  "permissions": ["NETWORK_ACCESS"],
  "tools": ["fetch_url", "http_request"],
  "requiresConfig": [],
  "requiresService": null,
  "defaultStatus": "enabled",
  "defaultConfig": { "user_agent": "ForgeAI/0.1", "max_chars": 6000 },
  "configSchema": { "fields": [ { "name": "max_chars", "label": "Max characters", "type": "number" } ] }
}
```

- `tools`: names of registry tools the plugin exposes to agents.
- `index.js`: may export `tools` or `createTools(ctx)` for brand-new tools
  (see `plugins/csv-insight/index.js`).
- `requiresConfig`: fields that must be set before the plugin can enable.
- `requiresService`: `github` or `image-provider` gates enabling on those
  connections (DEMO mode satisfies the image provider).
- `configSchema.fields[].secret: true` values are AES-256-GCM encrypted and
  never returned to the frontend.
- Plugin config is live: tools receive it as `ctx.pluginConfig`
  (e.g. web-fetch honours `user_agent` / `max_chars`).

## Lifecycle & states

`not_installed → installed → enabled ⇄ disabled`, plus computed
`needs_configuration` and `error`. The **Plugin Manager** tab manages
installed packs; the **Marketplace** tab lists every pack on disk by category
(Productivity, Developer, Search, Files, Media, GitHub, Automation, AI,
Utilities) with Install buttons. Nothing is ever enabled or connected without
an explicit action; `POST /api/plugins/sync` re-scans `/plugins`.

## Bundled packs

calculator, file-explorer, code-writer, terminal-runner (disabled by default),
web-fetch, github-sync, memory-bank, image-studio, csv-insight.
