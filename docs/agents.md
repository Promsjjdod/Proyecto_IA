# Agents

An agent bundles: name, description, avatar glyph, model + provider, system
prompt, tools, plugins, memory scopes, context window, temperature, max
tokens, permissions and enabled flag.

Built-in packs live in `/agents/*.json` and are seeded on first run
(`developer`, `researcher`, `writer`, `automation`). Create your own from
**/agents → New agent** or `POST /api/agents`.

## Fields

```json
{
  "id": "developer",
  "name": "Developer Agent",
  "avatar": "⚒",
  "model": "",
  "providerId": "",
  "systemPrompt": "You are a senior engineer…",
  "tools": ["read_file", "list_dir", "write_file", "run_command"],
  "plugins": ["file-explorer", "code-writer"],
  "memory": { "conversation": true, "agent": true, "workspace": false, "retention": "persistent" },
  "contextWindow": 128000,
  "temperature": 0.3,
  "maxTokens": 4096,
  "permissions": ["READ_FILES", "WRITE_FILES", "EXECUTE_COMMANDS"]
}
```

- `tools` references registry names (Settings → Tools lists them all).
- `plugins` adds every tool contributed by those enabled plugins.
- `permissions` are intersected with the global allow-list (Settings →
  Security). Anything missing triggers a runtime approval dialog.
- Built-in agents cannot be deleted, only disabled.

## Using agents

- Chat: agent selector in the composer (system prompt + tools + memory apply).
- WORK: tasks run through the selected agent (default `automation`).

## Memory

Three scopes: conversation (message window), agent (facts per agent via the
`remember`/`recall` tools) and workspace (shared). Secret-looking strings are
refused/redacted before storage. Manage entries in Settings → Memory.
