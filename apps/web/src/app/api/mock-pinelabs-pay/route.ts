import { mockGetOrder, mockSetStatus, pinelabsMockEnabled } from "@/lib/pinelabs-mock";

/** Test-mode payment page actions: show the order, then pay or decline it. */
export async function GET(request: Request) {
  if (!pinelabsMockEnabled) return new Response("Not found", { status: 404 });
  const order = await mockGetOrder(new URL(request.url).searchParams.get("order") ?? "");
  return order ? Response.json(order) : Response.json({ error: "Order not found" }, { status: 404 });
}

export async function POST(request: Request) {
  if (!pinelabsMockEnabled) return new Response("Not found", { status: 404 });
  const { order: id, action } = (await request.json().catch(() => ({}))) as { order?: string; action?: string };
  const order = id ? await mockGetOrder(id) : undefined;
  if (!order) return Response.json({ error: "Order not found" }, { status: 404 });
  if (order.status === "PROCESSED") return Response.json(order);
  // Like a real UPI retry: a declined attempt can be tried again while the deal is open.
  if (action === "retry" && order.status === "FAILED") return Response.json(await mockSetStatus(order.order_id, "PENDING"));
  if (order.status !== "PENDING") return Response.json({ error: `Order is ${order.status}` }, { status: 409 });
  return Response.json(await mockSetStatus(order.order_id, action === "decline" ? "FAILED" : "PROCESSED"));
}
