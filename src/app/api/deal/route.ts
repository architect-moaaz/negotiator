import { CHECKOUT_GRACE_MS, placeOrder, syncCheckout } from "@/lib/checkout";
import { markPaid, toPublic } from "@/lib/negotiate";
import { getOrderStatus, PAID_STATUSES } from "@/lib/pinelabs";
import { store } from "@/lib/store";

/** Deal status for the countdown terminal; checks Pine Labs while the lock fee or the balance is unpaid. */
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

  const c = deal.checkout;
  if (c?.status === "awaiting" && c.pinelabsOrderId && Date.now() < c.dueAt + CHECKOUT_GRACE_MS) {
    try {
      if (PAID_STATUSES.has(await getOrderStatus(c.pinelabsOrderId))) deal = await placeOrder(deal, "pinelabs");
    } catch (err) {
      console.warn("Pine Labs balance check failed", err);
    }
  }
  await syncCheckout(deal);
  return Response.json(toPublic(deal), { headers: { "Cache-Control": "no-store" } });
}
