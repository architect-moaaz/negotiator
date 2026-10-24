import { timingSafeEqual } from "node:crypto";
import { toPublic } from "@/lib/negotiate";
import { store } from "@/lib/store";

function authorized(request: Request) {
  const token = process.env.ADMIN_TOKEN;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  return !!token && given.length === token.length && timingSafeEqual(Buffer.from(given), Buffer.from(token));
}

/** Proof-of-life data for the admin page: signups, agent/payment activity and deals. */
export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const [users, activity, deals, stats] = await Promise.all([
    store.listUsers(),
    store.listLog(5000),
    store.listDeals(),
    store.stats(),
  ]);
  return Response.json(
    {
      stats,
      users,
      activity,
      deals: deals.map((d) => ({ ...toPublic(d), userId: d.userId, pinelabsOrderId: d.pinelabsOrderId })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
