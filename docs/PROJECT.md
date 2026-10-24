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
| Frontend | Next.js (App Router) + Tailwind, dark luxury/fintech dashboard |
| Agent | Vercel AI SDK + Claude (`GHOSTCART_MODEL`) — URL/screenshot parsing, spec & price extraction |
| Scraping | Firecrawl (Playwright fallback if needed) |
| Payments | Razorpay payment links / UPI QR (Pine Labs Plural as alternative) |
| Messaging | Twilio WhatsApp sandbox webhook |

## Flow
```
input (URL | screenshot | wishlist) ─► /api/deal
   ├─ scrape (Firecrawl) ─► extract product (Claude, structured output)
   ├─ find alternatives / price comparison
   ├─ compute offer (discount or bundle) ─► deal { id, expiresAt = now + 180s }
   └─ create payment link (Razorpay / UPI QR)
deal page /deal/[id] ─► countdown + QR ─► webhook /api/webhooks/payment ─► ticker event
dashboard /dashboard ─► live ticker (SSE from /api/ticker)
WhatsApp ─► /api/webhooks/whatsapp ─► same /api/deal pipeline ─► reply with deal link
```

## Layout
```
src/app/page.tsx                    landing: paste URL / upload screenshot + WhatsApp QR
src/app/deal/[id]/page.tsx          countdown payment terminal
src/app/dashboard/page.tsx          public live ticker
src/app/api/deal/route.ts           POST: run agent pipeline, create deal
src/app/api/checkout/route.ts       POST: create/refresh payment link for a deal
src/app/api/ticker/route.ts         GET: SSE stream of ticker events
src/app/api/webhooks/whatsapp/      Twilio inbound
src/app/api/webhooks/payment/       Razorpay payment.captured
src/lib/                            agent, scrape, payments, whatsapp, store, types
```
