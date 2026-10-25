# GhostCart

An AI negotiation agent: a shopper haggles live with an agent that has a real discount budget, a human approves
anything past its limit, and the agreed price is locked with a Pine Labs UPI payment. Where we're taking it:
[docs/PRODUCT_PLAN.md](docs/PRODUCT_PLAN.md). How we work: [CLAUDE.md](CLAUDE.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Local
```bash
pnpm install
cp .env.example apps/web/.env.local   # fill in ANTHROPIC_API_KEY, FIRECRAWL_API_KEY, PINELABS_* (or PINELABS_MODE=mock)
pnpm dev
pnpm test
```
Without Redis env vars, deals live in memory (single process only).

## Deploy (Vercel)
1. Project Root Directory: `apps/web`. Add **Upstash Redis** from the Vercel Marketplace (injects `KV_REST_API_URL` / `KV_REST_API_TOKEN`).
2. Set the remaining env vars from `.env.example`: `NEXT_PUBLIC_APP_URL` (production URL), `STAFF`, `VOBIZ_*` (login codes), Pine Labs keys.
3. Ask Pine Labs to point webhooks at `https://<app>/api/webhooks/pinelabs` and set `PINELABS_WEBHOOK_SECRET`.
