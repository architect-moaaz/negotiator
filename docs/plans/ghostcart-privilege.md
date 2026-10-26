# GhostCart Privilege: turning abandoned carts into private haggles

GhostCart is our first product in a super-commerce stack: a buyer–seller negotiation layer that runs on
every surface where people buy (GhostCart Shop, Shopify, WooCommerce, chat apps, ONDC, and the carts
shoppers bring from marketplaces). **Privilege** is how an abandoned cart becomes a deal: the shopper
gets a private, time-limited invitation to make the seller an offer on exactly what they left behind.

## Principles (from CLAUDE.md, applied here)

- **Seller's margin, seller's rules.** Recovery discounts come only from the seller's own policy. Code
  sets every price; the agent only talks. Floors and auto-approve limits are enforced server-side.
- **Consent first.** On-site prompts need no contact details. Email, WhatsApp and calls go only to
  shoppers who opted in to recovery offers (`recovery_offers` consent), within 09:00–21:00 IST, with a
  one-tap way to stop.
- **No reading carts we weren't given.** Installed stores (Shopify, Woo, GhostCart Shop) share their
  carts with GhostCart because the seller installed us. Marketplace carts (Amazon, Flipkart, others) only
  arrive when the shopper brings them (screenshot or links). No scraping, no extensions reading pages,
  no affiliate tags touched, no marketplace API data used to divert shoppers.
- **Honest copy.** No fake urgency. Invites state the real expiry. Test data is `ZZ`-prefixed.

## Flow

```
cart captured ─┬─ on-site: shopper clicks "Make an offer on your cart" (widget cart mount, exit prompt)
               └─ abandoned checkout with recovery consent (Shopify webhook, Woo plugin, lapsed GhostCart checkout)
      → cart row (open) → abandoned after the seller's delay → invite (email / WhatsApp / voice)
      → /p/<token> Privilege page → sign in (phone code) → bundle haggle on the cart
      → seller agent within limits → escalations to the seller (dashboard, phone, AgenticOrg recommends)
      → single-use code for the whole cart → seller's own checkout → order reported → recovered (fee due)
```

## Phase 1: Privilege on installed stores

| Wave | What |
| --- | --- |
| 1.1 Core | Recovery policy fields (store level): `recoveryEnabled`, `recoveryMaxDiscountPct`, `recoveryAutoApprovePct`, `recoveryDelayMinutes`. `cartTerms(lines)`: bundle limits = sum of each line's limits (floors never cross products). Property tests. |
| 1.2 Data | Migration 0017: `carts` (lines jsonb, contact, consent, status open → abandoned → invited → negotiating → recovered / expired / opted_out), `cart_invites` (channel, token hash, status), products `brand`, `gtin`, `model_number`. |
| 1.3 Bundle deals | `Deal.cart` (cart id + lines); `startCartNegotiation`; grants for several lines (Shopify discount on the cart's products + multi-line cart permalink; Woo `fixed_cart` coupon restricted to the cart's products + multi-item add-to-cart; mock). |
| 1.4 Capture | Widget cart mount (Shopify `/cart.js`, Woo Store API `/wp-json/wc/store/v1/cart`) → `POST /api/v1/widget/cart`; optional exit prompt (seller toggle, once per session). Shopify cart block + `CHECKOUTS_CREATE/UPDATE` webhook; orders complete carts. Woo plugin: cart mount, recovery-consent checkbox, checkout report, order completes cart. Shopify checkout contact only behind `SHOPIFY_CHECKOUT_CONTACT` (Protected Customer Data + legal). GhostCart Shop lapsed checkouts: deferred (those shoppers already hold an agreed deal; bundles there wait for multi-item shop checkout). |
| 1.5 Privilege page | `/p/[token]`: the cart, the seller, "Make an offer"; sign-in inline; stop link. |
| 1.6 Recovery job | `/api/cron/recovery`: mark abandoned after the delay, send invites per channel with consent + quiet hours, expire old carts. |
| 1.7 Seller + admin | Seller "Cart recovery" settings and stats; admin analytics recovery funnel. |

## Phase 2: Channels

| Wave | What |
| --- | --- |
| 2.1 Email | `lib/email` with a Resend HTTP transport (mock in dev/tests), invite template. Env: `RESEND_API_KEY`, `EMAIL_FROM`. |
| 2.2 WhatsApp | Template sends (Cloud API and Gupshup) for the invite outside the 24h window. Env: `WHATSAPP_PRIVILEGE_TEMPLATE`. |
| 2.3 Voice | Vobiz invite call: reads the store and cart total, "press 1 to get your private offer link" (sent by WhatsApp or email), "press 9 to stop". Signed callbacks. |
| 2.4 Opt-out | Stop link, STOP reply, press 9; recorded as a consent withdrawal. |

## Phase 3: Rescue my cart (marketplaces)

| Wave | What |
| --- | --- |
| 3.1 Catalogue identity | Sync brand, barcode/GTIN and model from Shopify and Woo; editable in the seller catalogue. |
| 3.2 Matching | Same item (GTIN or brand + model tokens) before similar (title words), cheapest first, live haggle-enabled stores only. |
| 3.3 `/rescue` | Shopper uploads a cart screenshot (read by the vision model) or pastes product links (only the link text is used, never fetched). Each item shows GhostCart sellers' offers; picking them builds a cart per store and opens its Privilege page. |
| 3.4 Ops | Analytics, docs (`docs/api.md`, ROADMAP), e2e scenarios. |

## Open items for the team

- Shopify: confirm `read_orders` covers checkout webhooks on API 2026-07, and request Protected Customer
  Data access before using buyer email/phone from checkouts.
- Meta: an approved WhatsApp template for the invite; DLT for any SMS.
- TRAI: confirm with Vobiz the number series and consent rules for invite calls.
- Pick the email provider account (Resend assumed) and sending domain.
