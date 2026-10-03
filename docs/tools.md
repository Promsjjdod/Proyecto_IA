# Tools

Every tool is an object with `name`, `description`, zod `schema` (input),
`permissions`, optional `dangerous` flag and `execute(args, ctx)`.
See `backend/src/tools/base.js`.

## Built-in tools

| Tool | Permissions | Dangerous | Purpose |
|---|---|---|---|
| `read_file`, `list_dir`, `search_files` | READ_FILES | no | workspace reads (traversal-safe) |
| `write_file` | WRITE_FILES | **yes** | create/append text files |
| `run_command` | EXECUTE_COMMANDS | **yes** | allow-listed binaries, no shell |
| `fetch_url`, `http_request` | NETWORK_ACCESS | no | external HTTP (SSRF-guarded) |
| `workspace_search` | – | no | search chats/agents/plugins/files |
| `calculate` | – | no | safe expression evaluator (no eval) |
| `remember`, `recall` | – | no | memory scopes |
| `generate_image` | – | no | image provider or DEMO placeholder |
| `github_*` (6) | GITHUB_ACCESS | writes **yes** | repos, files, branches, commits, issues, PRs |

Plugin packs and `/tools/*.json` declarative HTTP packs add more
(`analyze_csv`, `github_rate_limit`, …).

## Execution pipeline

1. zod validation of arguments.
2. Permission check: tool permissions ⊆ granted (global allow-list ∩ agent).
3. If permissions are missing **or** the tool is dangerous (and
   `security.requireApprovalForDangerous` is on): an approval row is created,
   the UI shows tool + arguments + missing permissions, and execution pauses
   until `POST /api/approvals/:id {decision}` (5 min timeout ⇒ denied).
4. `execute()` runs with a context carrying workspace root, user, chat/task
   ids, granted permissions and plugin config.
5. Results are summarised back to the model (capped) and streamed to the UI as
   `tool_event` phases: started → approval_required/approved → completed /
   failed / denied.

## Hardening

- Filesystem: resolved paths must stay inside `FORGEAI_WORKSPACE_ROOT`.
- Terminal: binary allow-list (`FORGEAI_TERMINAL_ALLOWLIST`), shell operators
  (`| & ; > < \` $` and newlines) rejected, `spawn` without shell, hard timeout.
- Network: loopback/private/link-local hosts blocked (SSRF guard).
- Calculator: shunting-yard evaluator — never `eval`.
