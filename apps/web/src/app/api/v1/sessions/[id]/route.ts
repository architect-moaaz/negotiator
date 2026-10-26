import { handle, sessionFor, sessionView, storeFromKey } from "@/lib/sessions-api";

/** The session as it stands. */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/sessions/[id]">) {
  return handle(async () => {
    const store = await storeFromKey(request);
    return Response.json(sessionView(await sessionFor(store.id, (await ctx.params).id)), { headers: { "Cache-Control": "no-store" } });
  });
}
