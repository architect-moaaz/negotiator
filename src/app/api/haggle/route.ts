import { acceptOffer, HaggleError, submitOffer, toPublic } from "@/lib/negotiate";
import { store } from "@/lib/store";
import { currentUser } from "@/lib/users";

export const maxDuration = 30;

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
    return Response.json(toPublic(updated));
  } catch (err) {
    if (err instanceof HaggleError) return Response.json({ error: err.message }, { status: 409 });
    console.error("haggle failed", err);
    return Response.json({ error: "The seller agent hit a snag. Try again." }, { status: 500 });
  }
}
