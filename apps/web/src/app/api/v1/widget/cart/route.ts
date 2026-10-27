import { storeForKey } from "@/lib/integrations/keys";
import { captureCart, CartError } from "@/lib/privilege/carts";
import { bundleFor } from "@/lib/privilege/negotiation";
import { getRecovery } from "@/lib/privilege/settings";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { ShopError } from "@/lib/shop/negotiation";

/** CORS for the widget: only the store's allowed origins get an answer they can read. */
function cors(origin: string | null): Record<string, string> {
  return origin ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" } : {};
}

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: cors(request.headers.get("origin")) });
}

/**
 * The widget on a seller's cart page shares the cart (GhostCart Privilege). Body: { key, cartRef?, items:
 * [{ ref, quantity }], returnUrl? }. Saves an anonymous cart (no shopper details) priced from the catalogue
 * and answers whether the seller will haggle on it as a whole.
 */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const limited = await rateLimit({ name: "widget-cart:ip", id: clientIp(request), max: 120, windowSeconds: 10 * 60 });
  if (limited) return new Response(limited.body, { status: 429, headers: { ...Object.fromEntries(limited.headers), ...cors(origin) } });
  const body = (await request.json().catch(() => ({}))) as { key?: string; cartRef?: string; items?: { ref?: unknown; quantity?: unknown }[]; returnUrl?: string };
  const found = await storeForKey(body.key, "publishable", origin);
  if (!found) return Response.json({ error: "This key doesn't work on this site." }, { status: 403 });
  const headers = { ...cors(origin), "Cache-Control": "no-store" };
  const store = found.store;
  const recovery = await getRecovery(store.id);
  const items = (Array.isArray(body.items) ? body.items : [])
    .filter((i) => typeof i?.ref === "string" && i.ref.length <= 80)
    .map((i) => ({ ref: i.ref as string, quantity: Number(i.quantity) || 1 }));
  if (store.status !== "live" || !recovery.enabled || !items.length) return Response.json({ available: false }, { headers });
  const cartRef = typeof body.cartRef === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(body.cartRef) ? `w:${body.cartRef}` : undefined;
  try {
    const cart = await captureCart({ storeId: store.id, source: "widget", externalRef: cartRef, items, returnUrl: typeof body.returnUrl === "string" ? body.returnUrl.slice(0, 500) : undefined });
    const { terms } = await bundleFor(cart, store, recovery);
    const url = new URL(request.url);
    return Response.json(
      {
        available: true,
        listTotal: terms.benchmark,
        exitPrompt: recovery.exitPrompt,
        url: `${url.origin}/api/v1/widget/cart/${cart.id}/open?key=${encodeURIComponent(body.key!)}`,
      },
      { headers },
    );
  } catch (err) {
    if (err instanceof CartError || err instanceof ShopError) return Response.json({ available: false }, { headers });
    throw err;
  }
}
