import { bearer, storeForKey } from "@/lib/integrations/keys";
import { store as kv } from "@/lib/store";
import { normalizeSiteUrl, saveWooConnection } from "@/lib/woocommerce/client";

/**
 * Step 1, called by the plugin with the store's secret key: register the site and receive the signing
 * secret GhostCart uses to call the plugin. Body: { siteUrl }.
 */
export async function POST(request: Request) {
  const found = await storeForKey(bearer(request), "secret");
  if (!found) return Response.json({ error: "Invalid or revoked API key." }, { status: 401 });
  if (found.store.platform !== "woocommerce") return Response.json({ error: "This key belongs to a store that isn't set up as WooCommerce in GhostCart." }, { status: 409 });
  const { siteUrl } = (await request.json().catch(() => ({}))) as { siteUrl?: string };
  const site = siteUrl ? normalizeSiteUrl(siteUrl) : null;
  if (!site) return Response.json({ error: "The site address must be a public https:// URL." }, { status: 400 });
  if (found.store.domain && new URL(site).hostname.replace(/^www\./, "") !== found.store.domain.replace(/^www\./, "")) {
    return Response.json({ error: `This GhostCart store is set up for ${found.store.domain}.` }, { status: 409 });
  }
  const secret = await saveWooConnection(found.store.id, site);
  await kv.log({ type: "seller_action", actor: "seller", detail: `${found.store.name} (${found.store.id}) WooCommerce plugin connected from ${site}` });
  return Response.json({ signingSecret: secret, storeName: found.store.name });
}
