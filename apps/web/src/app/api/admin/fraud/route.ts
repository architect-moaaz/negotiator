import { clearOrderFlag, fraudOverview } from "@/lib/fraud/checks";
import { audit, requireStaff } from "@/lib/staff";

/** Fraud dashboard: recent risk events, flagged orders (payout held), risky sellers and buyers. */
export async function GET(request: Request) {
  const { denied } = await requireStaff(request, "review");
  if (denied) return denied;
  return Response.json(await fraudOverview(), { headers: { "Cache-Control": "no-store" } });
}

/** Clear a flagged order after review. Body: { orderId, note }. */
export async function POST(request: Request) {
  const { staff, denied } = await requireStaff(request, "finance");
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { orderId?: string; note?: string };
  if (!body.orderId || !body.note?.trim()) return Response.json({ error: "Pick an order and say why it's fine." }, { status: 400 });
  await clearOrderFlag(body.orderId, staff.name);
  await audit(staff, `cleared fraud flag on order ${body.orderId}: ${body.note}`);
  return Response.json({ ok: true });
}
