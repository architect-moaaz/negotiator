import { decide, handle, sessionFor, sessionView, storeFromKey } from "@/lib/sessions-api";

/**
 * The seller's decision on an offer waiting for approval (id = session id), from their own system.
 * Body: { decision: "approved" | "rejected" | "counter", price? (for counter), by? (who decided) }.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/approvals/[id]/decision">) {
  return handle(async () => {
    const store = await storeFromKey(request);
    const deal = await sessionFor(store.id, (await ctx.params).id);
    return Response.json(sessionView(await decide(deal, await request.json().catch(() => ({})))));
  });
}
