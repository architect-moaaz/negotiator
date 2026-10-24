import { store } from "@/lib/store";

/** Polled by the dashboard and the landing-page ticker. */
export async function GET(request: Request) {
  const limit = Math.min(50, Number(new URL(request.url).searchParams.get("limit") ?? 20));
  const [events, stats] = await Promise.all([store.recentTicker(limit), store.stats()]);
  return Response.json({ events, stats }, { headers: { "Cache-Control": "no-store" } });
}
