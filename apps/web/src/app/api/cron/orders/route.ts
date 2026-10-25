import { timingSafeEqual } from "node:crypto";
import { runOrderJobs } from "@/lib/orders/service";

/** Vercel Cron (see vercel.json): cancel unshipped orders past their ship-by time, release due payouts. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) return new Response("unauthorized", { status: 401 });
  return Response.json(await runOrderJobs());
}
