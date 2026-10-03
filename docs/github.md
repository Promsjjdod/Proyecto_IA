# GitHub integration

Two connection methods; tokens are encrypted (AES-256-GCM) in SQLite and never
sent to the frontend (the UI only sees login, avatar, scopes and a masked token).

## OAuth App (recommended)

1. https://github.com/settings/developers → New OAuth App.
2. Authorization callback URL: `http://localhost:8000/api/github/oauth/callback`
   (adjust the port if you changed `FORGEAI_PORT`).
3. `.env`:
   ```env
   GITHUB_CLIENT_ID=...
   GITHUB_CLIENT_SECRET=...
   ```
4. Settings → GitHub → **Connect with OAuth** → authorize in the popup →
   callback exchanges the code server-side and stores the token.

## Personal Access Token

Settings → GitHub → paste a PAT (`repo`, `read:user` scopes). Stored the same
encrypted way. Useful without registering an OAuth app.

## Capabilities

- `GET /api/github/repos` — repositories visible to the token
- read file contents (`GET /api/github/file`)
- create/update file (commit) · create branch · create commit (git trees API)
- open issues · open pull requests

Tool equivalents (`github_list_repos`, `github_read_file`,
`github_create_file`, `github_create_branch`, `github_create_issue`,
`github_create_pr`) are exposed by the **github-sync** plugin; every write
requires the `GITHUB_ACCESS` permission **and** an interactive approval.

## Safety

- No token ever reaches browser storage or responses.
- Sensitive actions (writes) are gated by the approval system.
- Disconnecting deletes the encrypted row immediately.
