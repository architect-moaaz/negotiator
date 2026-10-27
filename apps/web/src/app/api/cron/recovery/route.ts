import { cronAuthorized } from "@/lib/cron";
import { runRecovery } from "@/lib/privilege/job";

/** Vercel Cron, every 15 minutes: GhostCart Privilege (abandon, invite, expire). */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return new Response("unauthorized", { status: 401 });
  return Response.json(await runRecovery());
}
