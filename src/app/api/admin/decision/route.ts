import { isAdmin } from "@/lib/admin";
import { decideApproval, HaggleError, toPublic } from "@/lib/negotiate";
import { store } from "@/lib/store";

/** Human deal desk: approve or reject a price the seller agent couldn't agree to on its own. */
export async function POST(request: Request) {
  if (!isAdmin(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { id?: string; decision?: string; by?: string };
  if (body.decision !== "approved" && body.decision !== "rejected") return Response.json({ error: "decision must be approved or rejected" }, { status: 400 });
  const deal = body.id ? await store.getDeal(body.id) : undefined;
  if (!deal) return Response.json({ error: "Deal not found." }, { status: 404 });
  try {
    const updated = await decideApproval(deal, body.decision, (body.by || "Deal desk").slice(0, 40));
    return Response.json(toPublic(updated));
  } catch (err) {
    if (err instanceof HaggleError) return Response.json({ error: err.message }, { status: 409 });
    throw err;
  }
}
