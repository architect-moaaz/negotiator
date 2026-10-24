import { Redis } from "@upstash/redis";
import type { Deal, Stats, TickerEvent } from "./types";

const DEAL_TTL_S = 60 * 60;
const TICKER_MAX = 50;

const redis =
  process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
    ? new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN })
    : null;

// In-memory fallback for local dev without Redis. Not shared across serverless instances.
const mem = {
  deals: new Map<string, Deal>(),
  ticker: [] as TickerEvent[],
  stats: { deals: 0, paid: 0, saved: 0 } as Stats,
};

function withExpiry(deal: Deal | null | undefined) {
  if (deal && deal.status === "pending" && Date.now() > deal.expiresAt) deal.status = "expired";
  return deal ?? undefined;
}

export const store = {
  async saveDeal(deal: Deal) {
    if (redis) await redis.set(`deal:${deal.id}`, deal, { ex: DEAL_TTL_S });
    else mem.deals.set(deal.id, deal);
    return deal;
  },

  async getDeal(id: string) {
    const deal = redis ? await redis.get<Deal>(`deal:${id}`) : mem.deals.get(id);
    return withExpiry(deal);
  },

  async pushTicker(event: TickerEvent) {
    if (redis) {
      await redis.lpush("ticker", event);
      await redis.ltrim("ticker", 0, TICKER_MAX - 1);
    } else {
      mem.ticker.unshift(event);
      mem.ticker.length = Math.min(mem.ticker.length, TICKER_MAX);
    }
  },

  async recentTicker(limit = 20): Promise<TickerEvent[]> {
    if (redis) return redis.lrange<TickerEvent>("ticker", 0, limit - 1);
    return mem.ticker.slice(0, limit);
  },

  async incrStats(delta: Partial<Stats>) {
    for (const [key, by] of Object.entries(delta) as [keyof Stats, number][]) {
      if (!by) continue;
      if (redis) await redis.hincrby("stats", key, by);
      else mem.stats[key] += by;
    }
  },

  async stats(): Promise<Stats> {
    if (!redis) return mem.stats;
    const s = (await redis.hgetall<Record<string, number>>("stats")) ?? {};
    return { deals: Number(s.deals ?? 0), paid: Number(s.paid ?? 0), saved: Number(s.saved ?? 0) };
  },

  /** Atomically claim a deal for payment so markPaid runs once even with concurrent pollers. */
  async claimPaid(id: string) {
    if (redis) return (await redis.set(`paid:${id}`, 1, { nx: true, ex: DEAL_TTL_S })) === "OK";
    const deal = mem.deals.get(id);
    return deal?.status !== "paid";
  },
};
