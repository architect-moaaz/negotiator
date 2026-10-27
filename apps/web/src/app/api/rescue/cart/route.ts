import { clientIp, rateLimit } from "@/lib/rate-limit";
import { buildRescueCarts } from "@/lib/rescue/cart";
import { currentUser } from "@/lib/users";

/** The shopper's picks become one cart per GhostCart store, each with a link to make that store an offer. Body: { picks: [{ productId, quantity }] }. */
export async function POST(request: Request) {
  const limited = await rateLimit({ name: "rescue-cart:ip", id: clientIp(request), max: 30, windowSeconds: 60 * 60 });
  if (limited) return limited;
  const { picks } = (await request.json().catch(() => ({}))) as { picks?: { productId?: unknown; quantity?: unknown }[] };
  const clean = (Array.isArray(picks) ? picks : [])
    .filter((p) => typeof p?.productId === "string")
    .map((p) => ({ productId: p.productId as string, quantity: Math.min(10, Math.max(1, Math.floor(Number(p.quantity) || 1))) }));
  if (!clean.length) return Response.json({ error: "Pick at least one item." }, { status: 400 });
  const user = await currentUser();
  const carts = await buildRescueCarts(clean, user?.id);
  if (!carts.length) return Response.json({ error: "Those items aren't available any more." }, { status: 409 });
  return Response.json({ carts });
}
