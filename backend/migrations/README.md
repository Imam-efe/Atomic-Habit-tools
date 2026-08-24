# Migrations

`npm run db:migrate:remote` runs on every deploy, and it re-runs **every file
listed in the script, every time**. There is no applied-migrations table.

That makes one rule absolute:

> **Only idempotent files may be listed in `db:migrate` / `db:migrate:remote`.**

Re-running a listed file must be a no-op. In practice:

| Statement | Safe form |
|---|---|
| `CREATE TABLE` | `CREATE TABLE IF NOT EXISTS` |
| `CREATE INDEX` | `CREATE INDEX IF NOT EXISTS` |
| `INSERT` | `INSERT OR IGNORE` / `ON CONFLICT DO ...` |
| `ALTER TABLE ... ADD COLUMN` | **cannot be made safe — do not list it** |

SQLite has no `ADD COLUMN IF NOT EXISTS`. A second run raises
`duplicate column name: <name>` and the whole deploy fails at the migration
step, which also skips the Worker deploy — so the backend silently stays on
the previous version while the frontend ships the new one.

## Column-adding migrations

Apply them once by hand and leave them out of the script:

```bash
cd backend
npx wrangler d1 execute fayolla-db --remote --file=./migrations/00XX_name.sql
```

Already applied this way, deliberately absent from the script:
`0002`, `0006`, `0007`, `0008`, `0010`, `0017`, `0018` (each adds a column), and
`0003` (a one-time fix that drops and rebuilds a table — destructive, must never
re-run).

`0004`, `0005`, and `0009` used to be missing from both this list and the
script, which was an oversight rather than a decision: all three are pure
`CREATE TABLE IF NOT EXISTS`, so they are safe to re-run and are now listed.
Their absence meant a database built only from the script never got
`push_subscriptions`, the menstrual tables, or `weekly_reviews`.

Note the limit this leaves: the tables created in `0006` (`kids_schedules`,
`debts`, `debt_payments`, `inventory_items`, …) still cannot be created by the
script, because the same file also adds columns. A database rebuilt from
scratch needs `0006` applied by hand. That is a known cost of keeping one file
per change; splitting it is the fix if bootstrapping ever needs to be
automatic.

The files stay in this directory as the schema's written history; only the
script's list is trimmed.

## How this was found

`0017` and `0018` were added to the script when they were written. Their first
deploy passed — a first `ADD COLUMN` succeeds. The *next* deploy failed on
`duplicate column name: streak_alert_sent`, having shipped a frontend whose
backend never deployed. Any deploy after the first would have hit it; the
change that happened to be next was unrelated to the cause.
