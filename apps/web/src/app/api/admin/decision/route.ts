import { isAdmin } from "@/lib/admin";
import { applyRecommendation } from "@/lib/deal-desk";
import { decideApproval, HaggleError, toPublic } from "@/lib/negotiate";
import { store } from "@/lib/store";

/** Human deal desk: approve or reject a price the seller agent couldn't agree to on its own. */
export async function POST(request: Request) {
  if (!isAdmin(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { id?: string; decision?: string; by?: string };
  if (body.decision !== "approved" && body.decision !== "rejected" && body.decision !== "recommendation")
    return Response.json({ error: "decision must be approved, rejected or recommendation" }, { status: 400 });
  const deal = body.id ? await store.getDeal(body.id) : undefined;
  if (!deal) return Response.json({ error: "Deal not found." }, { status: 404 });
  try {
    const by = (body.by || "Deal desk").slice(0, 40);
    const updated = body.decision === "recommendation" ? await applyRecommendation(deal, by, "desk") : await decideApproval(deal, body.decision, by);
    return Response.json(toPublic(updated));
  } catch (err) {
    if (err instanceof HaggleError) return Response.json({ error: err.message }, { status: 409 });
    throw err;
  }
}
