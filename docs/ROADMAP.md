# GhostCart roadmap

**Direction: B first, then A.**

- **B: seller negotiation agent.** D2C brands and online sellers put GhostCart's haggling agent on their own website and WhatsApp. It negotiates within the margin the seller sets, escalates bigger discounts to the seller (dashboard or phone call), and turns hesitant visitors into orders. Seller-funded, no marketplace scraping, recurring revenue.
- **A: consumer deal-finder.** The app we demoed, brought back once enough sellers are on GhostCart, so shoppers haggle with real sellers instead of scraped marketplace prices.

## Phase 0: foundations (week 1)

- [ ] Company: Udyam registration now, Pvt Ltd when we raise or invoice at scale
- [ ] Real Pine Labs merchant account (replace the mock gateway); settlement to the company account
- [ ] Vobiz: KYC, business number, DLT registration for calls and any SMS
- [ ] Privacy policy and terms under India's DPDP Act 2023; consent records already exist
- [ ] Rotate every key shared during the hackathon
- [ ] Repo: branch protection on `main`, Vercel ↔ GitHub (production on merge, preview per PR)
- [ ] Clean hackathon test data from production (export the proof CSVs first)

## Phase 1: seller MVP (weeks 2–3)

- [ ] **Embeddable "Make an offer" widget** for any store: one script tag, product id and price from the page
- [ ] **WhatsApp entry** per seller (approved business number and message templates)
- [ ] **Catalogue import:** CSV first, then Shopify app
- [ ] **Per-product rules:** floor, auto-approve share, max rounds, bundles instead of discounts
- [ ] Seller website domains as match keys (so listings on their own site route to them)
- [ ] Seller-funded lowballs: after a few rounds, let the seller decide even below their floor
- [ ] End the dead-end loop: after repeated holds, the agent says it plainly and suggests an alternative
- [ ] Seller dashboard: conversion lift, discount given, revenue recovered; CSV export
- [ ] Retire marketplace scraping in the seller flow (catalogue data only)

## Phase 2: pilots (week 4)

- [ ] 3–5 pilot sellers (first lead: RK World Infocom), free in exchange for data
- [ ] Measure: offers made, conversion vs. no-haggle baseline, average discount, time to approve
- [ ] Case study with real numbers; pricing (monthly fee plus a small share of recovered sales)

## Phase 3: platform (month 2+)

- [ ] Postgres for orders, sellers and billing (Redis stays for sessions and rate limits)
- [ ] Roles and audit log for seller teams; per-seller usage metering
- [ ] Monitoring and alerts (errors, failed calls, payment webhooks)
- [ ] ONDC seller-app or buyer-app integration as a distribution channel
- [ ] Bring back the consumer app (A) on top of the seller network

## Open questions

- Affiliate programmes' rules on passing commission back to buyers (decides how A is funded)
- Payment flow: does GhostCart collect and settle (marketplace and payment-aggregator rules), or does the seller collect directly through their own Pine Labs account?
- Who owns what: proposed split in the team kickoff
