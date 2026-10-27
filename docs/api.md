# GhostCart API (v1)

One negotiation API for every channel: a seller's own site or app, a chat integration, or a partner. GhostCart runs the agent, the seller's discount limits and approvals exactly as on its own pages. **Code sets every price**; free text is only read for a number or a yes.

Authenticate with the store's **secret key** (seller dashboard → Integrations): `Authorization: Bearer gc_sk_…`. Prices are whole rupees. Use the typed client in `packages/sdk` (`@ghostcart/sdk`).

## Negotiate

| Call | What it does |
| --- | --- |
| `POST /api/v1/sessions` `{ product, shopper: { id }, city? }` | Start a session on a product (SKU or GhostCart id) for your shopper. Returns the agent's opening offer. |
| `GET /api/v1/sessions/:id` | The session now. |
| `POST /api/v1/sessions/:id/offers` `{ amount }` or `{ text }` | The shopper's offer. `text` is the shopper's own words (any language mix): we find a price or a yes; 422 if neither. |
| `POST /api/v1/sessions/:id/accept` | Take the current offer. The response says how to pay: `grant` (single-use code on Shopify/WooCommerce) or `payment` (UPI lock fee, then GhostCart checkout). |
| `GET /api/v1/sessions/:id/events` | Server-sent events, one per step: `started`, `offer`, `counter`, `hold`, `final`, `escalated`, `approved`, `rejected`, `countered`, `agreed`, `paid`, `ordered`. Each stream lasts about 50 s; reconnect with `Last-Event-ID` (EventSource and the SDK do this) to continue. |
| `POST /api/v1/approvals/:id/decision` `{ decision: "approved" \| "rejected" \| "counter", price?, by? }` | The seller's decision on an offer waiting for approval. A counter must sit between the shopper's offer and the list price, and above the seller's floor. |

Errors are `{ "error": "…" }` with 400 (bad input), 401 (key), 404 (not this store's session or product), 409 (the deal moved on or changed concurrently: reload and retry), 422 (no price in the text), 429 (rate limit).

## Catalogue and orders

`GET/POST /api/v1/products` (upsert by SKU, up to 500 at a time) and `GET /api/v1/orders?status=placed,shipped`. Webhooks to the seller are signed (dashboard → Integrations).

## GhostCart Privilege (abandoned carts)

| Call | Auth | What it does |
| --- | --- | --- |
| `POST /api/v1/woocommerce/checkouts` `{ externalRef, items: [{ ref, quantity }], email?, phone?, name?, consent, returnUrl? }` | secret key | A checkout placed by a shopper who ticked the private-offer box. Contact details are kept only with `consent: true`. Send `{ externalRef, completed: true }` once it's paid. |
| `POST /api/v1/widget/cart` `{ key, cartRef?, items: [{ ref, quantity }], returnUrl? }` | publishable key, allowed origin | The cart shown on the seller's cart page (anonymous). Answers `{ available, listTotal, exitPrompt, url }`; `url` opens a private offer on the whole cart. |

Items are named as in the catalogue: GhostCart product id or the synced SKU (`shopify-<id>`, `woo-<id>`). Prices always come from the catalogue, never from the request. Shopify checkouts arrive through the `checkouts/create|update` webhooks. Seller settings live at `/api/seller/stores/:id/recovery`. Design and channel rules: [plans/ghostcart-privilege.md](plans/ghostcart-privilege.md).

Products also take optional `brand`, `gtin` (EAN/UPC; an invalid one is dropped) and `modelNumber`, which let shoppers find the exact item through Rescue my cart (`/rescue`).

## Example

```ts
import { GhostCart } from "@ghostcart/sdk";

const gc = new GhostCart({ secretKey: process.env.GHOSTCART_SECRET_KEY! });
const s = await gc.sessions.create({ product: "SKU-1", shopper: { id: "cust_42" } });
const next = await gc.sessions.offer(s.id, { text: "can you do 1200?" });
console.log(next.reply);
for await (const e of gc.sessions.events(s.id)) if (e.type === "agreed") break;
```
