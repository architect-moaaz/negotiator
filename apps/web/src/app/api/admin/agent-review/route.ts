import { isAdmin } from "@/lib/admin";
import { explainAgenticorgError, requestDealReview } from "@/lib/agenticorg";
import { toPublic } from "@/lib/negotiate";
import { store } from "@/lib/store";

export const maxDuration = 60;

/** Manually ask the AgenticOrg deal-desk agent to review an escalated deal. */
export async function POST(request: Request) {
  if (!isAdmin(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = (await request.json().catch(() => ({}))) as { id?: string };
  const deal = id ? await store.getDeal(id) : undefined;
  if (!deal || deal.status !== "awaiting_approval") return Response.json({ error: "No escalated deal with that id." }, { status: 404 });
  try {
    const agentReply = await requestDealReview(deal);
    const fresh = await store.getDeal(deal.id);
    return Response.json({ agentReply, deal: fresh && toPublic(fresh), recommendation: fresh?.negotiation?.recommendation ?? null });
  } catch (err) {
    return Response.json({ error: explainAgenticorgError(err) }, { status: 502 });
  }
}
