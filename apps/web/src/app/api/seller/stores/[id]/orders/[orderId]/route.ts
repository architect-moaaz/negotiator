import { confirmWithHandoverCode, markShipped, respondToDispute } from "@/lib/orders/fulfilment";
import { getOrder, OrderError } from "@/lib/orders/service";
import { logSellerAction, requireStoreAccess } from "@/lib/shop/access";

/** Body: { action: "ship", courier, awb } | { action: "handover", code } | { action: "respond", response }. */
export async function POST(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/orders/[orderId]">) {
  const { id, orderId } = await ctx.params;
  const { store, phone, denied } = await requireStoreAccess(request, id, "catalogue");
  if (denied) return denied;
  const order = await getOrder(orderId);
  if (!order || order.storeId !== store.id) return Response.json({ error: "Order not found." }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { action?: string; courier?: string; awb?: string; code?: string; response?: string };
  try {
    if (body.action === "ship") await markShipped(orderId, { courier: body.courier ?? "", awb: body.awb ?? "" }, phone);
    else if (body.action === "handover") await confirmWithHandoverCode(orderId, body.code ?? "");
    else if (body.action === "respond") {
      if (!body.response?.trim()) return Response.json({ error: "Write your side of the story." }, { status: 400 });
      await respondToDispute(orderId, body.response);
    } else return Response.json({ error: "Unknown action." }, { status: 400 });
    await logSellerAction(store, phone, `${body.action} on order ${orderId}`);
    return Response.json(await getOrder(orderId));
  } catch (err) {
    if (err instanceof OrderError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
