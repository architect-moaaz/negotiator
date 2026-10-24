import { isAdmin } from "@/lib/admin";
import { toPublic } from "@/lib/negotiate";
import { store } from "@/lib/store";

/** Proof-of-life data for the admin page: signups, agent/payment activity and deals. */
export async function GET(request: Request) {
  if (!isAdmin(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const [users, activity, deals, stats, sellers, demand] = await Promise.all([
    store.listUsers(),
    store.listLog(5000),
    store.listDeals(),
    store.stats(),
    store.listSellers(),
    store.topDemand(),
  ]);
  const registered = new Set(sellers.flatMap((s) => s.aliases));
  return Response.json(
    {
      stats,
      users,
      sellers,
      demand: demand.map((d) => ({ ...d, registered: registered.has(d.key) })),
      activity,
      deals: deals.map((d) => ({ ...toPublic(d), userId: d.userId, pinelabsOrderId: d.pinelabsOrderId, terms: d.negotiation?.terms, recommendation: d.negotiation?.recommendation })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
