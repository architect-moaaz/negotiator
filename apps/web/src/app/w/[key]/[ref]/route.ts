import { allowedReturnUrl, storeForKey } from "@/lib/integrations/keys";
import { getProductByRef } from "@/lib/shop/products";

/**
 * Where the widget button sends shoppers: GhostCart's own haggle page for the product (first-party, so
 * sign-in and payment work in every browser), with a validated "back to the store" link.
 */
export async function GET(request: Request, ctx: RouteContext<"/w/[key]/[ref]">) {
  const { key, ref } = await ctx.params;
  const url = new URL(request.url);
  const found = await storeForKey(key, "publishable");
  const product = found && (await getProductByRef(found.store.id, decodeURIComponent(ref)));
  if (!found || !product) return new Response("This product isn't available on GhostCart.", { status: 404 });
  const back = await allowedReturnUrl(found.store.id, url.searchParams.get("return"));
  const target = new URL(`/s/${found.store.slug}/${product.id}`, url.origin);
  if (back) target.searchParams.set("return", back);
  return Response.redirect(target, 302);
}
