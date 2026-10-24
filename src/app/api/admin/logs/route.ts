import { isAdmin } from "@/lib/admin";
import { toPublic } from "@/lib/negotiate";
import { store } from "@/lib/store";

/** Proof-of-life data for the admin page: signups, agent/payment activity and deals. */
export async function GET(request: Request) {
  if (!isAdmin(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
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
      deals: deals.map((d) => ({ ...toPublic(d), userId: d.userId, pinelabsOrderId: d.pinelabsOrderId, terms: d.negotiation?.terms })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
