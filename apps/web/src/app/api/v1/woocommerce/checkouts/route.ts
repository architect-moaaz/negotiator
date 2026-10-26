import { bearer, storeForKey } from "@/lib/integrations/keys";
import { captureCart, CartError, completeCart } from "@/lib/privilege/carts";

/**
 * The plugin reports a checkout placed by a shopper who opted in to a private offer if they don't finish
 * (GhostCart Privilege), and later that the order was paid. Body: { externalRef, items: [{ ref, quantity }],
 * email?, phone?, name?, consent, returnUrl? } or { externalRef, completed: true }.
 */
export async function POST(request: Request) {
  const found = await storeForKey(bearer(request), "secret");
  if (!found) return Response.json({ error: "Invalid or revoked API key." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as {
    externalRef?: string;
    completed?: boolean;
    items?: { ref?: string; quantity?: number }[];
    email?: string;
    phone?: string;
    name?: string;
    consent?: boolean;
    returnUrl?: string;
  };
  const externalRef = typeof body.externalRef === "string" ? body.externalRef.slice(0, 64) : "";
  if (!externalRef) return Response.json({ error: "Send { externalRef, items }." }, { status: 400 });
  if (body.completed) {
    await completeCart(found.store.id, "woo_checkout", externalRef);
    return Response.json({ completed: true });
  }
  if (!Array.isArray(body.items) || !body.items.length) return Response.json({ error: "Send { externalRef, items }." }, { status: 400 });
  try {
    const cart = await captureCart({
      storeId: found.store.id,
      source: "woo_checkout",
      externalRef,
      items: body.items.filter((i) => typeof i?.ref === "string").map((i) => ({ ref: String(i.ref), quantity: Number(i.quantity) || 1 })),
      contact: { email: body.email || undefined, phone: body.phone || undefined, name: body.name || undefined },
      consent: body.consent === true,
      returnUrl: body.returnUrl,
    });
    return Response.json({ cartId: cart.id, status: cart.status });
  } catch (err) {
    if (err instanceof CartError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
