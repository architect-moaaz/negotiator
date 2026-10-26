import { schema, type Db } from "@ghostcart/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Activity, Deal, Demographics, Seller, SellerDemand, Stats, User, Visit } from "./types";

const { activity, counters, deals, sellerAliases, sellerDemand, sellers, sellerTokens, users, visits } = schema;

const date = (ms: number) => new Date(ms);
const ms = (d: Date | null) => (d ? d.getTime() : undefined);
const opt = <T>(v: T | null) => v ?? undefined;

type UserRow = typeof users.$inferSelect;
type SellerRow = typeof sellers.$inferSelect;

function userRow(u: User): typeof users.$inferInsert {
  return {
    id: u.id,
    phone: u.phone,
    name: u.name,
    email: u.email ?? null,
    channel: u.channel,
    city: u.city ?? null,
    demographics: u.demographics ?? null,
    consentAt: u.consentAt ? date(u.consentAt) : null,
    lastLoginAt: u.lastLoginAt ? date(u.lastLoginAt) : null,
    createdAt: date(u.createdAt),
  };
}

function toUser(r: UserRow): User {
  return {
    id: r.id,
    phone: r.phone,
    name: r.name,
    email: opt(r.email),
    channel: r.channel as User["channel"],
    city: opt(r.city),
    demographics: opt(r.demographics as Demographics | null),
    consentAt: ms(r.consentAt),
    lastLoginAt: ms(r.lastLoginAt),
    createdAt: r.createdAt.getTime(),
  };
}

function toSeller(r: SellerRow, aliases: string[]): Seller {
  return {
    id: r.id,
    storeName: r.storeName,
    contactName: r.contactName,
    phone: r.phone,
    budgetPct: r.budgetPct,
    autoApproveShare: r.autoApproveShare,
    aliases,
    createdAt: r.createdAt.getTime(),
  };
}

const toActivity = (r: typeof activity.$inferSelect): Activity => ({
  at: r.at.getTime(),
  type: r.type as Activity["type"],
  actor: r.actor as Activity["actor"],
  userId: opt(r.userId),
  dealId: opt(r.dealId),
  detail: r.detail,
});

/**
 * Postgres implementation of the store's durable data: deals, users, sellers, the activity log,
 * counters, seller demand and visits. Short-lived keys (OTP, sessions, locks, ticker) stay in Redis.
 */
export function createPgStore(db: Db) {
  async function aliasesFor(ids: string[]) {
    const rows = ids.length ? await db.select().from(sellerAliases).where(inArray(sellerAliases.sellerId, ids)) : [];
    const by = new Map<string, string[]>();
    for (const r of rows) by.set(r.sellerId, [...(by.get(r.sellerId) ?? []), r.alias]);
    return by;
  }

  return {
    async saveDeal(deal: Deal) {
      const row = {
        id: deal.id,
        userId: deal.userId ?? null,
        sellerId: deal.negotiation?.terms.sellerId ?? null,
        status: deal.status,
        channel: deal.channel,
        city: deal.city ?? null,
        dealPrice: deal.dealPrice,
        createdAt: date(deal.createdAt),
        expiresAt: date(deal.expiresAt),
        data: deal,
        version: deal.version ?? 1,
      };
      await db
        .insert(deals)
        .values(row)
        .onConflictDoUpdate({ target: deals.id, set: { ...row, updatedAt: sql`now()` } });
      return deal;
    },

    /** Compare-and-set on the version column (see composeStore.saveDeal). */
    async casDeal(deal: Deal, expected: number | undefined, isNew = false) {
      void isNew;
      const row = {
        id: deal.id,
        userId: deal.userId ?? null,
        sellerId: deal.negotiation?.terms.sellerId ?? null,
        status: deal.status,
        channel: deal.channel,
        city: deal.city ?? null,
        dealPrice: deal.dealPrice,
        createdAt: date(deal.createdAt),
        expiresAt: date(deal.expiresAt),
        data: deal,
        version: deal.version ?? 1,
      };
      if (expected === undefined) {
        await db.insert(deals).values(row).onConflictDoUpdate({ target: deals.id, set: { ...row, updatedAt: sql`now()` } });
        return true;
      }
      const updated = await db
        .update(deals)
        .set({ ...row, updatedAt: sql`now()` })
        .where(and(eq(deals.id, deal.id), eq(deals.version, expected)))
        .returning({ id: deals.id });
      return updated.length > 0;
    },

    async getDeal(id: string) {
      const [r] = await db.select({ data: deals.data }).from(deals).where(eq(deals.id, id));
      return r ? (r.data as Deal) : undefined;
    },

    async listDeals(limit = 1000): Promise<Deal[]> {
      const rows = await db.select({ data: deals.data }).from(deals).orderBy(desc(deals.createdAt)).limit(limit);
      return rows.map((r) => r.data as Deal);
    },

    /** Create a user, or return the existing one for this phone number. */
    async upsertUser(user: User): Promise<{ user: User; created: boolean }> {
      const inserted = await db.insert(users).values(userRow(user)).onConflictDoNothing({ target: users.phone }).returning();
      if (inserted.length) return { user: toUser(inserted[0]), created: true };
      const [existing] = await db.select().from(users).where(eq(users.phone, user.phone));
      return { user: toUser(existing), created: false };
    },

    async getUser(id: string) {
      const [r] = await db.select().from(users).where(eq(users.id, id));
      return r ? toUser(r) : undefined;
    },

    async listUsers(limit = 5000): Promise<User[]> {
      return (await db.select().from(users).orderBy(desc(users.createdAt)).limit(limit)).map(toUser);
    },

    async userIdForPhone(phone: string) {
      const [r] = await db.select({ id: users.id }).from(users).where(eq(users.phone, phone));
      return r?.id;
    },

    async updateUser(user: User) {
      const row = userRow(user);
      await db.insert(users).values(row).onConflictDoUpdate({ target: users.id, set: row });
    },

    async log(event: Activity) {
      await db.insert(activity).values({ ...event, at: date(event.at), userId: event.userId ?? null, dealId: event.dealId ?? null });
    },

    async listLog(limit = 500): Promise<Activity[]> {
      return (await db.select().from(activity).orderBy(desc(activity.at), desc(activity.id)).limit(limit)).map(toActivity);
    },

    async incrStats(delta: Partial<Stats>) {
      const rows = Object.entries(delta)
        .filter(([, by]) => by)
        .map(([key, value]) => ({ key, value: value as number }));
      if (!rows.length) return;
      await db
        .insert(counters)
        .values(rows)
        .onConflictDoUpdate({ target: counters.key, set: { value: sql`${counters.value} + excluded.value` } });
    },

    async stats(): Promise<Stats> {
      const s = Object.fromEntries((await db.select().from(counters)).map((r) => [r.key, r.value]));
      return { users: s.users ?? 0, deals: s.deals ?? 0, paid: s.paid ?? 0, saved: s.saved ?? 0 };
    },

    async saveSeller(seller: Seller, tokenHash?: string) {
      const row = {
        id: seller.id,
        storeName: seller.storeName,
        contactName: seller.contactName,
        phone: seller.phone,
        budgetPct: seller.budgetPct,
        autoApproveShare: seller.autoApproveShare,
        createdAt: date(seller.createdAt),
      };
      await db.insert(sellers).values(row).onConflictDoUpdate({ target: sellers.id, set: row });
      for (const alias of seller.aliases) {
        await db.insert(sellerAliases).values({ alias, sellerId: seller.id }).onConflictDoUpdate({ target: sellerAliases.alias, set: { sellerId: seller.id } });
      }
      if (tokenHash) await db.insert(sellerTokens).values({ tokenHash, sellerId: seller.id }).onConflictDoNothing();
    },

    async getSeller(id: string) {
      const [r] = await db.select().from(sellers).where(eq(sellers.id, id));
      if (!r) return undefined;
      const aliases = await db.select({ alias: sellerAliases.alias }).from(sellerAliases).where(eq(sellerAliases.sellerId, id));
      return toSeller(r, aliases.map((a) => a.alias));
    },

    async listSellers(): Promise<Seller[]> {
      const rows = await db.select().from(sellers).orderBy(desc(sellers.createdAt));
      const aliases = await aliasesFor(rows.map((r) => r.id));
      return rows.map((r) => toSeller(r, aliases.get(r.id) ?? []));
    },

    async sellerIdForAlias(alias: string) {
      const [r] = await db.select({ id: sellerAliases.sellerId }).from(sellerAliases).where(eq(sellerAliases.alias, alias));
      return r?.id;
    },

    async sellerIdForToken(tokenHash: string) {
      const [r] = await db.select({ id: sellerTokens.sellerId }).from(sellerTokens).where(eq(sellerTokens.tokenHash, tokenHash));
      return r?.id;
    },

    async sellerIdForPhone(phone: string) {
      const [r] = await db.select({ id: sellers.id }).from(sellers).where(eq(sellers.phone, phone));
      return r?.id;
    },

    async recordDemand(key: string, name: string, marketplace: string, by = 1) {
      await db
        .insert(sellerDemand)
        .values({ key, name, marketplace, count: by })
        .onConflictDoUpdate({ target: sellerDemand.key, set: { name, marketplace, count: sql`${sellerDemand.count} + ${by}`, updatedAt: sql`now()` } });
    },

    async topDemand(limit = 25): Promise<Omit<SellerDemand, "registered">[]> {
      return db
        .select({ key: sellerDemand.key, name: sellerDemand.name, marketplace: sellerDemand.marketplace, count: sellerDemand.count })
        .from(sellerDemand)
        .orderBy(desc(sellerDemand.count), sellerDemand.key)
        .limit(limit);
    },

    async pushVisit(visit: Visit) {
      const { vid, path, at, ...demographics } = visit;
      await db.insert(visits).values({ vid, path, at: date(at), data: demographics });
    },

    async listVisits(limit = 20000): Promise<Visit[]> {
      const rows = await db.select().from(visits).orderBy(desc(visits.at), desc(visits.id)).limit(limit);
      return rows.map((r) => ({ ...(r.data as Demographics), vid: r.vid, path: r.path, at: r.at.getTime() }));
    },
  };
}

export type PgStore = ReturnType<typeof createPgStore>;
