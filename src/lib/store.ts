import type { Deal, TickerEvent } from "./types";

// In-memory store for the hackathon. Swap for Redis/Upstash/Supabase before deploying to serverless.
const deals = new Map<string, Deal>();
const ticker: TickerEvent[] = [];
const listeners = new Set<(e: TickerEvent) => void>();

export const store = {
  saveDeal(deal: Deal) {
    deals.set(deal.id, deal);
    return deal;
  },
  getDeal(id: string) {
    const deal = deals.get(id);
    if (deal && deal.status === "pending" && Date.now() > deal.expiresAt) {
      deal.status = "expired";
    }
    return deal;
  },
  pushTicker(event: TickerEvent) {
    ticker.unshift(event);
    ticker.length = Math.min(ticker.length, 50);
    listeners.forEach((fn) => fn(event));
  },
  recentTicker() {
    return ticker;
  },
  subscribe(fn: (e: TickerEvent) => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
