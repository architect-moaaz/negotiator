import { toPaise } from "@ghostcart/core";
import { openDisputes, resolveDispute } from "@/lib/orders/fulfilment";
import { OrderError } from "@/lib/orders/service";
import { audit, requireStaff } from "@/lib/staff";

export async function GET(request: Request) {
  const { denied } = await requireStaff(request, "decide");
  if (denied) return denied;
  const rows = await openDisputes();
  return Response.json(
    rows.map(({ dispute, order }) => ({ dispute, order: { id: order.id, dealId: order.dealId, title: order.title, total: order.total, storeId: order.storeId, deliveredAt: order.deliveredAt, shippedAt: order.shippedAt } })),
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Body: { disputeId, outcome: "refunded" | "partial_refund" | "released", amountInr?, note }. Money moves, so finance permission. */
export async function POST(request: Request) {
  const { staff, denied } = await requireStaff(request, "finance");
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { disputeId?: string; outcome?: "refunded" | "partial_refund" | "released"; amountInr?: number; note?: string };
  if (!body.disputeId || !body.outcome) return Response.json({ error: "Pick a dispute and an outcome." }, { status: 400 });
  try {
    const order = await resolveDispute(body.disputeId, { outcome: body.outcome, amount: body.amountInr ? toPaise(Number(body.amountInr)) : undefined, note: body.note ?? "" }, staff.name);
    await audit(staff, `resolved dispute ${body.disputeId}: ${body.outcome}${body.amountInr ? ` ₹${body.amountInr}` : ""} (${body.note})`, order?.dealId);
    return Response.json(order);
  } catch (err) {
    if (err instanceof OrderError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
