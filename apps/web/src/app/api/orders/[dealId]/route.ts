import { schema } from "@ghostcart/db";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { canActAsShopper } from "@/lib/deal-access";
import { canDispute, confirmReceivedByBuyer, disputeFor, openDispute, shipmentFor } from "@/lib/orders/fulfilment";
import { requestReturn, returnFor, returnWindowEnd } from "@/lib/orders/returns";
import { OrderError, orderForDeal } from "@/lib/orders/service";
import { addReview, canReview, reviewForOrder } from "@/lib/reviews";
import { store as kv } from "@/lib/store";

async function load(dealId: string) {
  const deal = await kv.getDeal(dealId);
  if (!deal || !(await canActAsShopper(deal))) return null;
  const order = await orderForDeal(dealId);
  return order ? { deal, order } : null;
}

/** The buyer's view of their shop order: status, tracking, the handover code, and any problem raised. */
export async function GET(_request: Request, ctx: RouteContext<"/api/orders/[dealId]">) {
  const found = await load((await ctx.params).dealId);
  if (!found) return Response.json({ error: "Order not found." }, { status: 404 });
  const { order } = found;
  const [shipment, dispute, ret, returnEnds, review, reviewable, db] = await Promise.all([
    shipmentFor(order.id),
    disputeFor(order.id),
    returnFor(order.id),
    returnWindowEnd(order),
    reviewForOrder(order.id),
    canReview(order),
    getDb(),
  ]);
  const [hold] = await db.select().from(schema.holds).where(eq(schema.holds.orderId, order.id));
  return Response.json(
    {
      status: order.status,
      shipBy: order.shipBy,
      deliveredAt: order.deliveredAt,
      problemWindowEndsAt: order.status === "delivered" ? hold?.releaseAt : undefined,
      canReportProblem: await canDispute(order),
      shipment: shipment && { courier: shipment.courier, awb: shipment.awb, lastStatus: shipment.lastStatus, events: shipment.events, handoverCode: shipment.handoverCode },
      dispute: dispute && { reason: dispute.reason, status: dispute.status, resolution: dispute.resolution },
      returnWindowEndsAt: returnEnds ?? undefined,
      returnRequest: ret && { reason: ret.reason, status: ret.status, sellerNote: ret.sellerNote },
      canReview: reviewable,
      review: review && { rating: review.rating, body: review.body, sellerReply: review.sellerReply },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Body: { action: "received" } | { action: "problem", reason, details } | { action: "return", reason, details }. */
export async function POST(request: Request, ctx: RouteContext<"/api/orders/[dealId]">) {
  const found = await load((await ctx.params).dealId);
  if (!found) return Response.json({ error: "Order not found." }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { action?: string; reason?: string; details?: string; rating?: unknown };
  try {
    if (body.action === "received") await confirmReceivedByBuyer(found.order.id);
    else if (body.action === "problem") await openDispute(found.order.id, { reason: body.reason ?? "", details: body.details ?? "" });
    else if (body.action === "review") await addReview(found.order.id, found.order.userId, { rating: Number(body.rating), body: body.details });
    else if (body.action === "return") await requestReturn(found.order.id, { reason: body.reason ?? "", details: body.details ?? "" });
    else return Response.json({ error: "Unknown action." }, { status: 400 });
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof OrderError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
