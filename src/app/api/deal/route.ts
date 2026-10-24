import { markPaid, toPublic } from "@/lib/negotiate";
import { getOrderStatus, PAID_STATUSES } from "@/lib/pinelabs";
import { store } from "@/lib/store";

/** Deal status for the countdown terminal; checks Pine Labs while the deal is still pending. */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  let deal = id ? await store.getDeal(id) : undefined;
  if (!deal) return Response.json({ error: "not found" }, { status: 404 });

  // Check the gateway even just after expiry, so a payment made in the last second still counts.
  const recentlyLive = Date.now() < deal.expiresAt + 30_000;
  if (deal.status !== "paid" && deal.pinelabsOrderId && recentlyLive) {
    try {
      if (PAID_STATUSES.has(await getOrderStatus(deal.pinelabsOrderId))) deal = await markPaid(deal, "pinelabs");
    } catch (err) {
      console.warn("Pine Labs status check failed", err);
    }
  }
  return Response.json(toPublic(deal), { headers: { "Cache-Control": "no-store" } });
}
