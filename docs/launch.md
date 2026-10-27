# Launching production

Production (`ghostcart-topaz.vercel.app`) still runs the hackathon build. This is the one-time path to the
current product. Run every step in order; nothing here deletes the hackathon data in Redis.

1. **Database (lead).** Vercel → project `ghostcart` → Storage → Neon (free plan), connected to
   Production and Preview. It injects `DATABASE_URL` and `DATABASE_URL_UNPOOLED`.
2. **Migrations.** `vercel env pull .env.production.check --environment=production`, then
   `DATABASE_URL_UNPOOLED=… pnpm --filter @ghostcart/db db:migrate` (reads the unpooled URL).
3. **Settings** (`vercel env add <NAME> production`), never pasted in chat:
   - `STORE_MODE=redis` (switch later, `docs/database.md`)
   - `CRON_SECRET`: `openssl rand -hex 32`
   - `SECRETS_KEYS=k1:<openssl rand -base64 32>` and `SECRETS_KEY_ID=k1`
   - `STAFF=<phone>:owner:<name>[,…]`
   - remove `DEMO_SIMULATE` and `FIRECRAWL_API_KEY`
4. **Preflight.** `pnpm --filter @ghostcart/web launch:check -- .env.production.check` (re-pull first).
   No blockers allowed; warnings are known gaps (test payments, no email yet). Delete the pulled file.
5. **Build settings.** Vercel → Settings → General → Root Directory `apps/web`. Reconnect Git to
   `teamthirtyeight/negotiator` (Settings → Git).
6. **Preview.** `vercel` (no `--prod`) and smoke-test: `/api/health` (Postgres and KV ok), shopper sign-in,
   a ZZ shop haggle, the seller dashboard, `/admin` with a STAFF number.
7. **Promote.** `vercel promote <preview-url>`. The previous production deployment stays one click away
   (`vercel rollback`).
8. **After launch.** `pnpm --filter @ghostcart/web db:ledger-gate` (read-only), then the Redis → Postgres
   cutover (`dual`, backfill, verify, `postgres`) in `docs/database.md`.
