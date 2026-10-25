import { accounts, orderMoney, paidPostings, refundPostings, releasePostings, TIER_LIMITS, type Held, type SellerTier } from "@ghostcart/core";
import { schema } from "@ghostcart/db";
import { and, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb } from "../db";
import { getStore } from "../shop/stores";
import { store as kv } from "../store";
import type { Deal } from "../types";
import { balance, post } from "./ledger";
import { settlementGateway } from "./settlement";

const { holds, orders, refunds } = schema;

export type Order = typeof orders.$inferSelect;
export class OrderError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const FEE_BPS = () => Number(process.env.PLATFORM_FEE_BPS ?? 200);
const SHIP_SLA_HOURS = () => Number(process.env.SHIP_SLA_HOURS ?? 48);
const id = (p: string) => `${p}_${randomBytes(9).toString("base64url")}`;
const log = (o: Pick<Order, "id" | "dealId" | "userId">, detail: string, actor: "system" | "seller" | "human" | "user" = "system") =>
  kv.log({ type: "order_status", actor, userId: o.userId, dealId: o.dealId, detail: `${o.id}: ${detail}` });

export async function getOrder(orderId: string) {
  const db = await getDb();
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId));
  return o;
}

export async function orderForDeal(dealId: string) {
  const db = await getDb();
  const [o] = await db.select().from(orders).where(eq(orders.dealId, dealId));
  return o;
}

/**
 * A shop deal was paid in full: record the order, have the gateway settle the seller's share on hold,
 * and post the money to the ledger. Safe to call twice for the same deal.
 */
export async function createOrderFromDeal(deal: Deal) {
  if (!deal.shop || !deal.userId || deal.checkout?.status !== "ordered" || !deal.checkout.address) throw new OrderError("Only paid shop deals become orders.");
  const existing = await orderForDeal(deal.id);
  if (existing) return existing;
  const gateway = settlementGateway();
  if (!gateway) throw new OrderError("No settlement gateway for shop payments on this deployment.", 503);
  const shopStore = await getStore(deal.shop.storeId);
  if (!shopStore) throw new OrderError("Store not found.", 404);

  const m = orderMoney({ priceInr: deal.dealPrice, lockFeeInr: deal.lockFee, feeBps: FEE_BPS() });
  const db = await getDb();
  const now = new Date();
  const [order] = await db
    .insert(orders)
    .values({
      id: id("ord"),
      dealId: deal.id,
      storeId: shopStore.id,
      orgId: shopStore.orgId,
      userId: deal.userId,
      productId: deal.shop.productId,
      title: deal.product.title,
      total: m.total,
      fee: m.fee,
      gst: m.gst,
      sellerShare: m.sellerShare,
      lockFee: m.lockFee,
      testPayments: deal.testPayments,
      shipBy: new Date(now.getTime() + SHIP_SLA_HOURS() * 60 * 60 * 1000),
      address: deal.checkout.address as unknown as Record<string, string>,
    })
    .onConflictDoNothing({ target: orders.dealId })
    .returning();
  if (!order) return (await orderForDeal(deal.id))!; // a concurrent caller won the race

  const { ref } = await gateway.hold({ orderId: order.id, sellerAccountRef: shopStore.orgId, amount: m.sellerShare });
  await db.insert(holds).values({ orderId: order.id, amount: m.sellerShare, gateway: gateway.name, gatewayRef: ref });
  await post(db, { orderId: order.id, kind: "paid", postings: paidPostings(m, shopStore.id), memo: `deal ${deal.id}` });
  await log(order, `placed; ₹${m.total / 100} paid, seller share ₹${m.sellerShare / 100} held (${gateway.name} ${ref}); ship by ${order.shipBy.toISOString()}`);
  return order;
}

/** What's still held for an order, read from the ledger. */
export async function heldFor(order: Pick<Order, "id" | "storeId">): Promise<Held> {
  const db = await getDb();
  const [sellerShare, fee, gst] = await Promise.all([
    balance(db, accounts.sellerHeld(order.storeId), order.id),
    balance(db, accounts.feeHeld, order.id),
    balance(db, accounts.gstHeld, order.id),
  ]);
  // Held amounts are credits (negative balances); 0 - x avoids returning -0.
  return { sellerShare: 0 - sellerShare, fee: 0 - fee, gst: 0 - gst };
}

/** Delivery confirmed: start the dispute window. The hold releases after the store tier's hold days. */
export async function markDelivered(orderId: string, via: string, at = new Date()) {
  const order = await getOrder(orderId);
  if (!order) throw new OrderError("Order not found.", 404);
  if (order.status === "delivered" || order.status === "completed") return order;
  if (order.status !== "shipped" && order.status !== "placed") throw new OrderError(`This order is ${order.status}.`, 409);
  const shopStore = await getStore(order.storeId);
  const days = TIER_LIMITS[(shopStore?.tier ?? "new") as SellerTier].payoutHoldDays;
  const db = await getDb();
  const [updated] = await db.update(orders).set({ status: "delivered", deliveredAt: at, updatedAt: new Date() }).where(eq(orders.id, orderId)).returning();
  await db.update(holds).set({ releaseAt: new Date(at.getTime() + days * 24 * 60 * 60 * 1000), updatedAt: new Date() }).where(eq(holds.orderId, orderId));
  await log(order, `delivered (${via}); payout releases in ${days} days unless the buyer raises a problem`);
  return updated;
}

/** Release the seller's held share: the gateway pays out, and the fee is earned. */
export async function releaseOrder(orderId: string) {
  const order = await getOrder(orderId);
  const db = await getDb();
  const [hold] = await db.select().from(holds).where(eq(holds.orderId, orderId));
  if (!order || !hold) throw new OrderError("Order not found.", 404);
  if (hold.state !== "held") throw new OrderError(`The payout is ${hold.state}.`, 409);
  if (order.status !== "delivered") throw new OrderError("Payouts release only after delivery.", 409);
  const gateway = settlementGateway();
  if (!gateway) throw new OrderError("No settlement gateway.", 503);
  // Claim the hold first so two runs can't release it twice.
  const claimed = await db.update(holds).set({ state: "releasing", updatedAt: new Date() }).where(and(eq(holds.orderId, orderId), eq(holds.state, "held"))).returning();
  if (!claimed.length) return order;
  await gateway.release(hold.gatewayRef!);
  await post(db, { orderId, kind: "released", postings: releasePostings(await heldFor(order), order.storeId) });
  await db.update(holds).set({ state: "released", releasedAt: new Date(), updatedAt: new Date() }).where(eq(holds.orderId, orderId));
  const [done] = await db.update(orders).set({ status: "completed", updatedAt: new Date() }).where(eq(orders.id, orderId)).returning();
  await log(order, `payout of ₹${hold.amount / 100} released to the seller`);
  return done;
}

/**
 * Refund the buyer from money still held (seller didn't ship, or a dispute was upheld). A full refund
 * closes the order; a partial one leaves the rest to release as normal.
 */
export async function refundOrder(orderId: string, amount: number, reason: string, requestedBy: string, finalStatus: "refunded" | "cancelled" = "refunded") {
  const order = await getOrder(orderId);
  const db = await getDb();
  const [hold] = await db.select().from(holds).where(eq(holds.orderId, orderId));
  if (!order || !hold) throw new OrderError("Order not found.", 404);
  if (hold.state !== "held" && hold.state !== "frozen") throw new OrderError(`The money is already ${hold.state}; it can't be refunded from the hold.`, 409);
  const held = await heldFor(order);
  const heldTotal = held.sellerShare + held.fee + held.gst;
  if (!(Number.isInteger(amount) && amount > 0 && amount <= heldTotal)) throw new OrderError(`Refund between ₹0.01 and ₹${heldTotal / 100}.`);
  const gateway = settlementGateway();
  if (!gateway) throw new OrderError("No settlement gateway.", 503);

  const refundId = id("rfd");
  await db.insert(refunds).values({ id: refundId, orderId, amount, reason, requestedBy });
  const { ref } = await gateway.refund({ orderId, amount, reason });
  await post(db, { orderId, kind: "refund", postings: refundPostings(held, order.storeId, amount), memo: reason });
  await db.update(refunds).set({ status: "processed", gatewayRef: ref }).where(eq(refunds.id, refundId));
  const full = amount === heldTotal;
  if (full) {
    await db.update(holds).set({ state: "refunded", amount: 0, updatedAt: new Date() }).where(eq(holds.orderId, orderId));
    await db.update(orders).set({ status: finalStatus, updatedAt: new Date() }).where(eq(orders.id, orderId));
  } else {
    const remaining = await heldFor(order);
    await db.update(holds).set({ amount: remaining.sellerShare, updatedAt: new Date() }).where(eq(holds.orderId, orderId));
  }
  await log(order, `refunded ₹${amount / 100} to the buyer (${reason}) by ${requestedBy}`, requestedBy === "system" ? "system" : "human");
  return getOrder(orderId);
}

/** Scheduled: poll courier tracking, cancel and refund orders not shipped in time, release payouts that are due. */
export async function runOrderJobs(now = new Date()) {
  const db = await getDb();
  const { pollTracking } = await import("./fulfilment");
  const tracking = await pollTracking();
  const late = await db.select().from(orders).where(and(eq(orders.status, "placed"), lte(orders.shipBy, now)));
  const cancelled: string[] = [];
  for (const o of late) {
    try {
      const held = await heldFor(o);
      await refundOrder(o.id, held.sellerShare + held.fee + held.gst, "seller didn't ship in time", "system", "cancelled");
      cancelled.push(o.id);
    } catch (err) {
      console.error(`couldn't cancel late order ${o.id}`, err);
    }
  }
  const due = await db
    .select({ orderId: holds.orderId })
    .from(holds)
    .innerJoin(orders, eq(orders.id, holds.orderId))
    .where(and(eq(holds.state, "held"), isNotNull(holds.releaseAt), lte(holds.releaseAt, now), eq(orders.status, "delivered")));
  const released: string[] = [];
  for (const { orderId } of due) {
    try {
      await releaseOrder(orderId);
      released.push(orderId);
    } catch (err) {
      console.error(`couldn't release order ${orderId}`, err);
    }
  }
  return { tracked: tracking.checked, delivered: tracking.delivered, cancelled, released };
}

/** Seller money at a glance: on hold until delivery, and released (on its way to the bank). */
export async function storeMoney(storeId: string) {
  const db = await getDb();
  const [held, payable] = await Promise.all([balance(db, accounts.sellerHeld(storeId)), balance(db, accounts.sellerPayable(storeId))]);
  const recent = await db.select().from(orders).where(eq(orders.storeId, storeId)).orderBy(sql`${orders.createdAt} desc`).limit(50);
  return { held: 0 - held, released: 0 - payable, orders: recent };
}

export async function ordersForStore(storeId: string, statuses?: string[]) {
  const db = await getDb();
  return db
    .select()
    .from(orders)
    .where(statuses ? and(eq(orders.storeId, storeId), inArray(orders.status, statuses)) : eq(orders.storeId, storeId))
    .orderBy(sql`${orders.createdAt} desc`);
}
