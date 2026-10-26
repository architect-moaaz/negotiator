import { schema } from "@ghostcart/db";
import { randomBytes } from "node:crypto";
import { getDb } from "../db";
import { createApiKey } from "../integrations/keys";
import { setPolicy } from "../shop/policies";
import { createStore, getStore, type Store } from "../shop/stores";
import { shopifyGraphql } from "./admin";
import { ensureBillingSubscription } from "./billing";
import { shopifyConfig } from "@ghostcart/channels";
import { connectionForShop, tokenOf, updateConnection } from "./connections";
import { importShopifyProducts } from "./sync";

const WEBHOOK_TOPICS = ["ORDERS_CREATE", "CHECKOUTS_CREATE", "CHECKOUTS_UPDATE", "PRODUCTS_CREATE", "PRODUCTS_UPDATE", "PRODUCTS_DELETE", "APP_UNINSTALLED"];

/**
 * Finish connecting an installed shop to a GhostCart store: attach (or create) the store, record the
 * installation as proof of ownership, issue the widget key and hand it to the theme block, import the
 * catalogue, subscribe to webhooks, and start billing. Returns a URL the merchant must visit to approve
 * billing, if any.
 */
export async function connectShopifyStore(input: { shop: string; orgId: string; storeId?: string; by: string }) {
  const conn = await connectionForShop(input.shop);
  if (!conn || conn.uninstalledAt) throw new Error("Install the GhostCart app from your Shopify admin first.");
  if (conn.storeId && conn.storeId !== input.storeId) throw new Error("This Shopify store is already connected to a GhostCart store.");
  const token = tokenOf(conn);

  const info = await shopifyGraphql<{ shop: { name: string; primaryDomain: { url: string } }; currentAppInstallation: { id: string } }>(
    input.shop,
    token,
    `query GhostCartShop { shop { name primaryDomain { url } } currentAppInstallation { id } }`,
  );

  let store: Store | undefined = input.storeId ? await getStore(input.storeId) : undefined;
  if (store && (store.orgId !== input.orgId || store.platform !== "shopify")) throw new Error("Pick one of your Shopify stores.");
  if (!store) {
    store = await createStore({ orgId: input.orgId, name: info.shop.name, platform: "shopify", domain: input.shop });
    await setPolicy(store.id, "store", null, { maxDiscountPct: 10, autoApprovePct: 5 });
  }
  await updateConnection(conn.id, { storeId: store.id, meta: { ...conn.meta, primaryDomain: info.shop.primaryDomain.url, appInstallationId: info.currentAppInstallation.id } });

  const db = await getDb();
  await db.insert(schema.kycChecks).values({
    id: `kyc_${randomBytes(9).toString("base64url")}`,
    orgId: store.orgId,
    storeId: store.id,
    type: "ownership_platform",
    status: "passed",
    provider: "shopify",
    masked: input.shop,
    details: { reason: "Installed the GhostCart app from the store's Shopify admin." },
  });

  // The theme app embed reads this key from the app's metafield, so the merchant never pastes anything.
  const { value } = await createApiKey(store, "publishable", input.by, [`https://${input.shop}`, info.shop.primaryDomain.url]);
  await shopifyGraphql(input.shop, token, `mutation GhostCartKey($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } } }`, {
    metafields: [{ ownerId: info.currentAppInstallation.id, namespace: "ghostcart", key: "publishable_key", type: "single_line_text_field", value }],
  });

  const appUrl = shopifyConfig().appUrl;
  for (const topic of WEBHOOK_TOPICS) {
    await shopifyGraphql(input.shop, token, `mutation GhostCartHook($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) { webhookSubscription { id } userErrors { field message } }
      }`, { topic, sub: { callbackUrl: `${appUrl}/api/shopify/webhooks`, format: "JSON" } }).catch((err) => {
      if (!/already been taken|already exists/i.test(String(err))) throw err;
    });
  }

  const imported = await importShopifyProducts(store.id, input.shop, token);
  const approveBillingUrl = await ensureBillingSubscription({ ...conn, storeId: store.id }, `${appUrl}/seller?store=${store.id}`);
  return { store, imported, approveBillingUrl };
}
