# Growth plan: from built to earning

GhostCart has the engine (haggle, approvals, payments with payout holds, ledger, KYC, shops,
Shopify/Woo, chat, ONDC, Privilege, Rescue). This plan closes the gaps between that code and a business
sellers pay for and shoppers come back to. Same rules as always: code sets every price, humans approve
beyond limits, consent before contact, honest copy, `ZZ` test data, no scraping.

Order is by value per effort. Each wave ships on its own and is a commit on `feat/growth`.

## G0 Launch production (needs the lead)

Production still runs the hackathon build. Steps: Neon from the Vercel Marketplace (lead), `db:migrate`,
production env (`STORE_MODE=redis`, `CRON_SECRET`, `SECRETS_KEYS`, `STAFF`), Vercel Root Directory
`apps/web`, preview deploy and smoke test, promote, then the Redis → Postgres cutover in
`docs/database.md`. Code part: `pnpm --filter @ghostcart/web launch:check`, a read-only preflight that
lists missing env and unapplied migrations, and `docs/launch.md`.

## G1 Shopper order updates

Buyers hear about every order step on the channels they agreed to: WhatsApp (Utility template from
GhostCart's own number), email, and app push (already built). Placed, shipped (courier + tracking),
out for delivery, delivered (with "report a problem"), refunded or cancelled. Each update once per order
and step. Covered by the deal-contact consent shoppers give at sign-up ("about this deal. No marketing").
Env: `WHATSAPP_ORDER_PHONE_ID`, `WHATSAPP_ORDER_TOKEN` (or Gupshup), `WHATSAPP_ORDER_TEMPLATE`.

## G2 Shipping: one-click pickup

Seller presses "Book pickup": Shiprocket creates the shipment, assigns a courier and AWB, schedules
pickup and returns a label; the order moves to shipped with tracking already on. Manual AWB entry stays as
a fallback. Mock in development. Env: `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`, pickup location per
store.

## G3 Seller results and public pricing

- Seller "Results": haggles started, deals agreed, conversion, sales through GhostCart, average discount
  given, GhostCart fees, and what the seller kept, per period. Discounts are shown as cost, honestly.
- `/pricing`: what GhostCart costs (fee per sale from `PLATFORM_FEE_BPS` + GST, nothing up front, no
  subscription), how payouts and holds work. Linked from the seller sign-up.

## G4 Price-drop alerts

"Tell me if the price drops to ₹X" on product pages. Fires on the seller's listed price only, never on
their private haggle limits (those are never revealed). One alert per shopper per product, expires in 60
days, sent by the shopper's chosen channel. Stop link in every alert.

## G5 Hindi

Shopper screens (home, search, product, haggle, checkout, order, Privilege, Rescue) in English and
Hindi with a language switch remembered per browser; the agent answers in the shopper's language.
Dictionary-based so more languages (Tamil, Telugu, Kannada, Marathi, Bengali) drop in later.

## G6 Self-serve returns

Within the store's return window after delivery, the buyer asks to return (reason, photos). The seller
accepts (reverse pickup through Shiprocket, or the seller arranges it) or declines with a reason (the
buyer can then raise a dispute). The refund runs from the held payout when the item is back. Return
policy per store, shown on product pages (E-Commerce Rules).

## G7 Reviews from verified buyers

After delivery, the buyer rates the product and store (1–5, optional text and photo). Only buyers of a
delivered order can review, once per order. Shown on product and store pages with counts; sellers can
reply; staff can hide abusive ones (logged). No incentives for reviews and no editing of ratings.

## G8 Stock that can't oversell

A GhostCart sale reduces stock at once, and pushes the change to the seller's Shopify
(`inventoryAdjustQuantities`, needs `write_inventory`) or WooCommerce (plugin route). Cancelled and
refunded orders put it back.

## G9 Seller automation

- Approval rules: "approve automatically when the offer is at least ₹X" or "within Y% of list", per
  store or product, always above the floor; time windows ("weekends", "after 9pm").
- Playbook: weekly suggestions from the seller's own haggles ("you lost 12 deals between 5% and 8% on
  Kurtas; raising the agent's limit to 8% would have closed most"). Pure core function, suggestions
  only, the seller applies them.

## G10 Growth loops

- Referrals: each shopper gets a code; sign-ups through it are attributed and shown. Rewards are a
  business decision (GhostCart-funded credit vs none), so attribution ships first, rewards off.
- Promoted listings: sellers pay to rank higher in search, marked "Sponsored". Ships as a staff-set
  boost with a clear label; self-serve bidding later.

## G11 Trust and operations

- Chargeback evidence pack: one download per order (payment, address, tracking events, handover or
  "received" confirmation, chat log, consent records) for responding to bank disputes.
- Support queue: grievances and disputes in one inbox with due times (E-Commerce Rules: acknowledge in
  48 hours, resolve in a month), saved replies, assignment.
- Experiments: sticky A/B assignment per shopper, results by conversion, for copy and the agent's
  opening position (always inside the seller's limits; code still sets every price).

## Not in code (lead)

Company and GST; Pine Labs partner agreement; Meta verification and the order-update template;
Shiprocket account; KYC provider; Resend domain; decisions on referral rewards and promoted-listing
pricing.
