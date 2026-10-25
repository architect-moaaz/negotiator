import { computeAnalytics } from "@/lib/analytics";
import { requireStaff } from "@/lib/staff";
import { store } from "@/lib/store";

/** Funnel, demographics, commerce and approval analytics for the admin console. */
export async function GET(request: Request) {
  const { denied } = await requireStaff(request, "view");
  if (denied) return denied;
  const [users, deals, activity, visits] = await Promise.all([store.listUsers(), store.listDeals(5000), store.listLog(20000), store.listVisits()]);
  return Response.json(computeAnalytics({ users, deals, activity, visits }), { headers: { "Cache-Control": "no-store" } });
}
