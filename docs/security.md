# Security

ForgeAI is a local tool that can touch your files, run commands and call
networks — so every capability flows through one permission pipeline.

## Secrets

- `.env` holds credentials; `.gitignore` excludes it. `.env.example` ships
  placeholders only.
- `FORGEAI_SECRET_KEY` derives the master key (AES-256-GCM) used to encrypt
  provider API keys and GitHub tokens at rest. Setup generates one for you.
- Encrypted values are decrypted only in backend memory; APIs return
  `hasApiKey` + masked previews. Logs redact secret-looking keys/values.
- Memory entries matching secret patterns (sk-…, ghp_…, `password=…`, private
  keys) are refused/redacted before storage.

## Authentication

- Default: trusted single-user local app (auto session cookie, HttpOnly,
  SameSite=Lax, HMAC-signed, stored hashed in `sessions`).
- Optional: set `FORGEAI_AUTH_PASSWORD` to enable a real login screen
  (scrypt-hashed password, 30-day sessions).

## Permissions & approvals

- Global allow-list (`FORGEAI_TOOL_PERMISSIONS`, Settings → Security) ∩ agent
  permissions = granted set.
- Missing permission **or** dangerous tool ⇒ approval row + modal with tool
  name, arguments and missing groups; execution blocks until decision
  (timeout = denied). History in `approvals` table.
- Agents never execute commands outside `tools/terminal.js` validation.

## Input & path safety

- zod validation on every endpoint; consistent 400 details, no stack traces.
- Filesystem tools and `/api/workspace-tree` reject path traversal.
- Uploads are stored under `uploads/` with generated names; downloads re-check
  the resolved path.
- Terminal: allow-listed binaries, no shell, operator blacklist, timeouts.
- Network tools: SSRF guard blocks loopback/private/link-local targets.
- CORS allow-list from `FORGEAI_CORS_ORIGINS`; rate limiting per IP/minute
  (`FORGEAI_RATE_LIMIT_MAX`, stricter bucket for auth).

## Network exposure

- Defaults bind to 127.0.0.1. `FORGEAI_LAN=true` binds 0.0.0.0 so devices on
  **your local network** can connect; no firewall rules or Internet exposure
  are ever created by ForgeAI itself.

## Errors & logs

- Clients receive `{code, message, errorId}`; full stacks go to
  `data/logs/forgeai-YYYY-MM-DD.log` and the in-memory ring visible in
  System Status (levels DEBUG/INFO/WARN/ERROR, secrets redacted).
