import { schema } from "@ghostcart/db";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { consentHistory } from "../privacy/consent";
import { getStore } from "../shop/stores";
import { store as kv } from "../store";
import { getOrder } from "./service";

const { disputes, holds, refunds, returnRequests, shipments } = schema;

/**
 * Everything GhostCart knows that shows an order was real and fulfilled, in one document, for answering
 * a bank chargeback or a consumer complaint: payment, delivery address, courier tracking, how delivery
 * was confirmed, the haggle transcript, consents, and any refunds, disputes or returns. Staff only (PII).
 */
export async function evidencePack(orderId: string) {
  const order = await getOrder(orderId);
  if (!order) return null;
  const db = await getDb();
  const [deal, store, [shipment], [hold], refundRows, disputeRows, returnRows, consents, log] = await Promise.all([
    kv.getDeal(order.dealId),
    getStore(order.storeId),
    db.select().from(shipments).where(eq(shipments.orderId, orderId)),
    db.select().from(holds).where(eq(holds.orderId, orderId)),
    db.select().from(refunds).where(eq(refunds.orderId, orderId)),
    db.select().from(disputes).where(eq(disputes.orderId, orderId)),
    db.select().from(returnRequests).where(eq(returnRequests.orderId, orderId)),
    consentHistory(order.userId),
    kv.listLog(20_000),
  ]);
  const user = await kv.getUser(order.userId);
  const timeline = log.filter((a) => a.dealId === order.dealId).sort((a, b) => a.at - b.at).map((a) => ({ at: new Date(a.at).toISOString(), what: a.type, actor: a.actor, detail: a.detail }));
  const rupees = (paise: number) => paise / 100;
  return {
    generatedAt: new Date().toISOString(),
    order: {
      id: order.id,
      orderRef: deal?.checkout?.orderRef,
      title: order.title,
      status: order.status,
      placedAt: order.createdAt,
      shippedAt: order.shippedAt,
      deliveredAt: order.deliveredAt,
      totalInr: rupees(order.total),
      testPayments: order.testPayments,
    },
    seller: { storeId: order.storeId, name: store?.name, disclosure: store?.disclosure ?? null },
    buyer: { userId: order.userId, name: user?.name, phone: user?.phone, email: user?.email, signedUpAt: user?.createdAt ? new Date(user.createdAt).toISOString() : undefined },
    payment: {
      gatewayOrderId: deal?.checkout?.pinelabsOrderId ?? deal?.pinelabsOrderId,
      // The checkout opens the moment the lock fee is paid.
      lockPaidAt: deal?.checkout?.openedAt ? new Date(deal.checkout.openedAt).toISOString() : undefined,
      balancePaidAt: deal?.checkout?.paidAt ? new Date(deal.checkout.paidAt).toISOString() : undefined,
      hold: hold && { state: hold.state, gatewayRef: hold.gatewayRef, releaseAt: hold.releaseAt, releasedAt: hold.releasedAt },
    },
    deliveryAddress: order.address,
    shipment: shipment && {
      courier: shipment.courier,
      awb: shipment.awb,
      trackingProvider: shipment.trackingProvider,
      lastStatus: shipment.lastStatus,
      events: shipment.events,
      bookedPickupAt: shipment.pickupAt,
    },
    deliveryConfirmedBy: timeline.find((t) => /: delivered \(/.test(t.detail))?.detail.replace(/^.*delivered \(([^)]+)\).*$/, "$1"),
    haggle: deal?.negotiation?.messages.map((m) => ({ at: new Date(m.at).toISOString(), from: m.from, text: m.text, price: m.price })) ?? [],
    consents: consents.map((c) => ({ purpose: c.purpose, action: c.action, wording: c.wording, source: c.source, at: c.createdAt })),
    refunds: refundRows.map((r) => ({ amountInr: rupees(r.amount), reason: r.reason, status: r.status, gatewayRef: r.gatewayRef, at: r.createdAt })),
    disputes: disputeRows.map((d) => ({ reason: d.reason, details: d.details, sellerResponse: d.sellerResponse, status: d.status, resolution: d.resolution, at: d.createdAt })),
    returns: returnRows.map((r) => ({ reason: r.reason, details: r.details, status: r.status, sellerNote: r.sellerNote, at: r.createdAt })),
    timeline,
  };
}
