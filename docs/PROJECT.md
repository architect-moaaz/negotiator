# GhostCart — AI Cart Hijacker & Dynamic Deal Counter

## Pitch
Shoppers submit any **product URL, cart screenshot, or wishlist link** (via a public web link or WhatsApp).
The agent instantly:

1. **Scrapes** the exact item and checks stock/pricing across alternative sellers in real time.
2. **Generates a live 3-minute discount invoice**: a dynamic Pine Labs / Razorpay UPI payment link, funded by
   a small sub-commission or a bundled add-on (e.g. "Pay within 180s via UPI → ₹200 off + free shipping").
3. **Broadcasts micro-social proof** on a public dashboard ticker
   ("Someone in Bengaluru just grabbed Nike Air Force 1s for ₹4,200 instead of ₹5,500").

## Why it beats standard LLM ideas
- Not a chat UI: scraping + real-time price arbitrage + live countdown payment terminal.
- Turns a multi-step checkout into a ~10-second impulse buy.
- Built-in viral loop: gamified flash deals on things people already planned to buy.

## Event goal
**20 real users on Oct 24 before 7:30 PM.**
- Landing page + WhatsApp QR: "Paste any item you want to buy today. Our AI will find a flash UPI deal in 60 seconds."
- Walk the venue (~500 builders ordering Swiggy/Zomato, tech accessories, Amazon/Flipkart).
- Process 20 real micro-purchases or simulated UPI checkouts in front of them.

## Stack
| Layer | Choice |
| --- | --- |
| Frontend | Next.js 16 (App Router, cacheComponents) + Tailwind 4: dark ink UI, deal shown as a thermal receipt |
| Agent | Vercel AI SDK 7 + Claude (`GHOSTCART_MODEL`): product extraction (page text or screenshot) + live haggle narration |
| Pricing | Deterministic `computeOffer` (cheapest in-stock seller − min(5%, ₹200)); the LLM never sets numbers |
| Scraping | Firecrawl `product` format + `search` across Indian retailers (plain fetch fallback) |
| Payments | Pine Labs Online UPI intent (UAT): token **deal-lock fee** (`DEAL_LOCK_FEE_INR`, default ₹9) |
| Storage | Upstash Redis on Vercel (`KV_REST_API_*`), in-memory fallback locally |
| Messaging | Twilio WhatsApp sandbox |

## Flow
```
POST /api/negotiate {url | imageBase64}  → NDJSON stream
   step → product → quotes → haggle deltas → offer → deal
   (scrape/extract → findAlternatives → computeOffer → streamHaggle → Pine Labs UPI order → Redis)
/deal/[id]  180s countdown + UPI QR; polls GET /api/deal?id= every 3s
   → server checks Pine Labs order status (PROCESSED/AUTHORIZED ⇒ markPaid ⇒ ticker + stats)
/dashboard  polls GET /api/ticker: N/20 locked deals, total saved, live feed
WhatsApp    /api/webhooks/whatsapp: instant TwiML ack, after() runs the same pipeline, replies with deal link
Pine Labs   /api/webhooks/pinelabs: signed ORDER_PROCESSED backup to polling
```

## Layout
```
src/lib/negotiate.ts                pipeline shared by web + WhatsApp, markPaid
src/lib/agent.ts                    Claude extraction, computeOffer, streamHaggle
src/lib/scrape.ts                   Firecrawl scrape + alternative sellers
src/lib/pinelabs.ts                 token cache, UPI order/intent, status, webhook signature
src/lib/payments.ts                 deal-lock payment (Pine Labs → static VPA fallback)
src/lib/store.ts                    Redis / in-memory deals, ticker, stats
src/app/page.tsx                    landing + live negotiation slip
src/app/deal/[id]/page.tsx          countdown invoice terminal
src/app/dashboard/page.tsx          venue screen
```

## Notes
- Pine Labs has no order expiry field; the 180s window is enforced by the app, and status is still checked for 30s after expiry so last-second payments count.
- Pine Labs configures webhook URLs via support, so polling is the primary payment signal.
- `DEMO_SIMULATE=1` shows a "Simulate UPI payment" button (also shown automatically when no QR could be generated).
