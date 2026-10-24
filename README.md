# GhostCart

AI "Cart Hijacker & Dynamic Deal Counter": paste a product link or cart screenshot, watch the agent haggle
across sellers, and lock a 180-second flash deal with a Pine Labs UPI payment.
See [docs/PROJECT.md](docs/PROJECT.md) for the brief, architecture and event-day plan.

## Local
```bash
pnpm install
cp .env.example .env.local   # fill in ANTHROPIC_API_KEY, FIRECRAWL_API_KEY, PINELABS_*, TWILIO_*
pnpm dev
pnpm test
```
Without Redis env vars, deals live in memory (single process only).

## Deploy (Vercel)
1. Import the repo, then add **Upstash Redis** from the Vercel Marketplace (injects `KV_REST_API_URL` / `KV_REST_API_TOKEN`).
2. Set the remaining env vars from `.env.example`; set `NEXT_PUBLIC_APP_URL` to the production URL.
3. Twilio console → WhatsApp sandbox → "When a message comes in": `https://<app>/api/webhooks/whatsapp` (POST).
4. Optional: ask Pine Labs to point webhooks at `https://<app>/api/webhooks/pinelabs` and set `PINELABS_WEBHOOK_SECRET`.
