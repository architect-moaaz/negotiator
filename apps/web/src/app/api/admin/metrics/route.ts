import { toCsv } from "@/lib/shop/export";
import { requireStaff } from "@/lib/staff";
import { istDay, METRIC_COLUMNS, metricsFor, rollupDay, summarise } from "@/lib/warehouse";

const days = (n: number) => istDay(Date.now() - n * 24 * 60 * 60 * 1000);

/**
 * The warehouse for BI tools and spreadsheets: ?from=YYYY-MM-DD&to=YYYY-MM-DD[&format=csv][&storeId=…].
 * Defaults to the last 30 days. Includes GMV and fees, so finance permission.
 */
export async function GET(request: Request) {
  const { denied } = await requireStaff(request, "finance");
  if (denied) return denied;
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? days(30);
  const to = url.searchParams.get("to") ?? days(1);
  let rows;
  try {
    rows = await metricsFor({ storeId: url.searchParams.get("storeId") ?? undefined }, from, to);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
  if (url.searchParams.get("format") === "csv")
    return new Response(toCsv(rows, METRIC_COLUMNS), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="ghostcart-metrics-${from}-to-${to}.csv"`, "Cache-Control": "no-store" } });
  return Response.json({ from, to, summary: summarise(rows), rows }, { headers: { "Cache-Control": "no-store" } });
}

/** Re-run the rollup for one day (backfills, or after fixing data). Body: { day: "YYYY-MM-DD" }. */
export async function POST(request: Request) {
  const { denied } = await requireStaff(request, "finance");
  if (denied) return denied;
  const { day } = (await request.json().catch(() => ({}))) as { day?: string };
  try {
    return Response.json(await rollupDay(day ?? ""));
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
