# Database

ForgeAI persists everything in a local SQLite database (WAL mode) through
Drizzle ORM.

- `migrations/*.sql` - ordered SQL migrations, applied by `npm run migrate`
  (tracked in the `forge_migrations` table, idempotent).
- `seeds/` - reserved for JSON seed fixtures. The built-in seed (providers,
  agents, workspace, local user) is code-driven and idempotent:
  `backend/src/database/seed.js`.
- Runtime database file: `data/forgeai.db` (gitignored). Override with
  `FORGEAI_DB_PATH`.

Reset with `npm run db:reset -- --yes`, then `npm run migrate`.
