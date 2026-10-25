# GhostCart product plan: architecture, waves, team

## Context
GhostCart won AI Builders Day as a hackathon app. The team (Moaaz/`architect-moaaz` as lead, `rajathc93`, `lakshmie6x`, `ginger205`, and Claude) is now building the complete product, shipped in waves as fast as possible, through PRs into protected `main` (PR #3 has the team docs, PR #4 adds CI).

Decisions made:
- **Direction:** B first, then A.
  - B is a seller negotiation SaaS. An agent haggles within seller-set margins on the seller's own channels, escalates to the seller, and takes payment.
  - A is the consumer app. Shoppers haggle with GhostCart sellers, plus **affiliate price comparison only** (Amazon/Flipkart). There's no cashback, because the affiliate terms forbid rebates.
- **Channels, all in scope:**
  - universal JS widget
  - Shopify app
  - WooCommerce plugin
  - WhatsApp
  - Instagram DMs
  - iOS/Android apps
  - ONDC
- **Payments:** "GhostCart collects and splits". **Pine Labs, the licensed payment aggregator, collects and settles splits directly** to each seller and to GhostCart. GhostCart never holds buyer money (RBI PA Directions 2025). The fallback is the seller's own Pine Labs account.

What exists today:
- **Real:** the haggle engine (`src/lib/haggle.ts`), negotiation pipeline (`src/lib/negotiate.ts`), deal desk with AgenticOrg MCP, Vobiz voice approvals and OTP, analytics, seller accounts.
- **Demo or partial:**
  - Pine Labs is mocked.
  - The ₹9 lock fee and checkout work, but **nobody ships** (admin clicks through the stages).
  - The WhatsApp sandbox isn't configured.
  - Commission rates are guesses.
- **Security gaps:**
  - unsigned `gc_uid` cookie
  - unverified signup phone
  - no ownership check on `api/deal/checkout`
  - "simulate" endpoints act as free mark-paid routes
  - single `ADMIN_TOKEN`
  - no rate limits
  - store names can be claimed without proof
- **Storage:** Redis-only, scanning lists, with overwrite races.

## Target architecture
**pnpm + Turborepo monorepo** (extends `pnpm-workspace.yaml`):
- `apps/web`: Next.js 16 (dashboard, hosted checkout, admin, `/api/v1`, webhooks). Today's `src/` moves here.
- `apps/shopify`: Shopify app (embedded admin) + theme app embed block.
- `apps/mobile`: Expo (shopper app + seller approvals via push).
- `plugins/woocommerce`: PHP plugin that talks only to `/api/v1`.
- `packages/core`: pure negotiation engine (from `haggle.ts`, pure parts of `negotiate.ts`, `checkout.ts`, `deal-desk.ts`).
- `packages/agent`: LLM phrasing and free-text intent/price extraction (`chooseMove`, `agent.ts`). Code still sets every price.
- `packages/db`: Drizzle schema, migrations, repositories (Neon Postgres via Vercel Marketplace, a branch per preview).
- `packages/payments`: Pine Labs client (`pinelabs.ts`), split builder, webhook verification, test-only mock.
- `packages/channels`: adapters (widget, whatsapp, instagram, shopify, woo, ondc) mapping to a common event, plus `issueGrant()` per platform.
- `packages/widget`: Shadow-DOM bundle, under 15 kB gzipped, from a CDN.
- `packages/sdk`: typed client for `/api/v1`.

**Data (Postgres; every table scoped by `org_id`):**
- `orgs`, `members` (owner/admin/approver/viewer), `users`, `sessions`
- `stores` (platform, domain, `verified_at`), `channels`, `products`, `policies` (floor, auto-approve price, max rounds, expiry)
- `negotiations` (with a `version` column for optimistic concurrency) + an append-only `negotiation_events` log
- `price_grants` (discount code / draft order / payment link / coupon)
- `orders`, `payments` (Pine Labs order + split), `refunds`, and a double-entry `ledger_entries`
- `webhook_inbox` (idempotent), `api_keys`, `audit_log`, `consents`
- Seller and fraud tables:
  - `kyc_checks` (type, provider ref, status)
  - `seller_tiers`
  - `categories`
  - `policies` with `scope` + `priority`
  - `shipments` (AWB, courier, tracking events)
  - `holds` (Pine Labs settlement id, release_at, state)
  - `disputes`, `risk_scores`, `devices`
- `stores.platform` gains `ghostcart_shop` and `amazon` / `flipkart` (marketplace-linked)

**Redis** remains for sessions/OTP, rate limits, locks and the ticker. **QStash + Vercel Cron** run timers, grant expiry, approval-call retries, Pine Labs reconciliation (every 15 minutes plus nightly), webhook retries, and order-status sync.

**Auth:**
- Sellers: email magic link/OTP with team roles (Better Auth or Auth.js).
- Buyers: phone OTP into a signed, revocable session.
- Admin: RBAC inside an internal org, with an audit log. `ADMIN_TOKEN` is retired.
- Widget: a domain-allowlisted publishable key per store. Woo and the API use secret keys.
- Outbound webhooks to sellers: HMAC-signed.

**One negotiation API for every channel:**
- `POST /api/v1/sessions`
- `POST /api/v1/sessions/:id/offers` (amount or free text)
- `GET /api/v1/sessions/:id/events` (SSE stream)
- `POST /api/v1/sessions/:id/accept`, which returns a price grant
- `POST /api/v1/approvals/:id/decision` (dashboard, push and the Vobiz keypad all route here)

**How the agreed price is applied:**
- **Shopify:** `discountCodeBasicCreate` (single-use, locked to the product, expiring), with a draft-order `invoiceUrl` as fallback. No script tags; they're deprecated from Oct 2026.
- **Woo:** a single-use coupon via `wc/v3/coupons`.
- **Custom sites, WhatsApp, Instagram:** a GhostCart-hosted Pine Labs payment page.
- **ONDC:** the quote in `on_select`/`on_init`.

**Payments:** a Pine Labs order with the split set at creation (seller share, plus GhostCart's fee and 18% GST). Settlement is held, then released after the refund window. Webhooks go into the inbox and then the ledger, and a reconciliation job checks Pine Labs settlement reports against the ledger.

**Fulfilment:** sellers ship from their own platform. We sync status through Shopify and Woo webhooks, or a manual "mark shipped". GhostCart doesn't ship anything.

**Billing:** the Shopify Billing API for Shopify sellers (recurring + per accepted negotiation). For everyone else, a Pine Labs split fee plus a monthly GST invoice.

**Ops:** Sentry, Axiom logs, OpenTelemetry around LLM/Pine Labs/Shopify calls, PostHog funnels, per-org credentials encrypted with an envelope key, Zod validation at every boundary, a CSP on the widget, Dependabot + CodeQL.

## Sellers: onboarding, verification, per-product rules, payout holds and fraud

### Three ways in (one simple flow: phone OTP → choose how you sell → verify → set discounts → live)
1. **No website: "GhostCart Shop".** A hosted storefront at `ghostcart.app/s/<store>`.
   - The seller adds products from their phone: photo, title, price, stock. A WhatsApp catalogue import is optional.
   - Shoppers haggle on the shop page and pay through hosted checkout.
   - The seller shares the shop link on WhatsApp and Instagram, which ties in with Wave 3.
   - Also reached by the consumer app (Wave 4) and ONDC (Wave 5).
2. **Sells on Amazon or Flipkart.** The seller **authorises GhostCart to read their own listings** through the official seller APIs: Amazon SP-API via OAuth, Flipkart Seller APIs.
   - Listings import into their GhostCart Shop, and the authorisation also proves they own the marketplace account.
   - No scraping. A CSV export or upload is the fallback.
   - Haggled sales happen on GhostCart (shop or widget), and the seller fulfils them from their own stock.
   - Caveat: whether the marketplace allows selling listing data elsewhere needs checking against each programme's terms (open item for the lead).
3. **Has a store.** Universal widget (Wave 1), Shopify app or Woo plugin (Wave 2). Catalogue sync comes from the platform.

### Discount rules per product and category
Policies resolve in a cascade: **store default → category → product override** (a variant override can come later). Each level sets:
- maximum discount %
- auto-approve %
- an optional absolute price floor
- maximum rounds and expiry
- bundles allowed (yes/no)
- which channels it applies to

`termsFromPolicy()` in `packages/core` computes floor and auto-approve from the resolved policy. The UI is a table editor plus bulk edit by category, with a preview ("on ₹20,000 your agent drops to ₹19,000 alone, asks you below that"). The `policies` table gains `scope (store|category|product)`, `category_id` and `priority`.

### Seller verification (required before going live; tiered limits)
- **Identity:**
  - Individuals: PAN, plus Aadhaar via DigiLocker.
  - Businesses: GSTIN, checked against the GST register.
  - Both through a KYC provider's APIs (IDfy, Signzy or Karza class).
- **Bank account:** confirmed with a penny-drop that matches the name. This is also needed for Pine Labs settlement, since Pine Labs runs its own merchant KYC as the payment aggregator.
- **Store ownership:**
  - marketplace OAuth (Amazon/Flipkart)
  - a DNS TXT record or meta tag for websites
  - Shopify/Woo installation itself
  - phone OTP, plus a video or photo check of stock for GhostCart Shop-only sellers
- **Review:** an automated risk score plus a manual review queue in admin, which feeds the `audit_log`.
- **Tiers:**
  - **New:** order value cap, longer payout hold, approval required above X.
  - **Verified:** standard limits.
  - **Trusted:** after N delivered orders with low disputes, faster payouts.
- Store-name claims without ownership proof are no longer possible.

### Money held until delivery (corrected structure)
GhostCart does **not** hold funds itself. Pine Labs collects, and the seller's split is **settled on hold** at order creation.

**Released when delivery is confirmed:**
- a courier tracking event (via a shipping aggregator such as Shiprocket, or the seller entering the AWB number, verified through the aggregator's tracking API)
- or a delivery OTP the buyer reads to the courier
- or the buyer tapping "received"
- plus a **dispute window**, for example 48 hours to 7 days by category

**Auto-released** if there's no dispute and tracking shows delivered. **Refunded** through Pine Labs if the seller doesn't ship within the SLA, or a dispute is upheld.

GhostCart's fee split is released along with the seller's. The ledger records the hold, release, refund and reversal states. Settlement timing and hold limits go into the Pine Labs partner agreement. Running hosted shops also makes GhostCart an e-commerce marketplace under the Consumer Protection (E-Commerce) Rules 2020: show seller details, a grievance officer, a returns and refund policy, and no fake reviews or manipulative pricing.

### Fraud protection plan
| Threat | Controls |
|---|---|
| **Seller doesn't ship / fake tracking** | payout hold until verified delivery; ship-by SLA with auto-refund; tracking verified via aggregator API, not seller-typed status; penalties and suspension |
| **Counterfeit or not-as-described** | KYC and verified tier; category restrictions for new sellers (electronics and luxury need more proof); photos at dispatch; dispute flow with evidence; reserve held from repeat offenders |
| **Fake sellers / identity fraud** | PAN/GST/bank name-match; duplicate detection (same PAN, bank, phone or device across accounts); manual review for risky categories |
| **Buyer fraud** (chargebacks, "not received" lies, multiple accounts) | phone OTP; delivery OTP; device and IP fingerprinting; velocity limits per phone, device and address; buyer risk score; chargeback evidence pack (tracking + OTP + chat log) |
| **Collusion** (seller buys from themselves to farm trust or launder) | block payments where buyer phone, device or bank matches the seller's; anomaly alerts on self-referencing addresses; tier upgrades need distinct buyers |
| **Discount and price abuse** | single-use, product-locked, short-expiry grants; code sets every price (the LLM can't); rate limits on haggling; maximum open negotiations per buyer |
| **Bots and prompt injection** (widget, WhatsApp, Instagram) | rate limits + Turnstile-style challenge on the widget; the LLM only picks from moves the code has validated; free-text price extraction is bounds-checked |
| **Account takeover** | signed, revocable sessions; OTP throttles; re-authentication before changing payout bank details, with a payout cooling-off period after any change |
| **Operations** | a fraud dashboard (dispute rate, refund rate, holds, risk scores); a manual review queue; alerts; an audit log on every money action |

Fraud tables: `disputes`, `risk_scores`, `devices`, `holds`, `seller_tiers`, `shipments` (AWB, courier, events). Background jobs handle SLA timers, auto-release, auto-refund and risk rescoring.

## Long-lead items: start in week 0, in parallel (owned by the lead)
- Pvt Ltd company, GST and a current account. **This is the critical path**: Meta, DLT, Pine Labs, Apple and ONDC all need it.
- Pine Labs partner agreement + legal opinion on the split structure.
- Meta Business verification, then Tech Provider status (2–4 weeks).
- DLT entity and templates.
- Accounts: Shopify Partner, Apple (needs a D-U-N-S number) and Google developer.
- Applications: ONDC participant, Amazon Creators API (has sales thresholds), Flipkart Affiliate.
- Documents: privacy policy, seller data processing agreement, terms of service.
- Fix the GitHub billing lock (CI is blocked by it) and connect Vercel to GitHub.
- **Seller-side contracts and registrations:**
  - a KYC provider (PAN, GST, DigiLocker, penny-drop)
  - a shipping aggregator account (tracking API)
  - Amazon SP-API developer registration (public app approval) and Flipkart Seller API access, including checking their terms on using listing data off-platform
  - Pine Labs hold/release limits in the partner agreement
  - Consumer Protection (E-Commerce) Rules setup: grievance officer, returns and refund policy

## Waves (each usable on its own)
**Wave 0: foundations and hardening (about 2 weeks).** Makes the current app safe to keep public.
- Convert to the monorepo. Extract `packages/core` with its tests.
- Postgres + Drizzle v1 behind the existing `store` interface (`src/lib/store.ts`).
- Signed sessions, verified signup phone, ownership checks, remove the simulate mark-paid paths, rate limits (`@upstash/ratelimit`), audit log, admin RBAC.
- Remove from production: pitch, TTS and Kokoro (`src/app/pitch`, `api/pitch`, `api/tts`, `kokoro.ts`, `pitch.ts`).
- Put the mock gateway behind a non-production flag. Remove the Twilio sandbox until Wave 3.
- CI: Turborepo caching, a Neon branch per PR, Playwright smoke tests on Vercel previews.

**Wave 1: seller core + GhostCart Shop + universal widget + real payments (4–5 weeks).** Sellers with or without a website take haggled orders.
- Simple onboarding: phone OTP → how you sell → verify → discounts → live.
- **Seller verification:** KYC provider (PAN/GST/DigiLocker), bank penny-drop, ownership checks (DNS/meta tag; phone + stock photo for shop-only sellers), admin review queue, seller tiers and limits.
- **GhostCart Shop:** hosted storefront at `/s/<store>`, mobile-first product entry (photo, title, price, stock), CSV import, shareable links.
- **Policy cascade** (store → category → product: max discount %, auto-approve %, floor, rounds, expiry) with bulk editor and preview; `termsFromPolicy()` in `packages/core` (benchmark = list price).
- **Payout holds until delivery:** Pine Labs split settled on hold; seller enters AWB, verified through the shipping aggregator's tracking API; delivery OTP or "received" tap; dispute window; auto-release, auto-refund and ship-by SLA jobs.
- **Fraud v1:** velocity limits, device fingerprints, duplicate-identity checks, self-dealing blocks, dispute flow with evidence, fraud dashboard.
- Widget v1, then hosted checkout.
- Approvals: dashboard inbox, web push, and Vobiz calls (reusing `voice-calls.ts`, `voice-agent.ts`, `api/voice/*`).
- Pine Labs UAT then live: splits (seller-own account until the partner deal lands), webhooks, refunds, reconciliation, ledger, payout view.
- Order notifications and manual mark-shipped.

**Wave 2: marketplace sellers + Shopify + WooCommerce (3–4 weeks; Shopify review runs alongside Wave 3).**
- **Amazon and Flipkart sellers:** connect with the official seller APIs (SP-API OAuth, Flipkart Seller API) to import listings into their GhostCart Shop and prove account ownership in one step. CSV is the fallback. No scraping.
- **Shopify:** OAuth, product sync, theme app embed on product pages, discount-code grants, `orders/create` marking negotiations converted, billing, mandatory GDPR webhooks, uninstall cleanup.
- **Woo:** API-key settings, product-page button, coupon grants, order webhooks.

**Wave 3: WhatsApp + Instagram (about 3 weeks, gated on Meta verification).**
- Embedded Signup v4 so each seller connects their own number; the WhatsApp adapter; LLM extraction from free text (code still sets prices); approval and payment-link templates.
- Instagram DMs through the same Meta app.
- Fallback while Meta is pending: a BSP (Gupshup or Vobiz) behind the same adapter.

**Wave 4: consumer app + affiliate comparison + mobile (4–6 weeks).**
- Consumer web: browse and haggle across GhostCart sellers.
- Amazon/Flipkart through official affiliate APIs only: compare and link, with a commission disclosure and no rebates. Retire Firecrawl from the marketplace path.
- Expo app: shopper app plus seller one-tap approvals.
- Consumer data-protection duties (DPDP): consent records, data export and deletion, a grievance officer.

**Wave 5: ONDC + scale.** ONDC buyer app (staging, then pre-prod, then certification), load tests (k6), per-org data export, analytics warehouse, security controls.

## Team split (the lead assigns names)
| Workstream | Scope | Claude's role |
|---|---|---|
| A. Platform and security | monorepo, DB/migrations, auth, RBAC, rate limits, CI, observability | Leads most of it; a human reviews auth and migrations |
| B. Core + API + widget | `packages/core`, `/api/v1`, SSE, widget, agent | Leads the code and tests; a human owns widget UX and prompts |
| C. Payments and money | Pine Labs splits, ledger, reconciliation, billing, GST | Writes code and tests; **a human owns** the partner relationship, UAT sign-off and every ledger review |
| D. Integrations | Shopify, Woo, then Meta and ONDC adapters | Scaffolds and implements; a human handles Partner dashboards and review submissions |
| E. UX + mobile | dashboard, onboarding, approvals inbox, consumer web, Expo | Builds from specs; a human owns design, store listings and device QA |
| Lead | company, external applications, architecture, release gates | Drafts policies and checklists |

## Reuse, refactor, delete
- **Extract unchanged, with their tests:** `haggle.ts`, `format.ts`, the pure parts of `checkout.ts`, `deal-desk.ts`, `insights.ts`. Split `types.ts` into core types and web DTOs.
- **Refactor:** `negotiate.ts` becomes a core state machine (`submitOffer`, `acceptOffer`, `decideApproval`, `counterFromApprover`) plus web orchestration. `markPaid` moves to `packages/payments` and becomes webhook-only.
- **Reuse:** `pinelabs.ts`, `vobiz.ts`, `voice-*.ts`, `otp.ts`. `agenticorg.ts` and `api/mcp` are scoped per org (off the hackathon tenant). The admin and analytics UI. `haggle-room` and `checkout-panel` become the hosted checkout and widget reference.
- **Delete:** pitch, TTS and Kokoro, the simulate paths, the admin-click stages in `fulfilment.ts`, the Twilio sandbox, and the in-memory store (use a local or branch Postgres instead).
- **Redis to Postgres:** add the Postgres store implementation; dual-write behind a flag for about a week; backfill live deals, users and sellers; switch reads over; reduce Redis to sessions, rate limits and locks. Export the hackathon activity log as proof first. Hackathon sellers re-onboard through the verified flow.

## Verification
- **Every PR:** CI (types, lint, vitest, build), plus Playwright smoke tests (login, negotiate, approve) on the Vercel preview against a Neon branch.
- **Wave 0:** a regression test for each security fix (cookie signing, checkout ownership, simulate removal, rate limits).
- **Wave 1:**
  - Property tests on core (fast-check): no move ever goes below the floor; nothing goes past the auto-approve price without an approval event.
  - Contract tests for `/api/v1`.
  - Pine Labs UAT end to end: pay, webhook, split, refund, reconciliation with zero difference.
  - Widget tests on three host pages: strict CSP, Shopify-like, plain HTML.
  - Policy cascade tests: a product override beats category, which beats the store default.
  - KYC sandbox flows (pass, fail, name mismatch) and tier limits enforced.
  - Hold lifecycle against Pine Labs UAT: hold, then delivery event, then release; plus SLA breach → refund, and an upheld dispute → refund.
  - Fraud rules tested with fixtures: self-dealing blocked, velocity limits hit, duplicate PAN flagged.
- **Wave 2:**
  - Shopify dev store: install, sync, haggle; the code redeems exactly once, then fails when expired or used on the wrong product.
  - WooCommerce in Docker in CI.
- **Wave 3:** Meta test numbers and a test Instagram account; replayed webhook fixtures.
- **Wave 4:** Expo EAS builds with Maestro flows; check that affiliate pages show the disclosure and no rebate wording.
- **Wave 5:** ONDC log validation; k6 load tests.
- **Release gates for every wave:** the ledger balances (entries sum to zero per order), and a real ₹1 transaction succeeds on production.

## Risks and open decisions
- **Risks:**
  - The Pine Labs split agreement could take a long time or be refused. Mitigation: launch on seller-own accounts.
  - Meta and Shopify review delays.
  - Discount-code leakage. Mitigation: single-use, product-locked, short expiry, revoked by cron.
  - Prompt injection over WhatsApp/Instagram. Mitigation: the LLM only ever picks from moves the code has already validated.
  - The consumer app is weaker without cashback, so validate demand before building mobile in full.
  - Buyer-facing calls need recorded consent.
- **Decide later:**
  - Better Auth vs Auth.js.
  - WhatsApp: BSP first or Meta Tech Provider first.
  - Pricing unit: per accepted negotiation or a percentage of the discount saved.
  - WordPress.org listing vs direct download for the Woo plugin.

## First steps after approval
1. Merge PR #3 (docs) and PR #4 (CI); update `docs/ROADMAP.md` to this plan.
2. The lead starts the long-lead track (company, Pine Labs, Meta, DLT, developer accounts).
3. Claude opens the Wave 0 PRs in order: monorepo conversion, extract `packages/core`, Drizzle + Neon behind `store`, security hardening (sessions, ownership, rate limits, RBAC), production cleanup (pitch and mock behind a flag).
