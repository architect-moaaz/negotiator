import { exchangeCode, verifyQueryHmac } from "@ghostcart/channels";
import { isShopDomain } from "@ghostcart/channels";
import { saveShopifyConnection } from "@/lib/shopify/connections";
import { store as kv } from "@/lib/store";

/** Shopify sends the merchant back here after they approve the install. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  if (!isShopDomain(shop) || !code || !verifyQueryHmac(url.searchParams)) return new Response("This install link isn't valid. Start again from your Shopify admin.", { status: 400 });
  const expected = await kv.kvGet<string>(`shopify:state:${state}`);
  await kv.kvDel(`shopify:state:${state}`);
  if (expected !== shop) return new Response("This install link has expired. Start again from your Shopify admin.", { status: 400 });
  const { access_token, scope } = await exchangeCode(shop, code);
  await saveShopifyConnection(shop, access_token, scope);
  await kv.log({ type: "seller_action", actor: "seller", detail: `Shopify app installed on ${shop} (${scope})` });
  return Response.redirect(new URL(`/seller/connect/shopify?shop=${encodeURIComponent(shop)}`, url.origin), 302);
}
