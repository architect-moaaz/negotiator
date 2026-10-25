# Database: Postgres (Neon) + Drizzle

Durable data is moving from Redis to Postgres. Redis keeps short-lived keys: OTP codes, sessions, rate limits and locks, the live ticker, and mock gateway orders.

## Layout
- `packages/db/src/schema.ts`: Drizzle schema. v1 mirrors what Redis holds today (users, sellers, seller aliases and tokens, deals, activity, visits, counters, seller demand). Orgs, policies, payments and the ledger come in later migrations.
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
Without `DATABASE_URL` everything runs on Redis or the in-memory fallback, as before. To work against Postgres locally, create a Neon dev branch and put its URL in `apps/web/.env.local` with `STORE_MODE=postgres`.
