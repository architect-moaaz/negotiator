import { computeAnalytics } from "@/lib/analytics";
import { recoveryStats } from "@/lib/privilege/stats";
import { requireStaff } from "@/lib/staff";
import { store } from "@/lib/store";

/** Funnel, demographics, commerce, approval and cart-recovery analytics for the admin console. */
export async function GET(request: Request) {
  const { denied } = await requireStaff(request, "view");
  if (denied) return denied;
  const [users, deals, activity, visits, recovery] = await Promise.all([store.listUsers(), store.listDeals(5000), store.listLog(20000), store.listVisits(), recoveryStats()]);
  return Response.json({ ...computeAnalytics({ users, deals, activity, visits }), recovery }, { headers: { "Cache-Control": "no-store" } });
}
