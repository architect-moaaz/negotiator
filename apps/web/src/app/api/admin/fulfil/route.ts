import { DealConflictError } from "@/lib/errors";
import { advanceOrder, CheckoutError } from "@/lib/checkout";
import { toPublic } from "@/lib/negotiate";
import { audit, requireStaff } from "@/lib/staff";
import { store } from "@/lib/store";

/** Deal desk: move a placed order to its next delivery stage (confirmed → shipped → out for delivery → delivered). */
export async function POST(request: Request) {
  const { staff, denied } = await requireStaff(request, "fulfil");
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { id?: string; courier?: string; awb?: string };
  const deal = body.id ? await store.getDeal(body.id) : undefined;
  if (!deal) return Response.json({ error: "Deal not found." }, { status: 404 });
  try {
    const updated = await advanceOrder(deal, { courier: body.courier, awb: body.awb, by: staff.name });
    await audit(staff, `moved the order to ${updated.checkout?.tracking?.at(-1)?.stage ?? "its next stage"}`, deal.id);
    return Response.json(toPublic(updated));
  } catch (err) {
    if (err instanceof CheckoutError) return Response.json({ error: err.message }, { status: err.status });
    if (err instanceof DealConflictError) return Response.json({ error: err.message }, { status: 409 });
    throw err;
  }
}
