# GhostCart roadmap

Direction: **seller negotiation agent first, consumer app second.** The full plan covers architecture, seller onboarding and verification, payout holds, fraud protection, the team split and verification. It's in [PRODUCT_PLAN.md](PRODUCT_PLAN.md).

## Waves (each usable on its own)

| Wave | What ships | Est. |
|---|---|---|
| **0. Foundations** | Monorepo, `packages/core`, Postgres + Drizzle behind `store`, signed sessions, ownership checks, rate limits, admin RBAC + audit log, pitch/mock out of production, Playwright smoke on previews | ~2 wks |
| **1. Seller core** | Simple onboarding; **seller verification** (KYC, bank, ownership, tiers); **GhostCart Shop** for sellers without a website; per-product/category discount rules; universal widget; hosted checkout; real Pine Labs with **payout held until delivery**; approvals (dashboard, push, voice); fraud v1 | 4–5 wks |
| **2. Marketplace sellers + Shopify + Woo** | Amazon/Flipkart sellers connect via official seller APIs (import listings, prove ownership); Shopify app (discount-code grants, billing); WooCommerce plugin | 3–4 wks |
| **3. WhatsApp + Instagram** | Each seller's own WhatsApp number (Meta Embedded Signup); Instagram DMs; BSP fallback while Meta verification is pending | ~3 wks |
| **4. Consumer app + mobile** | Shoppers haggle across GhostCart sellers; Amazon/Flipkart price comparison via affiliate APIs (no cashback); Expo apps for shoppers and seller approvals | 4–6 wks |
| **Privilege + Rescue** | GhostCart Privilege: abandoned carts on Shopify, Woo and GhostCart Shop become one private, consented haggle on the whole cart (email, seller's WhatsApp, Vobiz call), paid from the seller's margin. Rescue my cart: shoppers bring a marketplace cart (links or a screenshot) and haggle with GhostCart sellers on the same items. [Plan](plans/ghostcart-privilege.md) | built on `feat/cart-privilege` |
| **5. ONDC + scale** | ONDC buyer app certification; load tests; data export; analytics warehouse | ongoing |

## Long-lead items: start now (lead)

- [ ] Pvt Ltd company, GST, current account (critical path for everything below)
- [ ] Pine Labs partner agreement: split settlements, hold/release limits, sub-merchant onboarding, plus a legal opinion
- [ ] Meta Business verification, then Tech Provider; DLT entity and templates
- [ ] Shopify Partner, Apple (D-U-N-S), Google developer accounts
- [ ] KYC provider, shipping-aggregator tracking API, Amazon SP-API and Flipkart Seller API access (check terms)
- [ ] ONDC registration; Amazon Creators API and Flipkart Affiliate applications
- [ ] Privacy policy (DPDP), seller DPA, terms, returns/refund policy, grievance officer
- [ ] Unlock GitHub billing (CI) and connect Vercel ↔ GitHub

## Rules that don't change

No scraping or bot-check workarounds. Code sets every price and the LLM only talks. Humans approve beyond the agent's limits. GhostCart never holds buyer money (Pine Labs does). Honest UI copy. Secrets never in the repo or chat. See [CLAUDE.md](../CLAUDE.md).
