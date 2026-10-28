import { evidencePack } from "@/lib/orders/evidence";
import { requireStaff } from "@/lib/staff";
import { store as kv } from "@/lib/store";

/** Staff: download an order's evidence pack (JSON) for a chargeback or complaint. Contains PII; logged. */
export async function GET(request: Request, ctx: RouteContext<"/api/admin/orders/[id]/evidence">) {
  const { staff, denied } = await requireStaff(request, "pii");
  if (denied) return denied;
  const { id: orderId } = await ctx.params;
  const pack = await evidencePack(orderId);
  if (!pack) return Response.json({ error: "Order not found." }, { status: 404 });
  await kv.log({ type: "staff_action", actor: "human", detail: `${staff.name} downloaded the evidence pack for ${orderId}` });
  return new Response(JSON.stringify(pack, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="evidence-${orderId}.json"`, "Cache-Control": "no-store" },
  });
}
