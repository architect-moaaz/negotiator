# Database: Postgres (Neon) + Drizzle

Durable data is moving from Redis to Postgres. Redis keeps short-lived keys: OTP codes, sessions, rate limits and locks, the live ticker, and mock gateway orders.

## Layout
- `packages/db/src/schema.ts`: Drizzle schema.
  - `0000_init` mirrors what Redis held (users, sellers, seller aliases and tokens, deals, activity, visits, counters, seller demand).
  - `0001_seller_catalogue` adds Wave 1 seller data: orgs and members, stores, categories, products and discount policies (one row per store, category or product level). These tables live only in Postgres.
- `packages/db/drizzle/`: generated SQL migrations. Commit them; never edit an applied one.
- `apps/web/src/lib/pg-store.ts`: Postgres implementation of the store's durable methods.
- `apps/web/src/lib/store.ts`: `STORE_MODE` picks the backend (below).

## Changing the schema
1. Edit `packages/db/src/schema.ts`.
2. `pnpm --filter @ghostcart/db db:generate --name <what-changed>` (no database needed).
3. Review the SQL, commit it with the schema change. Tests apply every migration to an in-process Postgres (PGlite), so CI needs no database.
4. Migrations run against Neon with `pnpm --filter @ghostcart/db db:migrate` (reads `DATABASE_URL_UNPOOLED`). Production migrations are run by the lead, not by CI, for now.

## Cutover from Redis (one-time)
| Step | `STORE_MODE` | What happens |
|---|---|---|
| 1. Provision | `redis` | Lead adds Neon from the Vercel Marketplace (a branch per preview), which injects `DATABASE_URL`. Run `db:migrate` on the main branch. |
| 2. Dual-write | `dual` | Every durable write also goes to Postgres; reads stay on Redis. A Postgres error is logged, never shown to shoppers. |
| 3. Backfill | `dual` | `pnpm --filter @ghostcart/web db:backfill` (dry run), then `--confirm`. Exports the activity log first, then copies everything. Re-runnable. |
| 4. Verify | `dual` | Compare `/admin` counts against a Postgres query for about a week of traffic. |
| 5. Switch reads | `postgres` | Postgres is the source of truth. Redis keeps only short-lived keys. |

Rolling back from step 5 to `redis` loses writes made since the switch, so do it only within minutes, or re-sync first.

## Local development
Without `DATABASE_URL`, seller data (`apps/web/src/lib/db.ts`) uses an embedded Postgres (PGlite) persisted in `apps/web/.pglite/` (gitignored), with every migration applied on startup. Delete the folder to start fresh. Tests use an in-memory one. Production refuses to start seller features without `DATABASE_URL`.

Durable hackathon data (deals, users) still follows `STORE_MODE` and stays on Redis or memory unless you point `DATABASE_URL` at a Neon dev branch and set `STORE_MODE=postgres`.

`GET /api/health` reports whether Postgres and the key-value store are reachable.
