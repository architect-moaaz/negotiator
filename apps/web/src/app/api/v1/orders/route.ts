import { bearer, storeForKey } from "@/lib/integrations/keys";
import { orderPayload, ordersForStore } from "@/lib/orders/service";

/** Orders for the seller's systems. ?status=placed,shipped. Addresses only while there's something to ship. */
export async function GET(request: Request) {
  const found = await storeForKey(bearer(request), "secret");
  if (!found) return Response.json({ error: "Invalid or revoked API key." }, { status: 401 });
  const status = new URL(request.url).searchParams.get("status")?.split(",").filter(Boolean);
  const orders = await ordersForStore(found.store.id, status?.length ? status : undefined);
  return Response.json({ orders: orders.map((o) => orderPayload(o, { withAddress: o.status === "placed" || o.status === "shipped" })) });
}
