import { cronAuthorized } from "@/lib/cron";
import { nightlyReconciliation } from "@/lib/orders/reconcile";

/** Vercel Cron, 01:00 IST: match yesterday's (and the day before's) settlement report against the ledger. */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return new Response("unauthorized", { status: 401 });
  const out = await nightlyReconciliation();
  return Response.json(out.map((r) => ({ day: r!.run.day, matched: r!.run.matched, issues: r!.run.issues })));
}
