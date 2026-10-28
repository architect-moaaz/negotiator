import { AlertError, alertsForUser, setPriceAlert, stopPriceAlert } from "@/lib/alerts";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { getProduct } from "@/lib/shop/products";
import { getStore } from "@/lib/shop/stores";
import { currentUser } from "@/lib/users";

/** The signed-in shopper's live price alerts. */
export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in to see your alerts.", needsSignup: true }, { status: 401 });
  const alerts = await Promise.all(
    (await alertsForUser(user.id)).map(async (a) => {
      const p = await getProduct(a.productId);
      const s = p && (await getStore(p.storeId));
      return { id: a.id, productId: a.productId, title: p?.title ?? "A product", url: p && s ? `/s/${s.slug}/${p.id}` : null, targetPrice: a.targetPrice, expiresAt: a.expiresAt };
    }),
  );
  return Response.json({ alerts });
}

/** Set (or replace) an alert. Body: { productId, target } (whole rupees, below today's price). */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in to get price alerts.", needsSignup: true }, { status: 401 });
  const limited = await rateLimit({ name: "alerts:user", id: user.id, max: 30, windowSeconds: 24 * 60 * 60 }, { name: "alerts:ip", id: clientIp(request), max: 60, windowSeconds: 24 * 60 * 60 });
  if (limited) return limited;
  const { productId, target } = (await request.json().catch(() => ({}))) as { productId?: string; target?: unknown };
  if (typeof productId !== "string") return Response.json({ error: "Pick a product." }, { status: 400 });
  try {
    const { alert } = await setPriceAlert(user.id, productId, Number(target));
    return Response.json({ id: alert.id, targetPrice: alert.targetPrice, expiresAt: alert.expiresAt });
  } catch (err) {
    if (err instanceof AlertError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

/** Remove one of my alerts. Body: { id }. */
export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { id } = (await request.json().catch(() => ({}))) as { id?: string };
  const row = typeof id === "string" ? await stopPriceAlert({ id, userId: user.id }) : undefined;
  return Response.json({ stopped: !!row });
}
