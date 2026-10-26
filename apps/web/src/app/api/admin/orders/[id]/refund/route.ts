import { toPaise } from "@ghostcart/core";
import { OrderError, refundOrder } from "@/lib/orders/service";
import { audit, requireStaff } from "@/lib/staff";

/** Staff refund from held money. Body: { amountInr, reason }. */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/orders/[id]/refund">) {
  const { staff, denied } = await requireStaff(request, "finance");
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { amountInr?: number; reason?: string };
  if (!body.reason?.trim()) return Response.json({ error: "Give a reason for the refund." }, { status: 400 });
  try {
    const order = await refundOrder(id, toPaise(Number(body.amountInr)), body.reason.trim().slice(0, 200), staff.name);
    await audit(staff, `refunded ₹${body.amountInr} on order ${id}: ${body.reason}`, order?.dealId);
    return Response.json(order);
  } catch (err) {
    if (err instanceof OrderError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
