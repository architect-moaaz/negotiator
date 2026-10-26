import { randomBytes } from "node:crypto";
import { authorizeUrl } from "@ghostcart/channels";
import { isShopDomain, shopifyConfigured } from "@ghostcart/channels";
import { store as kv } from "@/lib/store";

/** Start of the Shopify install: Shopify admin (or our "Connect Shopify" button) sends the merchant here with ?shop=. */
export async function GET(request: Request) {
  const shop = new URL(request.url).searchParams.get("shop")?.toLowerCase();
  if (!shopifyConfigured()) return new Response("The Shopify app isn't configured on this deployment.", { status: 503 });
  if (!isShopDomain(shop)) return new Response("Open this from your Shopify admin, or enter your-store.myshopify.com.", { status: 400 });
  const state = randomBytes(16).toString("hex");
  await kv.kvSet(`shopify:state:${state}`, shop, 10 * 60);
  return Response.redirect(authorizeUrl(shop, state), 302);
}
