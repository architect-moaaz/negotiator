import { schema } from "@ghostcart/db";
import { and, asc, eq, gt } from "drizzle-orm";
import { getDb } from "./db";
import { track } from "./telemetry";
import type { Deal } from "./types";

const { negotiationEvents } = schema;

export type NegotiationEvent = typeof negotiationEvents.$inferSelect;
export type EventType = "started" | "offer" | "counter" | "hold" | "final" | "escalated" | "approved" | "rejected" | "countered" | "agreed" | "paid" | "address" | "ordered";

/**
 * Append what just happened to a deal (call after it's saved, so the version matches). A failed write
 * is logged, never thrown: the negotiation itself already succeeded.
 */
export async function recordEvent(deal: Deal, type: EventType, actor: "shopper" | "agent" | "seller" | "desk" | "system", detail: { price?: number; message?: string } = {}) {
  try {
    const db = await getDb();
    await db.insert(negotiationEvents).values({ dealId: deal.id, version: deal.version ?? 1, type, actor, price: detail.price === undefined ? null : Math.round(detail.price), status: deal.status, message: detail.message?.slice(0, 1000) ?? null });
  } catch (err) {
    console.error("negotiation event write failed", err);
  }
  // The product funnel: started → offer → escalated → agreed → paid → ordered.
  await track(`negotiation_${type}`, deal.userId ?? deal.id, { actor, channel: deal.channel, store: deal.shop?.storeId ?? null, price: detail.price ?? null, list_price: deal.originalPrice });
}

/** A deal's events after `afterId` (0 for all), oldest first. */
export async function eventsFor(dealId: string, afterId = 0) {
  const db = await getDb();
  return db.select().from(negotiationEvents).where(and(eq(negotiationEvents.dealId, dealId), gt(negotiationEvents.id, afterId))).orderBy(asc(negotiationEvents.id));
}
