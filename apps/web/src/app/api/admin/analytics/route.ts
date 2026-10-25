import { isAdmin } from "@/lib/admin";
import { computeAnalytics } from "@/lib/analytics";
import { store } from "@/lib/store";

/** Funnel, demographics, commerce and approval analytics for the admin console. */
export async function GET(request: Request) {
  if (!isAdmin(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const [users, deals, activity, visits] = await Promise.all([store.listUsers(), store.listDeals(5000), store.listLog(20000), store.listVisits()]);
  return Response.json(computeAnalytics({ users, deals, activity, visits }), { headers: { "Cache-Control": "no-store" } });
}
