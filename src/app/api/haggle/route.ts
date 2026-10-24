import { after } from "next/server";
import { agenticorgConfigured, requestDealReview } from "@/lib/agenticorg";
import { acceptOffer, HaggleError, submitOffer, toPublic } from "@/lib/negotiate";
import { store } from "@/lib/store";
import { currentUser } from "@/lib/users";

export const maxDuration = 60;

/** Shopper side of the negotiation: counter-offer or accept the agent's current offer. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { id?: string; offer?: number; accept?: boolean };
  const deal = body.id ? await store.getDeal(body.id) : undefined;
  if (!deal) return Response.json({ error: "Deal not found." }, { status: 404 });

  // Web deals belong to the shopper who started them; WhatsApp deals are opened from the link.
  if (deal.channel === "web") {
    const user = await currentUser();
    if (!user || user.id !== deal.userId) return Response.json({ error: "Only the shopper who started this deal can haggle." }, { status: 403 });
  }

  try {
    const updated = body.accept ? await acceptOffer(deal) : await submitOffer(deal, Number(body.offer));
    // Escalated: have the AgenticOrg deal-desk agent review it in the background for the human approver.
    if (updated.status === "awaiting_approval" && agenticorgConfigured) {
      after(() =>
        requestDealReview(updated).catch((err) =>
          store.log({ type: "agent_review_requested", actor: "system", userId: updated.userId, dealId: updated.id, detail: `AgenticOrg review failed: ${String(err).slice(0, 200)}` }),
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
