import { startFromInvite } from "@/lib/privilege/actions";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { requestCity } from "@/lib/request";
import { ShopError } from "@/lib/shop/negotiation";
import { getLang } from "@/lib/lang";
import { currentUser } from "@/lib/users";

/** Start the haggle on a GhostCart Privilege cart from its private link. Body: { token }. Returns { id }. */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in to make your offer.", needsSignup: true }, { status: 401 });
  const limited = await rateLimit(
    { name: "shop-haggle:user", id: user.id, max: 30, windowSeconds: 60 * 60 },
    { name: "shop-haggle:ip", id: clientIp(request), max: 60, windowSeconds: 60 * 60 },
  );
  if (limited) return limited;
  const { token } = (await request.json().catch(() => ({}))) as { token?: string };
  if (typeof token !== "string") return Response.json({ error: "This private offer link isn't valid." }, { status: 400 });
  try {
    const deal = await startFromInvite(token, user.id, { city: requestCity(request) ?? user.city, request, language: await getLang() });
    return Response.json({ id: deal.id });
  } catch (err) {
    if (err instanceof ShopError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
