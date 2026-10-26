import { cronAuthorized } from "@/lib/cron";
import { runOrderJobs } from "@/lib/orders/service";

/** Vercel Cron (see vercel.json): cancel unshipped orders past their ship-by time, release due payouts. */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return new Response("unauthorized", { status: 401 });
  return Response.json(await runOrderJobs());
}
