import { clientIp, rateLimit } from "@/lib/rate-limit";
import { searchCatalogue } from "@/lib/shop/catalogue";

/** Products on offer across live GhostCart shops, for the mobile app. ?q=words (optional). */
export async function GET(request: Request) {
  const limited = await rateLimit({ name: "catalogue:ip", id: clientIp(request), max: 300, windowSeconds: 10 * 60 });
  if (limited) return limited;
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  return Response.json({ items: await searchCatalogue(q, 48) }, { headers: { "Cache-Control": "no-store" } });
}
