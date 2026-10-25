import { after } from "next/server";
import { agenticorgConfigured, explainAgenticorgError, requestDealReview } from "@/lib/agenticorg";
import { canActAsShopper } from "@/lib/deal-access";
import { acceptOffer, HaggleError, submitOffer, toPublic } from "@/lib/negotiate";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { store } from "@/lib/store";

export const maxDuration = 60;

/** Shopper side of the negotiation: counter-offer or accept the agent's current offer. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { id?: string; offer?: number; accept?: boolean };
  const deal = body.id ? await store.getDeal(body.id) : undefined;
  if (!deal) return Response.json({ error: "Deal not found." }, { status: 404 });

  if (!(await canActAsShopper(deal))) return Response.json({ error: "Only the shopper who started this deal can haggle." }, { status: 403 });
  const limited = await rateLimit(
    { name: "haggle:deal", id: deal.id, max: 30, windowSeconds: 10 * 60 },
    { name: "haggle:ip", id: clientIp(request), max: 120, windowSeconds: 10 * 60 },
  );
  if (limited) return limited;

  try {
    const updated = body.accept ? await acceptOffer(deal) : await submitOffer(deal, Number(body.offer));
    // Escalated: have the AgenticOrg deal-desk agent review it in the background for the human approver.
    if (updated.status === "awaiting_approval" && agenticorgConfigured) {
      after(() =>
        requestDealReview(updated).catch((err) =>
          store.log({ type: "agent_review_requested", actor: "system", userId: updated.userId, dealId: updated.id, detail: `AgenticOrg review failed: ${explainAgenticorgError(err)}` }),
        ),
      );
    }
    return Response.json(toPublic(updated));
  } catch (err) {
    if (err instanceof HaggleError) return Response.json({ error: err.message }, { status: 409 });
    console.error("haggle failed", err);
    return Response.json({ error: "The seller agent hit a snag. Try again." }, { status: 500 });
  }
}
