import { applyRecommendation } from "@/lib/deal-desk";
import { decideApproval, HaggleError, toPublic } from "@/lib/negotiate";
import { audit, requireStaff } from "@/lib/staff";
import { store } from "@/lib/store";

/** Human deal desk: approve or reject a price the seller agent couldn't agree to on its own. */
export async function POST(request: Request) {
  const { staff, denied } = await requireStaff(request, "decide");
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { id?: string; decision?: string };
  if (body.decision !== "approved" && body.decision !== "rejected" && body.decision !== "recommendation")
    return Response.json({ error: "decision must be approved, rejected or recommendation" }, { status: 400 });
  const deal = body.id ? await store.getDeal(body.id) : undefined;
  if (!deal) return Response.json({ error: "Deal not found." }, { status: 404 });
  try {
    const by = staff.name;
    const updated = body.decision === "recommendation" ? await applyRecommendation(deal, by, "desk") : await decideApproval(deal, body.decision, by);
    await audit(staff, `${body.decision === "recommendation" ? "applied the agent's recommendation on" : body.decision} the escalated price`, deal.id);
    return Response.json(toPublic(updated));
  } catch (err) {
    if (err instanceof HaggleError) return Response.json({ error: err.message }, { status: 409 });
    throw err;
  }
}
