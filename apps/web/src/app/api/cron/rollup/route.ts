import { cronAuthorized } from "@/lib/cron";
import { nightlyRollup } from "@/lib/warehouse";

/** Vercel Cron, 00:30 IST daily: roll the last three days of negotiations and orders into store_daily_metrics. */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return new Response("unauthorized", { status: 401 });
  return Response.json(await nightlyRollup());
}
