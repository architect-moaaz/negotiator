import { rateLimit } from "@/lib/rate-limit";
import { handle, makeOffer, sessionFor, sessionView, storeFromKey } from "@/lib/sessions-api";

export const maxDuration = 60;

/** The shopper's offer. Body: { amount: 1200 } or { text: "can you do 1200?" }. Returns the session with the agent's reply. */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/sessions/[id]/offers">) {
  return handle(async () => {
    const store = await storeFromKey(request);
    const deal = await sessionFor(store.id, (await ctx.params).id);
    const limited = await rateLimit({ name: "v1-offers:session", id: deal.id, max: 30, windowSeconds: 10 * 60 });
    if (limited) return limited;
    return Response.json(sessionView(await makeOffer(deal, await request.json().catch(() => ({})))));
  });
}
