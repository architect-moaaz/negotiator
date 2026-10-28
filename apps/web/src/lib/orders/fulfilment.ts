import { schema } from "@ghostcart/db";
import { and, eq, inArray } from "drizzle-orm";
import { randomBytes, randomInt } from "node:crypto";
import { getDb } from "../db";
import { notifyShopperOrder } from "../notify/order-updates";
import { store as kv } from "../store";
import type { FulfilmentStage } from "../types";
import { getOrder, heldFor, markDelivered, OrderError, orderPayload, refundOrder, type Order } from "./service";
import { trackingProvider } from "./tracking";

const { disputes, holds, orders, shipments } = schema;

export type Shipment = typeof shipments.$inferSelect;
export type Dispute = typeof disputes.$inferSelect;

const DISPUTE_REASONS = ["not_received", "damaged", "not_as_described", "other"] as const;
/** Buyers can report "not received" this long after the ship-by time, even without a delivery scan. */
const NOT_RECEIVED_AFTER_DAYS = 7;

/** Mirror a stage onto the deal so the shopper's order page shows it (the deal holds the shopper-facing timeline). */
async function syncDeal(order: Order, stage: FulfilmentStage, extra: { courier?: string; awb?: string; note?: string } = {}) {
  const deal = await kv.getDeal(order.dealId);
  if (!deal?.checkout) return;
  const c = deal.checkout;
  c.tracking = [...(c.tracking ?? []).filter((t) => t.stage !== stage), { stage, at: Date.now(), note: extra.note }];
  if (extra.courier) c.courier = extra.courier;
  if (extra.awb) c.awb = extra.awb;
  await kv.saveDeal(deal);
}

export async function shipmentFor(orderId: string) {
  const db = await getDb();
  const [s] = await db.select().from(shipments).where(eq(shipments.orderId, orderId));
  return s;
}

/** The seller hands the parcel to a courier. A courier and AWB are required; tracking starts from here. */
export async function markShipped(orderId: string, input: { courier: string; awb: string }, by: string) {
  const courier = input.courier.trim().slice(0, 40);
  const awb = input.awb.trim().toUpperCase().replace(/\s/g, "").slice(0, 40);
  if (courier.length < 2) throw new OrderError("Add the courier name.");
  if (!/^[A-Z0-9-]{6,40}$/.test(awb)) throw new OrderError("Add the AWB (tracking number) from the courier slip.");
  const order = await getOrder(orderId);
  if (!order) throw new OrderError("Order not found.", 404);
  if (order.status !== "placed") throw new OrderError(`This order is ${order.status}.`, 409);
  const db = await getDb();
  const provider = trackingProvider();
  await db.insert(shipments).values({ orderId, courier, awb, trackingProvider: provider?.name ?? "none", handoverCode: String(randomInt(1000, 10000)) });
  await db.update(orders).set({ status: "shipped", shippedAt: new Date(), updatedAt: new Date() }).where(eq(orders.id, orderId));
  await syncDeal(order, "shipped", { courier, awb, note: `${courier} · AWB ${awb}` });
  await kv.log({ type: "order_status", actor: "seller", userId: order.userId, dealId: order.dealId, detail: `${orderId}: shipped by ${by} with ${courier}, AWB ${awb}` });
  await notifyShopperOrder(order, "shipped", { courier, awb });
  const shipped = (await getOrder(orderId))!;
  const { emitWebhook } = await import("../integrations/webhooks");
  await emitWebhook(shipped.storeId, "order.shipped", { ...orderPayload(shipped), courier, awb });
  return shipped;
}

/** Parcel size limits we accept from the seller's form (kg, cm). */
const PARCEL = { weightKg: [0.05, 50], side: [1, 200] } as const;

/**
 * One-click pickup: the aggregator books a courier for the order, assigns an AWB, schedules pickup from
 * the seller's saved pickup location and makes a shipping label. The order is then shipped as usual.
 */
export async function bookPickup(orderId: string, input: { weightKg: number; lengthCm: number; breadthCm: number; heightCm: number; pickupLocation?: string }, by: string) {
  const provider = trackingProvider();
  if (!provider?.book) throw new OrderError("Pickup booking isn't set up yet. Enter the courier and AWB yourself.", 503);
  const order = await getOrder(orderId);
  if (!order) throw new OrderError("Order not found.", 404);
  if (order.status !== "placed") throw new OrderError(`This order is ${order.status}.`, 409);
  const inRange = (v: number, [lo, hi]: readonly [number, number]) => Number.isFinite(v) && v >= lo && v <= hi;
  if (!inRange(input.weightKg, PARCEL.weightKg)) throw new OrderError("Weight must be between 0.05 and 50 kg.");
  if (![input.lengthCm, input.breadthCm, input.heightCm].every((v) => inRange(v, PARCEL.side))) throw new OrderError("Each side must be between 1 and 200 cm.");
  const a = order.address as Record<string, string>;
  const db = await getDb();
  const [product] = order.productId ? await db.select().from(schema.products).where(eq(schema.products.id, order.productId)) : [];
  let booking;
  try {
    booking = await provider.book({
      orderId: order.id,
      createdAt: order.createdAt,
      pickupLocation: input.pickupLocation?.trim().slice(0, 60) || "Primary",
      item: { title: order.title, sku: product?.sku ?? product?.id ?? order.id, quantity: 1, price: Math.round(order.total / 100) },
      total: Math.round(order.total / 100),
      address: { name: a.name, phone: a.phone, line1: a.line1, line2: a.line2, city: a.city, state: a.state, pincode: a.pincode },
      parcel: { weightKg: input.weightKg, lengthCm: input.lengthCm, breadthCm: input.breadthCm, heightCm: input.heightCm },
    });
  } catch (err) {
    throw new OrderError(err instanceof Error ? err.message : "Couldn't book the pickup.", 502);
  }
  const shipped = await markShipped(orderId, { courier: booking.courier, awb: booking.awb }, by);
  await db.update(shipments).set({ bookingRef: booking.ref, labelUrl: booking.labelUrl ?? null, pickupAt: booking.pickupAt ?? null }).where(eq(shipments.orderId, orderId));
  return { order: shipped, booking };
}

async function confirmDelivery(order: Order, via: string, at?: Date) {
  const updated = await markDelivered(order.id, via, at);
  await syncDeal(order, "delivered", { note: via });
  return updated;
}

/** The seller (or their courier) enters the buyer's handover code at the door. */
export async function confirmWithHandoverCode(orderId: string, code: string) {
  const order = await getOrder(orderId);
  const s = await shipmentFor(orderId);
  if (!order || !s) throw new OrderError("Ship the order first.", 409);
  if (s.handoverCode !== code.replace(/\D/g, "")) throw new OrderError("That code doesn't match. Ask the buyer to read it from their order page.");
  return confirmDelivery(order, "buyer's handover code");
}

/** The buyer says it arrived. */
export async function confirmReceivedByBuyer(orderId: string) {
  const order = await getOrder(orderId);
  if (!order) throw new OrderError("Order not found.", 404);
  if (order.status !== "shipped" && order.status !== "placed") throw new OrderError(`This order is ${order.status}.`, 409);
  return confirmDelivery(order, "buyer confirmed receipt");
}

/** Ask the tracking provider about every shipped order; deliveries start the dispute window. */
export async function pollTracking() {
  const provider = trackingProvider();
  if (!provider) return { checked: 0, delivered: [] as string[] };
  const db = await getDb();
  const open = await db
    .select({ order: orders, shipment: shipments })
    .from(shipments)
    .innerJoin(orders, eq(orders.id, shipments.orderId))
    .where(and(eq(orders.status, "shipped"), eq(shipments.trackingProvider, provider.name)));
  const delivered: string[] = [];
  for (const { order, shipment } of open) {
    try {
      const t = await provider.track(shipment.awb, shipment.courier);
      await db.update(shipments).set({ lastStatus: t.status, events: t.events, lastCheckedAt: new Date() }).where(eq(shipments.orderId, order.id));
      if (t.status === "out_for_delivery") {
        await syncDeal(order, "out_for_delivery", { note: "Out for delivery" });
        await notifyShopperOrder(order, "out_for_delivery");
      }
      if (t.status === "delivered") {
        await confirmDelivery(order, `${provider.name} tracking`, t.deliveredAt);
        delivered.push(order.id);
      }
    } catch (err) {
      console.error(`tracking failed for ${order.id}`, err);
    }
  }
  return { checked: open.length, delivered };
}

/** Can the buyer report a problem now? Within the dispute window after delivery, or "not received" well after ship-by. */
export async function canDispute(order: Order) {
  const db = await getDb();
  const [hold] = await db.select().from(holds).where(eq(holds.orderId, order.id));
  if (order.status === "delivered") return !!hold?.releaseAt && hold.releaseAt > new Date();
  if (order.status === "shipped" || order.status === "placed") return Date.now() > order.shipBy.getTime() + NOT_RECEIVED_AFTER_DAYS * 24 * 60 * 60 * 1000;
  return false;
}

/** The buyer reports a problem. The payout freezes until staff decide. */
export async function openDispute(orderId: string, input: { reason: string; details: string; evidence?: string[] }) {
  const order = await getOrder(orderId);
  if (!order) throw new OrderError("Order not found.", 404);
  if (!DISPUTE_REASONS.includes(input.reason as (typeof DISPUTE_REASONS)[number])) throw new OrderError("Pick what went wrong.");
  if (input.details.trim().length < 10) throw new OrderError("Tell us a little more about what happened.");
  if (!(await canDispute(order))) throw new OrderError(order.status === "delivered" ? "The window to report a problem has closed." : "You can report this once the delivery window has passed.", 409);
  const db = await getDb();
  const [existing] = await db.select().from(disputes).where(and(eq(disputes.orderId, orderId), eq(disputes.status, "open")));
  if (existing) return existing;
  const [dispute] = await db
    .insert(disputes)
    .values({ id: `dsp_${randomBytes(9).toString("base64url")}`, orderId, reason: input.reason, details: input.details.trim().slice(0, 2000), evidence: (input.evidence ?? []).slice(0, 6) })
    .returning();
  await db.update(holds).set({ state: "frozen", updatedAt: new Date() }).where(and(eq(holds.orderId, orderId), eq(holds.state, "held")));
  await db.update(orders).set({ status: "disputed", updatedAt: new Date() }).where(eq(orders.id, orderId));
  await kv.log({ type: "order_status", actor: "user", userId: order.userId, dealId: order.dealId, detail: `${orderId}: buyer reported ${input.reason}; payout frozen` });
  return dispute;
}

export async function respondToDispute(orderId: string, response: string, evidence: string[] = []) {
  const db = await getDb();
  const [d] = await db
    .update(disputes)
    .set({ sellerResponse: response.trim().slice(0, 2000), sellerEvidence: evidence.slice(0, 6) })
    .where(and(eq(disputes.orderId, orderId), eq(disputes.status, "open")))
    .returning();
  if (!d) throw new OrderError("No open problem on this order.", 404);
  return d;
}

/**
 * Staff decision on a dispute: refund the buyer in full, refund part, or release to the seller.
 * Released disputes go back to "delivered" so the normal release job pays out.
 */
export async function resolveDispute(disputeId: string, decision: { outcome: "refunded" | "partial_refund" | "released"; amount?: number; note: string }, by: string) {
  const db = await getDb();
  const [d] = await db.select().from(disputes).where(eq(disputes.id, disputeId));
  if (!d || d.status !== "open") throw new OrderError("That problem is already resolved.", 409);
  if (!decision.note.trim()) throw new OrderError("Write down why, for the buyer and seller.");
  const order = (await getOrder(d.orderId))!;
  if (decision.outcome === "refunded") {
    const held = await heldFor(order);
    await refundOrder(order.id, held.sellerShare + held.fee + held.gst, `dispute ${d.reason}: ${decision.note}`, by);
  } else {
    if (decision.outcome === "partial_refund") {
      if (!decision.amount) throw new OrderError("Enter the refund amount.");
      await refundOrder(order.id, decision.amount, `dispute ${d.reason} (partial): ${decision.note}`, by);
    }
    await db.update(holds).set({ state: "held", updatedAt: new Date() }).where(and(eq(holds.orderId, order.id), eq(holds.state, "frozen")));
    // Back to delivered so the release job pays the rest; if it never arrived, delivery is the resolution time.
    await db
      .update(orders)
      .set({ status: "delivered", deliveredAt: order.deliveredAt ?? new Date(), updatedAt: new Date() })
      .where(eq(orders.id, order.id));
    await db.update(holds).set({ releaseAt: new Date() }).where(eq(holds.orderId, order.id));
  }
  await db.update(disputes).set({ status: decision.outcome, resolution: decision.note.trim().slice(0, 1000), resolvedBy: by, resolvedAt: new Date() }).where(eq(disputes.id, disputeId));
  await kv.log({ type: "order_status", actor: "human", userId: order.userId, dealId: order.dealId, detail: `${order.id}: dispute ${decision.outcome} by ${by}: ${decision.note}` });
  return getOrder(order.id);
}

export async function openDisputes() {
  const db = await getDb();
  return db.select({ dispute: disputes, order: orders }).from(disputes).innerJoin(orders, eq(orders.id, disputes.orderId)).where(eq(disputes.status, "open"));
}

export async function disputeFor(orderId: string) {
  const db = await getDb();
  const rows = await db.select().from(disputes).where(eq(disputes.orderId, orderId));
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
}

export async function shipmentsFor(orderIds: string[]) {
  if (!orderIds.length) return [];
  const db = await getDb();
  return db.select().from(shipments).where(inArray(shipments.orderId, orderIds));
}
