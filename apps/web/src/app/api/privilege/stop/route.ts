import { stopFromInvite } from "@/lib/privilege/actions";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { ShopError } from "@/lib/shop/negotiation";

/** "Stop offers" from a private link: no sign-in needed. Body: { token }. */
export async function POST(request: Request) {
  const limited = await rateLimit({ name: "privilege-stop:ip", id: clientIp(request), max: 30, windowSeconds: 60 * 60 });
  if (limited) return limited;
  const { token } = (await request.json().catch(() => ({}))) as { token?: string };
  if (typeof token !== "string") return Response.json({ error: "This private offer link isn't valid." }, { status: 400 });
  try {
    const cart = await stopFromInvite(token);
    return Response.json({ stopped: cart.status === "opted_out" });
  } catch (err) {
    if (err instanceof ShopError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
