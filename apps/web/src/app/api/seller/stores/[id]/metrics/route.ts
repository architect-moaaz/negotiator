import { requireStoreAccess } from "@/lib/shop/access";
import { istDay, metricsFor, summarise } from "@/lib/warehouse";

/** The store's last 30 days (up to yesterday, IST): how the agent is doing and what it sold. */
export async function GET(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/metrics">) {
  const { store, denied } = await requireStoreAccess(request, (await ctx.params).id, "view");
  if (denied) return denied;
  const from = istDay(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = istDay(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await metricsFor({ storeId: store.id }, from, to);
  return Response.json({ from, to, summary: summarise(rows), days: rows.map((r) => ({ day: r.day, negotiations: r.negotiations, agreed: r.agreed, gmv: r.gmv })) }, { headers: { "Cache-Control": "no-store" } });
}
