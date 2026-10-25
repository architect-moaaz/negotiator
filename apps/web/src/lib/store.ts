import { createDb } from "@ghostcart/db";
import { Redis } from "@upstash/redis";
import { createPgStore, type PgStore } from "./pg-store";
import type { Activity, Deal, Seller, SellerDemand, Stats, TickerEvent, User, Visit } from "./types";

// Deals and logs are kept for the whole event so they can be exported as proof.
const DEAL_TTL_S = 7 * 24 * 60 * 60;
const TICKER_MAX = 50;
const LOG_MAX = 20000;

const redis =
  process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
    ? new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN })
    : null;

// In-memory fallback for local dev without Redis. Not shared across serverless instances.
// Pinned on globalThis so every route module in the dev server sees the same data.
function createMem() {
  return {
    deals: new Map<string, Deal>(),
    dealIds: [] as string[],
    users: new Map<string, User>(),
    phones: new Map<string, string>(),
    userIds: [] as string[],
    ticker: [] as TickerEvent[],
    log: [] as Activity[],
    paid: new Set<string>(),
    sellers: new Map<string, Seller>(),
    sellerIds: [] as string[],
    sellerAliases: new Map<string, string>(),
    sellerTokens: new Map<string, string>(),
    demand: new Map<string, { name: string; marketplace: string; count: number }>(),
    kv: new Map<string, unknown>(),
    visits: [] as Visit[],
    stats: { users: 0, deals: 0, paid: 0, saved: 0 } as Stats,
  };
}
const g = globalThis as typeof globalThis & { __ghostcartMem?: ReturnType<typeof createMem> };
const mem = (g.__ghostcartMem ??= createMem());

function withExpiry(deal: Deal | null | undefined) {
  const live = deal?.status === "pending" || deal?.status === "negotiating" || deal?.status === "awaiting_approval";
  if (deal && live && Date.now() > deal.expiresAt) deal.status = "expired";
  return deal ?? undefined;
}

/** Redis in production, in-memory in local dev. Holds everything until Postgres takes over. */
export const legacyStore = {
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

  /** Create a user, or return the existing one for this phone number. Counting is the caller's job. */
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

  async log(event: Activity) {
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

  async saveSeller(seller: Seller, tokenHash: string) {
    if (redis) {
      await redis.set(`seller:${seller.id}`, seller);
      await redis.lpush("sellers", seller.id);
      await redis.set(`sellerToken:${tokenHash}`, seller.id);
      await redis.set(`sellerPhone:${seller.phone}`, seller.id);
      for (const alias of seller.aliases) await redis.set(`sellerAlias:${alias}`, seller.id);
    } else {
      mem.sellers.set(seller.id, seller);
      mem.sellerIds.unshift(seller.id);
      mem.sellerTokens.set(tokenHash, seller.id);
      mem.kv.set(`sellerPhone:${seller.phone}`, seller.id);
      for (const alias of seller.aliases) mem.sellerAliases.set(alias, seller.id);
    }
  },

  async getSeller(id: string) {
    return (redis ? await redis.get<Seller>(`seller:${id}`) : mem.sellers.get(id)) ?? undefined;
  },

  async sellerIdForAlias(alias: string) {
    return (redis ? await redis.get<string>(`sellerAlias:${alias}`) : mem.sellerAliases.get(alias)) ?? undefined;
  },

  async sellerIdForToken(tokenHash: string) {
    return (redis ? await redis.get<string>(`sellerToken:${tokenHash}`) : mem.sellerTokens.get(tokenHash)) ?? undefined;
  },

  async listSellers(): Promise<Seller[]> {
    const ids = redis ? await redis.lrange<string>("sellers", 0, -1) : mem.sellerIds;
    if (!ids.length) return [];
    const sellers = redis ? await redis.mget<(Seller | null)[]>(...ids.map((id) => `seller:${id}`)) : ids.map((id) => mem.sellers.get(id));
    return sellers.filter((x): x is Seller => !!x);
  },

  /** Count shoppers who wanted to buy from a marketplace seller (registered or not). */
  async recordDemand(key: string, name: string, marketplace: string) {
    if (redis) {
      await redis.zincrby("sellerDemand", 1, key);
      await redis.hset("sellerDemandNames", { [key]: JSON.stringify({ name, marketplace }) });
    } else {
      const prev = mem.demand.get(key);
      mem.demand.set(key, { name, marketplace, count: (prev?.count ?? 0) + 1 });
    }
  },

  async topDemand(limit = 25): Promise<Omit<SellerDemand, "registered">[]> {
    if (!redis) {
      return [...mem.demand.entries()]
        .map(([key, v]) => ({ key, ...v }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
    }
    const raw = await redis.zrange<(string | number)[]>("sellerDemand", 0, limit - 1, { rev: true, withScores: true });
    const names = (await redis.hgetall<Record<string, string | { name: string; marketplace: string }>>("sellerDemandNames")) ?? {};
    const out: Omit<SellerDemand, "registered">[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      const key = String(raw[i]);
      const meta = names[key];
      const parsed = typeof meta === "string" ? (JSON.parse(meta) as { name: string; marketplace: string }) : meta;
      out.push({ key, name: parsed?.name ?? key, marketplace: parsed?.marketplace ?? "", count: Number(raw[i + 1]) });
    }
    return out;
  },

  /** Generic JSON key/value (used by the Pine Labs mock gateway). */
  async kvSet<T>(key: string, value: T, ttlSeconds = DEAL_TTL_S) {
    if (redis) await redis.set(key, value, { ex: ttlSeconds });
    else mem.kv.set(key, value);
  },

  async pushVisit(visit: Visit) {
    if (redis) {
      await redis.lpush("visits", visit);
      await redis.ltrim("visits", 0, LOG_MAX - 1);
    } else {
      mem.visits.unshift(visit);
      mem.visits.length = Math.min(mem.visits.length, LOG_MAX);
    }
  },

  async listVisits(limit = LOG_MAX): Promise<Visit[]> {
    if (redis) return redis.lrange<Visit>("visits", 0, limit - 1);
    return mem.visits.slice(0, limit);
  },

  async kvDel(key: string) {
    if (redis) await redis.del(key);
    else mem.kv.delete(key);
  },

  /** True the first time per TTL window (rate limits, one-shot actions). */
  async claimOnce(key: string, ttlSeconds: number) {
    if (redis) return (await redis.set(key, 1, { nx: true, ex: ttlSeconds })) === "OK";
    if (mem.kv.has(key)) return false;
    mem.kv.set(key, 1);
    setTimeout(() => mem.kv.delete(key), ttlSeconds * 1000).unref?.();
    return true;
  },

  async userIdForPhone(phone: string) {
    return (redis ? await redis.get<string>(`phone:${phone}`) : mem.phones.get(phone)) ?? undefined;
  },

  async updateUser(user: User) {
    if (redis) await redis.set(`user:${user.id}`, user);
    else mem.users.set(user.id, user);
  },

  async sellerIdForPhone(phone: string) {
    return (redis ? await redis.get<string>(`sellerPhone:${phone}`) : (mem.kv.get(`sellerPhone:${phone}`) as string | undefined)) ?? undefined;
  },

  async kvGet<T>(key: string): Promise<T | undefined> {
    return ((redis ? await redis.get<T>(key) : mem.kv.get(key)) as T | null) ?? undefined;
  },

  /** Atomically claim a deal for payment so markPaid runs once even with concurrent pollers. */
  async claimPaid(id: string) {
    if (redis) return (await redis.set(`paid:${id}`, 1, { nx: true, ex: DEAL_TTL_S })) === "OK";
    if (mem.paid.has(id)) return false;
    mem.paid.add(id);
    return true;
  },
};

/**
 * STORE_MODE moves durable data from Redis to Postgres in three steps (needs DATABASE_URL):
 * - "redis" (default): Redis only, as before.
 * - "dual": every durable write also goes to Postgres; reads still come from Redis. Run the
 *   backfill (scripts/backfill-postgres.mts) during this phase so Postgres holds everything.
 * - "postgres": durable reads and writes go to Postgres only.
 * Short-lived keys (OTP, sessions, locks, the ticker, mock gateway orders) stay in Redis in every mode.
 */
export type StoreMode = "redis" | "dual" | "postgres";

const DURABLE_WRITES = [
  "saveDeal",
  "updateUser",
  "log",
  "incrStats",
  "saveSeller",
  "recordDemand",
  "pushVisit",
] as const satisfies readonly (keyof PgStore & keyof typeof legacyStore)[];
const DURABLE_READS = [
  "getDeal",
  "listDeals",
  "getUser",
  "listUsers",
  "userIdForPhone",
  "listLog",
  "stats",
  "getSeller",
  "listSellers",
  "sellerIdForAlias",
  "sellerIdForToken",
  "sellerIdForPhone",
  "topDemand",
  "listVisits",
] as const satisfies readonly (keyof PgStore & keyof typeof legacyStore)[];

type AnyFn = (...args: unknown[]) => Promise<unknown>;

export function composeStore(legacy: typeof legacyStore, pg: PgStore | null, mode: StoreMode) {
  const active: StoreMode = pg ? mode : "redis";
  const base = { ...legacy };
  const fns = base as unknown as Record<string, AnyFn>;
  const legacyFns = legacy as unknown as Record<string, AnyFn>;
  const pgFns = pg as unknown as Record<string, AnyFn>;

  // In dual mode a Postgres failure must never break the shopper's flow; Redis is still the truth.
  const mirror = async (what: string, run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (err) {
      console.error(`postgres mirror failed: ${what}`, err);
    }
  };

  if (active !== "redis") {
    for (const name of DURABLE_WRITES) {
      fns[name] =
        active === "postgres"
          ? (...args) => pgFns[name](...args)
          : async (...args) => {
              const result = await legacyFns[name](...args);
              await mirror(name, () => pgFns[name](...args));
              return result;
            };
    }
    if (active === "postgres") for (const name of DURABLE_READS) fns[name] = (...args) => pgFns[name](...args);
  }

  const source = active === "postgres" ? pg! : legacy;
  return {
    ...base,
    mode: active,

    async getDeal(id: string) {
      return withExpiry(await (active === "postgres" ? pg!.getDeal(id) : legacy.getDeal(id)));
    },

    async listDeals(limit?: number) {
      return (await source.listDeals(limit)).map(withExpiry).filter((d): d is Deal => !!d);
    },

    async log(entry: Omit<Activity, "at"> & { at?: number }) {
      const event: Activity = { at: Date.now(), ...entry };
      try {
        await fns.log(event);
      } catch (err) {
        console.error("activity log write failed", err); // never break the user flow over logging
      }
    },

    /** Create a user, or return the existing one for this phone number. */
    async upsertUser(user: User): Promise<{ user: User; created: boolean }> {
      const result = await source.upsertUser(user);
      // Mirror the account Redis actually holds (the existing one, if the phone was taken).
      if (active === "dual") await mirror("upsertUser", () => pg!.upsertUser(result.user));
      if (result.created) await fns.incrStats({ users: 1 });
      return result;
    },
  };
}

const pgStore = process.env.DATABASE_URL ? createPgStore(createDb(process.env.DATABASE_URL)) : null;
const requestedMode = (process.env.STORE_MODE ?? "redis") as StoreMode;
if (requestedMode !== "redis" && !pgStore) console.warn(`STORE_MODE=${requestedMode} needs DATABASE_URL; using Redis only`);

export const store = composeStore(legacyStore, pgStore, requestedMode);
