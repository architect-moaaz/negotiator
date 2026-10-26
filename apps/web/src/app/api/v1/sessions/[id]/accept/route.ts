import { accept, handle, sessionFor, sessionView, storeFromKey } from "@/lib/sessions-api";

/**
 * The shopper takes the current offer. The response says how to pay: `grant` (a single-use code for the
 * seller's own checkout on Shopify/WooCommerce) or `payment` (UPI lock fee, then GhostCart checkout).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/sessions/[id]/accept">) {
  return handle(async () => {
    const store = await storeFromKey(request);
    const deal = await sessionFor(store.id, (await ctx.params).id);
    return Response.json(sessionView(await accept(deal)));
  });
}
