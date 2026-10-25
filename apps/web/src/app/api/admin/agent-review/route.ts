import { explainAgenticorgError, requestDealReview } from "@/lib/agenticorg";
import { toPublic } from "@/lib/negotiate";
import { audit, requireStaff } from "@/lib/staff";
import { store } from "@/lib/store";

export const maxDuration = 60;

/** Manually ask the AgenticOrg deal-desk agent to review an escalated deal. */
export async function POST(request: Request) {
  const { staff, denied } = await requireStaff(request, "decide");
  if (denied) return denied;
  const { id } = (await request.json().catch(() => ({}))) as { id?: string };
  const deal = id ? await store.getDeal(id) : undefined;
  if (!deal || deal.status !== "awaiting_approval") return Response.json({ error: "No escalated deal with that id." }, { status: 404 });
  await audit(staff, "asked the deal-desk agent to review this deal", deal.id);
  try {
    const agentReply = await requestDealReview(deal);
    const fresh = await store.getDeal(deal.id);
    return Response.json({ agentReply, deal: fresh && toPublic(fresh), recommendation: fresh?.negotiation?.recommendation ?? null });
  } catch (err) {
    return Response.json({ error: explainAgenticorgError(err) }, { status: 502 });
  }
}
