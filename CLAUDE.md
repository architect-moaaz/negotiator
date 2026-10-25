# GhostCart: team guide for humans and coding agents

@AGENTS.md

GhostCart is an AI negotiation agent. A shopper haggles live with an agent that has a real discount budget, offers past the agent's limit go to a human (deal desk or the seller, on screen or by phone), and an agreed price is locked with a UPI payment. It won AI Builders Day (Airtribe × Pine Labs, Bengaluru, 24 Oct 2026). We're now turning it into a product: **the seller negotiation agent first, the consumer app second** (see [docs/ROADMAP.md](docs/ROADMAP.md)).

Team: `architect-moaaz` (Moaaz), `rajathc93`, `lakshmie6x`, `ginger205`, and Claude. Every change, from any of us, goes through a pull request into `main`; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Commands

```bash
pnpm install
pnpm dev          # apps/web on http://localhost:3000; without Redis env vars data is in memory
pnpm check        # typecheck, lint, test, build across the workspace (what CI runs)
pnpm test         # vitest in every package
pnpm --filter @ghostcart/web build   # must pass: Next 16 cacheComponents enforces prerender rules
```

## Map

| Area | Where |
| --- | --- |
| Negotiation pipeline (scrape → seller match → compare → terms → opening) | `apps/web/src/lib/negotiate.ts`, `apps/web/src/lib/scrape.ts` |
| Money rules: budget, floor, auto-approve limit, allowed moves | `packages/core` (`terms.ts`, `moves.ts`; pure, property-tested). `apps/web/src/lib/haggle.ts` wraps it |
| Agent wording (Claude via Vercel AI SDK 7) | `apps/web/src/lib/agent.ts`, `chooseMove` in `apps/web/src/lib/haggle.ts` |
| Human approvals: deal desk, sellers, AgenticOrg recommendations | `apps/web/src/lib/deal-desk.ts`, `apps/web/src/app/api/admin/*`, `apps/web/src/app/api/seller/*` |
| Staff access: roster (`STAFF`), roles, audit trail | `apps/web/src/lib/staff.ts` (`requireStaff` on every admin route) |
| AgenticOrg agent tools (MCP server) and trigger | `apps/web/src/app/api/mcp/route.ts`, `apps/web/src/lib/agenticorg.ts`, [docs/agenticorg-setup.md](docs/agenticorg-setup.md) |
| Voice approvals and login codes (Vobiz) | `apps/web/src/lib/vobiz.ts`, `apps/web/src/lib/voice-*.ts`, `apps/web/src/lib/otp.ts`, `apps/web/src/app/api/voice/*` |
| Payments (Pine Labs, mock gateway for demos) and checkout | `apps/web/src/lib/pinelabs*.ts`, `apps/web/src/lib/payments.ts`, `apps/web/src/lib/checkout.ts` |
| Accounts, sellers, sessions | `apps/web/src/lib/session.ts` (server-side, revocable), `users.ts`, `sellers.ts`, `deal-access.ts`, `apps/web/src/app/api/auth/*`; OTP-verified signup in `api/signup` and `api/sellers` |
| Rate limits | `apps/web/src/lib/rate-limit.ts` |
| Analytics and demographics | `apps/web/src/lib/analytics.ts`, `apps/web/src/lib/demographics.ts`, `apps/web/src/app/api/track` |
| Storage: Redis (short-lived keys; in-memory in dev) and Postgres via `STORE_MODE` | `apps/web/src/lib/store.ts`, `pg-store.ts`, `packages/db` (Drizzle schema, migrations), [docs/database.md](docs/database.md) |
| UI | `apps/web/src/app/*` pages, `apps/web/src/components/*` |

## Rules we learned the hard way

1. **No scraping or bot-check circumvention.** Amazon now blocks automated reads (503 pages). We detect that and ask for a screenshot; we never route around it (no stealth proxies, no CAPTCHA tricks). The real path is official APIs, seller catalogues and ONDC.
2. **Code sets every price; the LLM only talks.** `computeTerms` and `candidateMoves` decide what's allowed, and the model picks a move and writes the reply. Never let a model output become a price without the code-side bounds check.
3. **Humans approve what the agent can't.** Anything below the auto-approve limit escalates; after a human rejects, the agent holds at its final offer and never pages them again for the same deal.
4. **Honest UI copy.** Social proof, timers and claims use real data only ("be the first" rather than fake counts). Test-mode payments are labelled as test mode.
5. **Secrets never go in the repo or in chat.** `.env*` is gitignored except `.env.example`. Production values live in Vercel (`vercel env add`). Rotate anything that leaks.
6. **Consent and privacy.** Shoppers consent to deal contact at signup; we store only what's needed, and analytics never asks for age or gender.
7. **Test data on production is prefixed `ZZ`** (names like "ZZ Test (Claude)") so it can be found and removed.
8. **Next.js 16 specifics:** no `dynamic` route config (cacheComponents is on); read `params` and current time inside `<Suspense>` or client effects; check `node_modules/next/dist/docs/` before using an API from memory.
