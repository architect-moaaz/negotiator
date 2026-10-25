import { clientIp, rateLimit } from "@/lib/rate-limit";
import { requestCity } from "@/lib/request";
import { ShopError, startShopNegotiation } from "@/lib/shop/negotiation";
import { currentUser } from "@/lib/users";

/** Start haggling on a GhostCart Shop product. Body: { productId }. Returns { id } of the new deal. */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign up to start haggling.", needsSignup: true }, { status: 401 });
  const limited = await rateLimit(
    { name: "shop-haggle:user", id: user.id, max: 30, windowSeconds: 60 * 60 },
    { name: "shop-haggle:ip", id: clientIp(request), max: 60, windowSeconds: 60 * 60 },
  );
  if (limited) return limited;
  const { productId } = (await request.json().catch(() => ({}))) as { productId?: string };
  if (!productId) return Response.json({ error: "Pick a product." }, { status: 400 });
  try {
    const deal = await startShopNegotiation(productId, user.id, { city: requestCity(request) ?? user.city });
    return Response.json({ id: deal.id });
  } catch (err) {
    if (err instanceof ShopError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
