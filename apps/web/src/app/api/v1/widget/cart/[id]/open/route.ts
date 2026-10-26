import { allowedReturnUrl, storeForKey } from "@/lib/integrations/keys";
import { getCart, RECOVERABLE, type CartStatus } from "@/lib/privilege/carts";
import { createInvite } from "@/lib/privilege/invites";

/**
 * Where the widget's "Make an offer on your cart" button goes: a fresh private link for that cart, then
 * GhostCart's own Privilege page (first-party, so sign-in works in every browser). Only anonymous widget
 * carts open this way; carts holding a shopper's details are reached only through their own invite.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/widget/cart/[id]/open">) {
  const { id } = await ctx.params;
  const url = new URL(request.url);
  const found = await storeForKey(url.searchParams.get("key"), "publishable");
  const cart = found && (await getCart(id));
  if (!found || !cart || cart.storeId !== found.store.id || cart.source !== "widget" || cart.email || cart.phone) {
    return new Response("This cart isn't available on GhostCart.", { status: 404 });
  }
  if (!RECOVERABLE.includes(cart.status as CartStatus) && cart.status !== "negotiating") return new Response("This cart has already been checked out.", { status: 410 });
  const { token } = await createInvite(cart.id, "link");
  const target = new URL(`/p/${token}`, url.origin);
  const back = await allowedReturnUrl(found.store.id, url.searchParams.get("return") ?? cart.returnUrl);
  if (back) target.searchParams.set("return", back);
  return Response.redirect(target, 302);
}
