import { CHECKOUT_GRACE_MS, placeOrder, syncCheckout } from "@/lib/checkout";
import { canActAsShopper } from "@/lib/deal-access";
import { markPaid, toPublic } from "@/lib/negotiate";
import { getOrderStatus, PAID_STATUSES } from "@ghostcart/payments";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { store } from "@/lib/store";

/** Deal status for the countdown terminal; checks Pine Labs while the lock fee or the balance is unpaid. */
export async function GET(request: Request) {
  // The deal page polls every 2–3 seconds and each poll may call Pine Labs; this allows several open tabs.
  const limited = await rateLimit({ name: "deal-poll:ip", id: clientIp(request), max: 900, windowSeconds: 10 * 60 });
  if (limited) return limited;
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
  const pub = toPublic(deal);
  // Anyone with the link sees the deal; only its shopper sees who it's being delivered to.
  if (pub.checkout && !(await canActAsShopper(deal))) delete pub.checkout.deliverTo;
  return Response.json(pub, { headers: { "Cache-Control": "no-store" } });
}
