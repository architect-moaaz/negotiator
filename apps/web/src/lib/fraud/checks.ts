import { schema } from "@ghostcart/db";
import { and, eq, gte, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { getDb } from "../db";
import type { Order } from "../orders/service";
import { store as kv } from "../store";
import { normalizePhone } from "../users";
import { deviceHash, deviceUsedByMembers, recordRisk } from "./signals";

const { disputes, members, orders } = schema;

/** Haggles a shopper can have open at once (negotiating, waiting for approval, or waiting for the lock). */
export const MAX_OPEN_NEGOTIATIONS = 5;
/** Problems reported in 90 days before a shopper is asked to contact support instead. */
export const MAX_RECENT_DISPUTES = 3;
/** Distinct shoppers shipping to the same address in a day before the order is flagged. */
const MAX_BUYERS_PER_ADDRESS = 3;

export class FraudBlock extends Error {}

async function orgPhones(orgId: string) {
  const db = await getDb();
  return (await db.select({ phone: members.phone }).from(members).where(eq(members.orgId, orgId))).map((m) => m.phone);
}

/**
 * Before a shopper starts haggling on a shop product: no buying from your own store (by phone or
 * device), no flood of open haggles, and no one with a run of recent problem reports.
 */
export async function assertCanHaggle(input: { userId: string; orgId: string; storeId: string; request?: Request }) {
  const user = await kv.getUser(input.userId);
  const phones = await orgPhones(input.orgId);
  if (user && phones.includes(user.phone)) {
    await recordRisk("self_dealing", "blocked", "user", input.userId, { storeId: input.storeId, why: "shopper phone is a member of the store" });
    throw new FraudBlock("You can't buy from your own store.");
  }
  if (input.request && (await deviceUsedByMembers(deviceHash(input.request), phones))) {
    await recordRisk("self_dealing", "blocked", "user", input.userId, { storeId: input.storeId, why: "device used by a store member" });
    throw new FraudBlock("This device is signed in to the seller's account, so it can't buy from that store.");
  }

  const open = (await kv.listDeals(2000)).filter((d) => d.userId === input.userId && ["negotiating", "awaiting_approval", "pending"].includes(d.status));
  if (open.length >= MAX_OPEN_NEGOTIATIONS) {
    await recordRisk("velocity", "blocked", "user", input.userId, { open: open.length });
    throw new FraudBlock(`You have ${open.length} deals open. Finish or let one expire before starting another.`);
  }

  const db = await getDb();
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(disputes)
    .innerJoin(orders, eq(orders.id, disputes.orderId))
    .where(and(eq(orders.userId, input.userId), gte(disputes.createdAt, since)));
  if (n >= MAX_RECENT_DISPUTES) {
    await recordRisk("buyer_risk", "blocked", "user", input.userId, { disputes90d: n });
    throw new FraudBlock("We need to talk to you before your next order. Contact GhostCart support.");
  }
}

/**
 * After an order is created: flag (don't block, the buyer has paid) orders that look like the seller
 * buying from themselves or one address collecting many shoppers' orders. A flagged order's payout
 * stays held until staff clear it.
 */
export async function flagOrderIfRisky(order: Order, request?: Request) {
  const reasons: string[] = [];
  const phones = await orgPhones(order.orgId);
  const addressPhone = normalizePhone(order.address.phone ?? "");
  if (addressPhone && phones.includes(addressPhone)) reasons.push("delivery phone belongs to the seller");
  if (request && (await deviceUsedByMembers(deviceHash(request), phones))) reasons.push("paid from a device the seller uses");

  const db = await getDb();
  const day = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const sameAddress = await db
    .select({ userId: orders.userId })
    .from(orders)
    .where(and(gte(orders.createdAt, day), sql`${orders.address}->>'pincode' = ${order.address.pincode ?? ""}`, sql`lower(${orders.address}->>'line1') = ${(order.address.line1 ?? "").toLowerCase()}`));
  const buyers = new Set(sameAddress.map((r) => r.userId));
  if (buyers.size > MAX_BUYERS_PER_ADDRESS) reasons.push(`${buyers.size} shoppers ordered to this address today`);

  if (!reasons.length) return order;
  const flagged = reasons.join("; ");
  await db.update(orders).set({ flagged, updatedAt: new Date() }).where(eq(orders.id, order.id));
  await recordRisk("order_flagged", "flagged", "order", order.id, { reasons, storeId: order.storeId, userId: order.userId });
  return { ...order, flagged };
}

/** Staff clear a flag after looking: the payout can release as normal. */
export async function clearOrderFlag(orderId: string, by: string) {
  const db = await getDb();
  await db.update(orders).set({ flagged: null, updatedAt: new Date() }).where(eq(orders.id, orderId));
  await db.update(schema.riskEvents).set({ reviewedBy: by }).where(and(eq(schema.riskEvents.subjectType, "order"), eq(schema.riskEvents.subjectId, orderId)));
}

/** For the fraud dashboard. */
export async function fraudOverview() {
  const db = await getDb();
  const events = await db.select().from(schema.riskEvents).orderBy(sql`${schema.riskEvents.createdAt} desc`).limit(100);
  const flagged = await db.select().from(orders).where(isNotNull(orders.flagged));
  const storeStats = await db
    .select({
      storeId: orders.storeId,
      orders: sql<number>`count(*)::int`,
      disputed: sql<number>`count(${disputes.id})::int`,
      refunded: sql<number>`count(*) filter (where ${orders.status} in ('refunded','cancelled'))::int`,
    })
    .from(orders)
    .leftJoin(disputes, eq(disputes.orderId, orders.id))
    .groupBy(orders.storeId);
  const buyerStats = await db
    .select({ userId: orders.userId, disputes: sql<number>`count(*)::int` })
    .from(disputes)
    .innerJoin(orders, eq(orders.id, disputes.orderId))
    .groupBy(orders.userId)
    .having(sql`count(*) >= 2`);
  return {
    events,
    flagged: flagged.map((o) => ({ ...o, address: undefined })),
    riskySellers: storeStats.filter((s) => s.orders >= 5 && (s.disputed / s.orders > 0.05 || s.refunded / s.orders > 0.1)),
    riskyBuyers: buyerStats,
  };
}

/** Stores whose record earns the trusted tier (see packages/core tiers). */
export async function storeTrackRecord(storeIds: string[]) {
  if (!storeIds.length) return [];
  const db = await getDb();
  return db
    .select({
      storeId: orders.storeId,
      delivered: sql<number>`count(*) filter (where ${orders.status} = 'completed')::int`,
      disputes: sql<number>`count(${disputes.id})::int`,
      distinctBuyers: sql<number>`count(distinct ${orders.userId}) filter (where ${orders.status} = 'completed')::int`,
    })
    .from(orders)
    .leftJoin(disputes, and(eq(disputes.orderId, orders.id), ne(disputes.status, "released")))
    .where(inArray(orders.storeId, storeIds))
    .groupBy(orders.storeId);
}
