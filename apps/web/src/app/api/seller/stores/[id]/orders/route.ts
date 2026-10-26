import { requireStoreAccess } from "@/lib/shop/access";
import { disputeFor, shipmentsFor } from "@/lib/orders/fulfilment";
import { ordersForStore, storeMoney } from "@/lib/orders/service";

/** The seller's orders. Addresses are included only while the seller still has to ship. */
export async function GET(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/orders">) {
  const { store, denied } = await requireStoreAccess(request, (await ctx.params).id, "view");
  if (denied) return denied;
  const [orders, money] = await Promise.all([ordersForStore(store.id), storeMoney(store.id)]);
  const shipments = new Map((await shipmentsFor(orders.map((o) => o.id))).map((s) => [s.orderId, s]));
  const rows = await Promise.all(
    orders.map(async (o) => {
      const s = shipments.get(o.id);
      const d = o.status === "disputed" ? await disputeFor(o.id) : undefined;
      return {
        id: o.id,
        dealId: o.dealId,
        title: o.title,
        total: o.total,
        sellerShare: o.sellerShare,
        status: o.status,
        testPayments: o.testPayments,
        shipBy: o.shipBy,
        createdAt: o.createdAt,
        deliveredAt: o.deliveredAt,
        address: o.status === "placed" || o.status === "shipped" ? o.address : undefined,
        shipment: s && { courier: s.courier, awb: s.awb, lastStatus: s.lastStatus, trackingProvider: s.trackingProvider }, // never the handover code
        dispute: d && { reason: d.reason, details: d.details, sellerResponse: d.sellerResponse, createdAt: d.createdAt },
      };
    }),
  );
  return Response.json({ held: money.held, released: money.released, orders: rows }, { headers: { "Cache-Control": "no-store" } });
}
