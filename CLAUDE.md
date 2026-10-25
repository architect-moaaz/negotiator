# GhostCart: team guide for humans and coding agents

@AGENTS.md

GhostCart is an AI negotiation agent. A shopper haggles live with an agent that has a real discount budget, offers past the agent's limit go to a human (deal desk or the seller, on screen or by phone), and an agreed price is locked with a UPI payment. It won AI Builders Day (Airtribe × Pine Labs, Bengaluru, 24 Oct 2026). We're now turning it into a product: **the seller negotiation agent first, the consumer app second** (see [docs/ROADMAP.md](docs/ROADMAP.md)).

Team: `architect-moaaz` (Moaaz), `rajathc93`, `lakshmie6x`, `ginger205`, and Claude. Every change, from any of us, goes through a pull request into `main`; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Commands

```bash
pnpm install
pnpm dev          # http://localhost:3000; without Redis env vars data is in memory
pnpm test         # vitest
pnpm lint
pnpm exec tsc --noEmit
pnpm build        # must pass: Next 16 cacheComponents enforces prerender rules
```

## Map

| Area | Where |
| --- | --- |
| Negotiation pipeline (scrape → seller match → compare → terms → opening) | `src/lib/negotiate.ts`, `src/lib/scrape.ts` |
| Money rules: budget, floor, auto-approve limit, allowed moves | `src/lib/haggle.ts` (pure, tested) |
| Agent wording (Claude via Vercel AI SDK 7) | `src/lib/agent.ts`, `chooseMove` in `src/lib/haggle.ts` |
| Human approvals: deal desk, sellers, AgenticOrg recommendations | `src/lib/deal-desk.ts`, `src/app/api/admin/*`, `src/app/api/seller/*` |
| AgenticOrg agent tools (MCP server) and trigger | `src/app/api/mcp/route.ts`, `src/lib/agenticorg.ts`, [docs/agenticorg-setup.md](docs/agenticorg-setup.md) |
| Voice approvals and login codes (Vobiz) | `src/lib/vobiz.ts`, `src/lib/voice-*.ts`, `src/lib/otp.ts`, `src/app/api/voice/*` |
| Payments (Pine Labs, mock gateway for demos) and checkout | `src/lib/pinelabs*.ts`, `src/lib/payments.ts`, `src/lib/checkout.ts` |
| Accounts, sellers, sessions | `src/lib/users.ts`, `src/lib/sellers.ts`, `src/app/api/auth/*` |
| Analytics and demographics | `src/lib/analytics.ts`, `src/lib/demographics.ts`, `src/app/api/track` |
| Storage (Upstash Redis; in-memory in dev) | `src/lib/store.ts` |
| UI | `src/app/*` pages, `src/components/*` |

## Rules we learned the hard way

1. **No scraping or bot-check circumvention.** Amazon now blocks automated reads (503 pages). We detect that and ask for a screenshot; we never route around it (no stealth proxies, no CAPTCHA tricks). The real path is official APIs, seller catalogues and ONDC.
2. **Code sets every price; the LLM only talks.** `computeTerms` and `candidateMoves` decide what's allowed, and the model picks a move and writes the reply. Never let a model output become a price without the code-side bounds check.
3. **Humans approve what the agent can't.** Anything below the auto-approve limit escalates; after a human rejects, the agent holds at its final offer and never pages them again for the same deal.
4. **Honest UI copy.** Social proof, timers and claims use real data only ("be the first" rather than fake counts). Test-mode payments are labelled as test mode.
5. **Secrets never go in the repo or in chat.** `.env*` is gitignored except `.env.example`. Production values live in Vercel (`vercel env add`). Rotate anything that leaks.
6. **Consent and privacy.** Shoppers consent to deal contact at signup; we store only what's needed, and analytics never asks for age or gender.
7. **Test data on production is prefixed `ZZ`** (names like "ZZ Test (Claude)") so it can be found and removed.
8. **Next.js 16 specifics:** no `dynamic` route config (cacheComponents is on); read `params` and current time inside `<Suspense>` or client effects; check `node_modules/next/dist/docs/` before using an API from memory.
