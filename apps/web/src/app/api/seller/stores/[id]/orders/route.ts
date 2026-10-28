import { requireStoreAccess } from "@/lib/shop/access";
import { disputeFor, shipmentsFor } from "@/lib/orders/fulfilment";
import { returnsFor } from "@/lib/orders/returns";
import { ordersForStore, storeMoney } from "@/lib/orders/service";
import { trackingProvider } from "@/lib/orders/tracking";

/** The seller's orders. Addresses are included only while the seller still has to ship. */
export async function GET(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/orders">) {
  const { store, denied } = await requireStoreAccess(request, (await ctx.params).id, "view");
  if (denied) return denied;
  const [orders, money] = await Promise.all([ordersForStore(store.id), storeMoney(store.id)]);
  const shipments = new Map((await shipmentsFor(orders.map((o) => o.id))).map((s) => [s.orderId, s]));
  const returns = new Map((await returnsFor(orders.filter((o) => o.status.startsWith("return_")).map((o) => o.id))).map((r) => [r.orderId, r]));
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
        // Never the handover code.
        shipment: s && { courier: s.courier, awb: s.awb, lastStatus: s.lastStatus, trackingProvider: s.trackingProvider, labelUrl: s.labelUrl, pickupAt: s.pickupAt },
        returnRequest: (() => {
          const r = returns.get(o.id);
          return r && { reason: r.reason, details: r.details, status: r.status, sellerNote: r.sellerNote, createdAt: r.createdAt };
        })(),
        dispute: d && { reason: d.reason, details: d.details, sellerResponse: d.sellerResponse, createdAt: d.createdAt },
      };
    }),
  );
  const canBook = !!trackingProvider()?.book;
  return Response.json({ held: money.held, released: money.released, orders: rows, canBook }, { headers: { "Cache-Control": "no-store" } });
}
