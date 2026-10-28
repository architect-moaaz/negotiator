# Launching production

Production (`ghostcart-topaz.vercel.app`, Vercel project `ghostcart`, team `athergens-projects`) still runs the
hackathon build. This is the one-time path to the current product. Nothing here deletes the hackathon data in
Redis, and the hackathon build stays one click away until step 9.

The `ghostcart-preview` project (https://ghostcart-preview.vercel.app) is the rehearsal: same steps, its own
Neon and Upstash, test payments. Anything that fails there fails here.

## What we learned on the preview

- **Vercel Hobby only allows daily crons.** `apps/web/vercel.json` runs order jobs and cart recovery every 15
  minutes (payout release, ship-by refunds, return escalation), so the team must be on **Pro** first.
- **Marketplace secrets are Sensitive.** `DATABASE_URL*` from Neon can't be pulled to a laptop, so migrations
  run inside the Vercel build (step 4). Production-only one-off scripts (backfill, ledger gate) need the Neon
  connection string from the Neon console instead.
- **Settings are scoped per environment.** A deploy only sees variables for its target; check `vercel env ls`
  shows each one under Production.
- **CLI deploys need `.vercelignore`** (in the repo) or the upload includes `.next`, `.turbo` and `.pglite`.
- **Neither Claude nor a script should paste secrets.** The lead runs the settings script; values are piped or
  prompted, never printed.

## Steps

| # | Step | Who | Done when |
| --- | --- | --- | --- |
| 0 | Merge the growth PR (#62) into `main` after review. | team | `main` has migrations 0019–0024 and this file |
| 1 | Upgrade team `athergens-projects` to **Pro** (Settings → Billing). | lead | the plan shows Pro |
| 2 | **Neon** from the Marketplace on project `ghostcart` (Storage → Create Database, free or Launch plan), connected to **Production only**. A separate database from the preview's. | lead | `vercel env ls production` lists `DATABASE_URL` and `DATABASE_URL_UNPOOLED` |
| 3 | **Settings** with the production settings script (below): `STORE_MODE=redis`, `CRON_SECRET`, `SECRETS_KEYS`/`SECRETS_KEY_ID`, `STAFF`, payments (decision A), and remove `DEMO_SIMULATE`, `FIRECRAWL_API_KEY`, `ADMIN_TOKEN`. | lead runs, Claude writes | every name present under Production; removed ones gone |
| 4 | **Build settings** (Claude, via the Vercel API): Root Directory `apps/web`, include files outside it, build command `pnpm --filter @ghostcart/db db:migrate && pnpm run build`. | Claude | project settings show them |
| 5 | **Staged production deploy**: `vercel deploy --prod --skip-domain` from `main`. Builds with production settings and migrates, but `ghostcart-topaz.vercel.app` keeps serving the hackathon build. | Claude | build log says "migrations applied successfully" |
| 6 | **Smoke test the staged URL**: `/api/health` (db and kv ok), home and catalogue, staff sign-in at `/admin` (real Vobiz call to the lead), a ZZ shop with one ZZ product, a ZZ shopper haggle through to a paid order, the seller dashboard, a cron route with `CRON_SECRET`. | Claude, lead answers the call | all pass; ZZ data noted for cleanup |
| 7 | **Go/no-go** on what step 6 showed. | lead | a yes in chat |
| 8 | **Promote**: `vercel promote <staged-url>`. | Claude after the yes | `ghostcart-topaz.vercel.app/api/health` serves the new build |
| 9 | **Watch for a day**: Sentry, `/admin` counts, the 15-minute crons in Vercel → Cron Jobs. **Rollback** at any point: `vercel rollback` (back to the hackathon build). | Claude and lead | no new errors; crons green |
| 10 | **Git**: connect `ghostcart` (and `ghostcart-preview`) to `teamthirtyeight/negotiator` so merges to `main` deploy. | lead | a push builds automatically |
| 11 | **Redis → Postgres cutover** (`docs/database.md`): `dual`, backfill with the Neon console string, a week of verify, then `postgres`. Then `db:ledger-gate` (read-only). | Claude prepares, lead runs anything that needs the Neon string | `/admin` counts match Postgres |
| 12 | **Clean up** ZZ test data from step 6; take Preview and Development off `ghostcart-redis` so `ghostcart` previews stop writing to the live Redis (previews belong on `ghostcart-preview`). | Claude, lead confirms | no `ZZ` rows left in production |

## Decisions before step 3

- **A. Payments at launch.** Real Pine Labs needs the partner agreement and live keys; until then the choice
  is the labelled test gateway (`PINELABS_MODE=mock`, `ALLOW_TEST_PAYMENTS=1`: shoppers see "test mode, no
  money moves") or Pine Labs UAT. With either, no real order can be taken, so this is a soft launch for
  sellers to set up shops.
- **B. Staff roster** (`STAFF`): phone, role and name for each of the team who should open `/admin`.
- **C. Launch window**: the switch takes seconds; pick a time when the lead can answer the Vobiz call and watch
  for an hour.

## Not in code (lead)

Company and GST; Pine Labs partner agreement and live keys; Meta verification and the order-update template;
Shiprocket account; KYC provider; Resend domain for email.
