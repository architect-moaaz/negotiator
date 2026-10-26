import { memberPhone } from "@/lib/shop/access";
import { removeSubscription, saveSubscription, WebPushError, webPushEnabled, type BrowserSubscription } from "@/lib/web-push";

/** A seller's browser subscribes to approval notifications. Body: the PushSubscription JSON. */
export async function POST(request: Request) {
  const phone = await memberPhone(request);
  if (!phone) return Response.json({ error: "Sign in with your phone number." }, { status: 401 });
  if (!webPushEnabled()) return Response.json({ error: "Browser notifications aren't switched on yet." }, { status: 404 });
  try {
    await saveSubscription(phone, (await request.json().catch(() => ({}))) as BrowserSubscription);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof WebPushError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}

/** Body: { endpoint }. */
export async function DELETE(request: Request) {
  const phone = await memberPhone(request);
  if (!phone) return Response.json({ error: "Sign in with your phone number." }, { status: 401 });
  const { endpoint } = (await request.json().catch(() => ({}))) as { endpoint?: string };
  if (endpoint) await removeSubscription(endpoint);
  return Response.json({ ok: true });
}
