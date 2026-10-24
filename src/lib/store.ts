import { Redis } from "@upstash/redis";
import type { Activity, Deal, Stats, TickerEvent, User } from "./types";

// Deals and logs are kept for the whole event so they can be exported as proof.
const DEAL_TTL_S = 7 * 24 * 60 * 60;
const TICKER_MAX = 50;
const LOG_MAX = 20000;

const redis =
  process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
    ? new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN })
    : null;

// In-memory fallback for local dev without Redis. Not shared across serverless instances.
const mem = {
  deals: new Map<string, Deal>(),
  dealIds: [] as string[],
  users: new Map<string, User>(),
  phones: new Map<string, string>(),
  userIds: [] as string[],
  ticker: [] as TickerEvent[],
  log: [] as Activity[],
  paid: new Set<string>(),
  stats: { users: 0, deals: 0, paid: 0, saved: 0 } as Stats,
};

function withExpiry(deal: Deal | null | undefined) {
  if (deal && deal.status === "pending" && Date.now() > deal.expiresAt) deal.status = "expired";
  return deal ?? undefined;
}

export const store = {
  async saveDeal(deal: Deal, isNew = false) {
    if (redis) {
      await redis.set(`deal:${deal.id}`, deal, { ex: DEAL_TTL_S });
      if (isNew) await redis.lpush("deals", deal.id);
    } else {
      mem.deals.set(deal.id, deal);
      if (isNew) mem.dealIds.unshift(deal.id);
    }
    return deal;
  },

  async getDeal(id: string) {
    const deal = redis ? await redis.get<Deal>(`deal:${id}`) : mem.deals.get(id);
    return withExpiry(deal);
  },

  async listDeals(limit = 1000): Promise<Deal[]> {
    const ids = redis ? await redis.lrange<string>("deals", 0, limit - 1) : mem.dealIds.slice(0, limit);
    if (!ids.length) return [];
    const deals = redis ? await redis.mget<(Deal | null)[]>(...ids.map((id) => `deal:${id}`)) : ids.map((id) => mem.deals.get(id));
    return deals.map(withExpiry).filter((d): d is Deal => !!d);
  },

  /** Create a user, or return the existing one for this phone number. */
  async upsertUser(user: User): Promise<{ user: User; created: boolean }> {
    if (redis) {
      const claimed = await redis.set(`phone:${user.phone}`, user.id, { nx: true });
      if (claimed !== "OK") {
        const existingId = await redis.get<string>(`phone:${user.phone}`);
        const existing = existingId ? await redis.get<User>(`user:${existingId}`) : null;
        if (existing) return { user: existing, created: false };
      }
      await redis.set(`user:${user.id}`, user);
      await redis.lpush("users", user.id);
    } else {
      const existingId = mem.phones.get(user.phone);
      if (existingId) return { user: mem.users.get(existingId)!, created: false };
      mem.users.set(user.id, user);
      mem.phones.set(user.phone, user.id);
      mem.userIds.unshift(user.id);
    }
    await store.incrStats({ users: 1 });
    return { user, created: true };
  },

  async getUser(id: string) {
    return (redis ? await redis.get<User>(`user:${id}`) : mem.users.get(id)) ?? undefined;
  },

  async listUsers(limit = 5000): Promise<User[]> {
    const ids = redis ? await redis.lrange<string>("users", 0, limit - 1) : mem.userIds.slice(0, limit);
    if (!ids.length) return [];
    const users = redis ? await redis.mget<(User | null)[]>(...ids.map((id) => `user:${id}`)) : ids.map((id) => mem.users.get(id));
    return users.filter((u): u is User => !!u);
  },

  async log(entry: Omit<Activity, "at"> & { at?: number }) {
    const event: Activity = { at: Date.now(), ...entry };
    try {
      if (redis) {
        await redis.lpush("activity", event);
        await redis.ltrim("activity", 0, LOG_MAX - 1);
      } else {
        mem.log.unshift(event);
        mem.log.length = Math.min(mem.log.length, LOG_MAX);
      }
    } catch (err) {
      console.error("activity log write failed", err); // never break the user flow over logging
    }
  },

  async listLog(limit = 500): Promise<Activity[]> {
    if (redis) return redis.lrange<Activity>("activity", 0, limit - 1);
    return mem.log.slice(0, limit);
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
    return {
      users: Number(s.users ?? 0),
      deals: Number(s.deals ?? 0),
      paid: Number(s.paid ?? 0),
      saved: Number(s.saved ?? 0),
    };
  },

  /** Atomically claim a deal for payment so markPaid runs once even with concurrent pollers. */
  async claimPaid(id: string) {
    if (redis) return (await redis.set(`paid:${id}`, 1, { nx: true, ex: DEAL_TTL_S })) === "OK";
    if (mem.paid.has(id)) return false;
    mem.paid.add(id);
    return true;
  },
};
