import { requireStoreAccess } from "@/lib/shop/access";
import { sellerResults } from "@/lib/shop/results";
import { istDay, metricsFor, summarise } from "@/lib/warehouse";

const PERIODS = new Set([7, 30, 90]);

/** The store's last 7, 30 or 90 days (?days=, default 30; up to yesterday, IST): how the agent is doing and what it sold. */
export async function GET(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/metrics">) {
  const { store, denied } = await requireStoreAccess(request, (await ctx.params).id, "view");
  if (denied) return denied;
  const asked = Number(new URL(request.url).searchParams.get("days"));
  const days = PERIODS.has(asked) ? asked : 30;
  const from = istDay(Date.now() - days * 24 * 60 * 60 * 1000);
  const to = istDay(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await metricsFor({ storeId: store.id }, from, to);
  return Response.json(
    { from, to, summary: summarise(rows), results: sellerResults(rows), days: rows.map((r) => ({ day: r.day, negotiations: r.negotiations, agreed: r.agreed, gmv: r.gmv, agreedValue: r.agreedValue })) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
