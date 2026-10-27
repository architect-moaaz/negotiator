import { schema } from "@ghostcart/db";
import { and, eq, inArray, lte } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb } from "../db";
import { notifyShopperOrder } from "../notify/order-updates";
import { putBackStock } from "../shop/stock";
import { getStore } from "../shop/stores";
import { store as kv } from "../store";
import { heldFor, getOrder, OrderError, refundOrder, type Order } from "./service";

const { holds, orders, returnRequests } = schema;

export type ReturnRequest = typeof returnRequests.$inferSelect;
export const RETURN_REASONS = ["changed_mind", "damaged", "not_as_described", "wrong_item", "other"] as const;
/** A seller who hasn't answered a return in this long has it sent to GhostCart staff as a dispute. */
export const RETURN_ANSWER_HOURS = 72;
const OPEN = ["requested", "accepted"];

/** The store's return window in days (0 means no returns), from its seller disclosure. */
export async function returnDays(storeId: string) {
  const store = await getStore(storeId);
  return Math.max(0, Math.min(30, store?.disclosure?.returnDays ?? 0));
}

export async function returnFor(orderId: string) {
  const db = await getDb();
  const rows = await db.select().from(returnRequests).where(eq(returnRequests.orderId, orderId));
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
}

/** When the buyer can still ask to return this order, or null. */
export async function returnWindowEnd(order: Order) {
  if (order.status !== "delivered" || !order.deliveredAt) return null;
  const days = await returnDays(order.storeId);
  if (!days) return null;
  const end = new Date(order.deliveredAt.getTime() + days * 86_400_000);
  if (end <= new Date()) return null;
  const last = await returnFor(order.id);
  return last ? null : end; // one return request per order
}

async function setOrderStatus(orderId: string, status: string) {
  const db = await getDb();
  await db.update(orders).set({ status, updatedAt: new Date() }).where(eq(orders.id, orderId));
}

/** The buyer asks to return a delivered order. The payout freezes until it's settled. */
export async function requestReturn(orderId: string, input: { reason: string; details: string; evidence?: string[] }) {
  const order = await getOrder(orderId);
  if (!order) throw new OrderError("Order not found.", 404);
  if (!RETURN_REASONS.includes(input.reason as (typeof RETURN_REASONS)[number])) throw new OrderError("Pick why you're returning it.");
  if (input.details.trim().length < 5) throw new OrderError("Tell the seller a little about why.");
  if (!(await returnWindowEnd(order))) throw new OrderError((await returnDays(order.storeId)) ? "The return window for this order has closed." : "This shop doesn't take returns. If something's wrong with it, report a problem.", 409);
  const db = await getDb();
  const [r] = await db
    .insert(returnRequests)
    .values({ id: `ret_${randomBytes(9).toString("base64url")}`, orderId, reason: input.reason, details: input.details.trim().slice(0, 2000), evidence: (input.evidence ?? []).slice(0, 6) })
    .returning();
  await db.update(holds).set({ state: "frozen", updatedAt: new Date() }).where(and(eq(holds.orderId, orderId), eq(holds.state, "held")));
  await setOrderStatus(orderId, "return_requested");
  await kv.log({ type: "order_status", actor: "user", userId: order.userId, dealId: order.dealId, detail: `${orderId}: buyer asked to return it (${input.reason}); payout frozen` });
  const { emitWebhook } = await import("../integrations/webhooks");
  await emitWebhook(order.storeId, "order.return_requested", { orderId, reason: input.reason, details: r.details });
  return r;
}

/** The seller accepts and says how the item comes back (pickup, or where to send it). */
export async function acceptReturn(orderId: string, instructions: string) {
  if (instructions.trim().length < 10) throw new OrderError("Tell the buyer how the item comes back to you.");
  const db = await getDb();
  const [r] = await db
    .update(returnRequests)
    .set({ status: "accepted", sellerNote: instructions.trim().slice(0, 1000), decidedAt: new Date() })
    .where(and(eq(returnRequests.orderId, orderId), eq(returnRequests.status, "requested")))
    .returning();
  if (!r) throw new OrderError("No return waiting for your answer on this order.", 409);
  const order = (await getOrder(orderId))!;
  await setOrderStatus(orderId, "return_accepted");
  await kv.log({ type: "order_status", actor: "seller", userId: order.userId, dealId: order.dealId, detail: `${orderId}: seller accepted the return` });
  await notifyShopperOrder(order, "return_accepted", { reason: r.sellerNote ?? undefined });
  return r;
}

/**
 * The seller declines with a reason. The order goes back to delivered with a 48-hour window so the
 * buyer can still report a problem (staff then decide), before the payout releases.
 */
export async function declineReturn(orderId: string, reason: string) {
  if (reason.trim().length < 10) throw new OrderError("Explain to the buyer why you can't take it back.");
  const db = await getDb();
  const [r] = await db
    .update(returnRequests)
    .set({ status: "declined", sellerNote: reason.trim().slice(0, 1000), decidedAt: new Date(), closedAt: new Date() })
    .where(and(eq(returnRequests.orderId, orderId), eq(returnRequests.status, "requested")))
    .returning();
  if (!r) throw new OrderError("No return waiting for your answer on this order.", 409);
  const order = (await getOrder(orderId))!;
  await db.update(holds).set({ state: "held", releaseAt: new Date(Date.now() + 48 * 3600_000), updatedAt: new Date() }).where(and(eq(holds.orderId, orderId), eq(holds.state, "frozen")));
  await setOrderStatus(orderId, "delivered");
  await kv.log({ type: "order_status", actor: "seller", userId: order.userId, dealId: order.dealId, detail: `${orderId}: seller declined the return: ${r.sellerNote}` });
  await notifyShopperOrder(order, "return_declined", { reason: r.sellerNote ?? undefined });
  return r;
}

/** The item is back with the seller: the buyer is refunded in full from the held payout. */
export async function returnReceived(orderId: string, by: string) {
  const db = await getDb();
  const [r] = await db.select().from(returnRequests).where(and(eq(returnRequests.orderId, orderId), eq(returnRequests.status, "accepted")));
  if (!r) throw new OrderError("Accept the return first.", 409);
  const order = (await getOrder(orderId))!;
  const held = await heldFor(order);
  const refunded = await refundOrder(orderId, held.sellerShare + held.fee + held.gst, "returned to the seller", by);
  await db.update(returnRequests).set({ status: "received", closedAt: new Date() }).where(eq(returnRequests.id, r.id));
  await putBackStock(order.productId);
  return refunded;
}

/** Scheduled: returns the seller hasn't answered in RETURN_ANSWER_HOURS become disputes for staff. */
export async function escalateUnansweredReturns(now = new Date()) {
  const db = await getDb();
  const stale = await db
    .select()
    .from(returnRequests)
    .where(and(eq(returnRequests.status, "requested"), lte(returnRequests.createdAt, new Date(now.getTime() - RETURN_ANSWER_HOURS * 3600_000))));
  const escalated: string[] = [];
  for (const r of stale) {
    const reason = r.reason === "damaged" || r.reason === "not_as_described" ? r.reason : "other";
    await db.insert(schema.disputes).values({ id: `dsp_${randomBytes(9).toString("base64url")}`, orderId: r.orderId, reason, details: `Return not answered by the seller in ${RETURN_ANSWER_HOURS} hours. Buyer said: ${r.details}`, evidence: r.evidence });
    await db.update(returnRequests).set({ status: "escalated", closedAt: now }).where(eq(returnRequests.id, r.id));
    await setOrderStatus(r.orderId, "disputed");
    escalated.push(r.orderId);
  }
  return escalated;
}

export async function returnsFor(orderIds: string[]) {
  if (!orderIds.length) return [];
  const db = await getDb();
  return db.select().from(returnRequests).where(and(inArray(returnRequests.orderId, orderIds), inArray(returnRequests.status, [...OPEN, "declined", "received", "escalated"])));
}
