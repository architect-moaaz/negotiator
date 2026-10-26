# ONDC buyer app

GhostCart joins ONDC as a **buyer app (BAP)**. Shoppers searching on GhostCart also see sellers from the network, get a quote for their pincode, and order. The seller app delivers and collects payment.

## How it fits together

| Piece | Where |
| --- | --- |
| Signing: Ed25519 over BLAKE2b-512 of the body, `Authorization: Signature keyId="sub|ukId|ed25519"…` | `apps/web/src/lib/ondc/crypto.ts` |
| Registry lookup of a seller app's key (cached an hour; a fresh lookup if it fails to verify) | `lib/ondc/registry.ts` |
| Outgoing requests (`search`, `select`, `init`, `confirm`), all logged | `lib/ondc/client.ts`, `lib/ondc/buyer.ts` |
| Callbacks (`/api/ondc/on_search`, `on_select`, `on_init`, `on_confirm`, `on_status`, …): signature must match the context's `bpp_id`, and the transaction must be ours | `lib/ondc/inbound.ts`, `app/api/ondc/[action]` |
| Registry onboarding: `/api/ondc/on_subscribe` challenge (X25519 + AES-256-ECB), `/ondc-site-verification.html` | same route, `app/ondc-site-verification.html` |
| Shopper API, polled because answers are asynchronous | `app/api/ondc-buyer/[step]` |
| Search UI ("From sellers on ONDC") | `components/ondc-results.tsx` |
| Message log, also used as the working state | `ondc_messages` table |
| Mock network for development and tests (registry, gateway, one seller app) | `app/api/mock-ondc` |

## Payments

GhostCart only takes orders where the **seller app collects payment** (`collected_by: BPP`). Buyer-app collection would mean holding buyers' money and settling with each seller app under the network's settlement framework. That needs the Pine Labs split agreement and an ONDC settlement setup first. Until then, sellers that only accept buyer-app collection are shown with a clear message instead of a Place order button.

## Onboarding (lead)

1. Register on the ONDC portal as a buyer app for the retail domain (`ONDC:RET10` to start).
2. Generate keys with ONDC's key utility: Ed25519 for signing, X25519 for encryption. Put them in Vercel as the `ONDC_*` variables (see `.env.example`).
3. Set `ONDC_SITE_REQUEST_ID` and check that `https://<domain>/ondc-site-verification.html` serves the signed tag. Then subscribe; the registry calls `/api/ondc/on_subscribe`.
4. Run staging flows with the ONDC log validation utility, using the `ondc_messages` rows as the logs. Then pre-prod, then certification.

## Known gaps before certification

- After the order, shoppers can refresh status, track, contact the seller's support, cancel with a network reason code, request an item return (`update`), and raise and follow an IGM 1.0 issue (`issue`, `issue_status`). Partial cancellation and the seller-initiated side of returns (pickup scheduling, QC) still come from the seller app's own callbacks.
- Fulfillment GPS is a city centre. A pincode-to-GPS lookup would be more accurate.
- Search runs on the shopper's query only, with no category or location filters yet.
- Real BPPs answer `on_search` in pages. We keep everything that arrives within the polling window.

## Selling on ONDC (seller app) instead

GhostCart Shop sellers could be listed on ONDC by GhostCart acting as a seller app (BPP), returning the haggled price as the quote in `on_select` / `on_init`. The signing, registry and callback code here is the same on both sides. That's a separate decision for the lead.
