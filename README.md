# GhostCart

AI "Cart Hijacker & Dynamic Deal Counter" — paste a product link, get a 3-minute flash UPI deal.
See [docs/PROJECT.md](docs/PROJECT.md) for the full brief, flow and event-day GTM.

## Setup
```bash
pnpm install
cp .env.example .env.local   # fill in keys
pnpm dev
```

Without Razorpay keys, checkout falls back to a static UPI QR (`UPI_FALLBACK_VPA`) and
`POST /api/checkout` simulates payment for demos.
