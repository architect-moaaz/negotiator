# Load tests (k6)

Three scenarios against a **staging** deployment. Never production: the scripts refuse `ghostcart.app`.

| Script | What it simulates | Load |
| --- | --- | --- |
| `k6/browse.js` | shoppers on home, search, a shop and product pages | ramps to 200 virtual users |
| `k6/widget.js` | the "Make an offer" widget on sellers' product pages | 100 requests/second for 3 minutes |
| `k6/haggle.js` | start a deal, two offers, polling like the deal page, accept | ramps to 100 virtual users |

Pass criteria (in `k6/config.js`): under 1% failed requests, page p95 under 1.2 s, API p95 under 600 ms, and 99% of haggles start.

## Before a run

1. **Staging must be safe to hammer.**
   - Vobiz, Meta and Pine Labs in test mode (`PINELABS_MODE=mock` or UAT keys), so no real calls, messages or payments.
   - Unset `ANTHROPIC_API_KEY` for big runs, so the agent uses its template wording instead of spending tokens.
2. **Let the load generator's IP past the rate limits.** Set `RATE_LIMIT_ALLOWLIST=<ip>` on staging. It's ignored on Vercel production.
3. **Seed a ZZ shop, products, a widget key and ready shopper sessions,** using staging's env:
   ```bash
   ALLOW_LOAD_SEED=1 pnpm --filter @ghostcart/web db:seed-load -- --buyers 300 --origin https://zz-load.example
   ```
   This writes `load/k6/.seed.json` (gitignored; it contains session tokens).

## Run

```bash
k6 run -e BASE_URL=https://<staging-host> load/k6/browse.js
k6 run -e BASE_URL=https://<staging-host> load/k6/widget.js
k6 run -e BASE_URL=https://<staging-host> load/k6/haggle.js
```

Or run the **Load test** workflow in GitHub Actions. It takes the base URL and the script, and reads the seed file from the `LOAD_SEED_JSON` secret.

## After

- Revoke the shopper sessions: they expire in 30 days, or flush `session:buyer:*` on staging Redis.
- Remove the `ZZ Load …` org, shop and shoppers.
- Unset `RATE_LIMIT_ALLOWLIST`.
