import { schema } from "@ghostcart/db";
import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "../crypto";
import { getDb } from "../db";
import { listProducts, updateProduct } from "../shop/products";
import { store as kv } from "../store";
import { exchangeCode, FlipkartError, listingsFor, refreshAccess } from "./api";

const { kycChecks, platformConnections } = schema;

/**
 * The seller authorised GhostCart from Flipkart Seller Hub: keep the refresh token (encrypted) and record
 * the authorisation as proof they own the Flipkart seller account.
 */
export async function completeFlipkartConnect(input: { storeId: string; orgId: string; code: string }) {
  const tokens = await exchangeCode(input.code);
  if (!tokens.refresh_token) throw new FlipkartError("Flipkart didn't return a refresh token.");
  const db = await getDb();
  const externalId = `flipkart:${input.storeId}`;
  await db
    .insert(platformConnections)
    .values({ id: `pcn_${randomBytes(8).toString("base64url")}`, storeId: input.storeId, platform: "flipkart", externalId, accessTokenEncrypted: encryptSecret(tokens.refresh_token), scopes: "Seller_Api" })
    .onConflictDoUpdate({ target: [platformConnections.platform, platformConnections.externalId], set: { storeId: input.storeId, accessTokenEncrypted: encryptSecret(tokens.refresh_token), installedAt: new Date(), uninstalledAt: null } });
  await db.insert(kycChecks).values({
    id: `kyc_${randomBytes(9).toString("base64url")}`,
    orgId: input.orgId,
    storeId: input.storeId,
    type: "ownership_marketplace",
    status: "passed",
    provider: "flipkart",
    masked: "Flipkart Seller Hub",
    details: { reason: "Authorised GhostCart from Flipkart Seller Hub." },
  });
}

/**
 * Refresh price, MRP, stock and status for the store's products from Flipkart, matched by SKU (import
 * the Flipkart listing export first: it has the titles). Products Flipkart doesn't list are left alone.
 */
export async function syncFlipkartListings(storeId: string) {
  const db = await getDb();
  const [conn] = await db.select().from(platformConnections).where(and(eq(platformConnections.storeId, storeId), eq(platformConnections.platform, "flipkart")));
  if (!conn || conn.uninstalledAt) throw new FlipkartError("Connect your Flipkart seller account first.");
  const { access_token } = await refreshAccess(decryptSecret(conn.accessTokenEncrypted));
  const products = (await listProducts(storeId, { status: ["active", "draft"] })).filter((p) => p.sku);
  let updated = 0;
  const missing: string[] = [];
  for (let i = 0; i < products.length; i += 10) {
    const batch = products.slice(i, i + 10);
    const listings = new Map((await listingsFor(access_token, batch.map((p) => p.sku!))).map((l) => [l.sku, l]));
    for (const p of batch) {
      const l = listings.get(p.sku!);
      if (!l || !l.price) {
        missing.push(p.sku!);
        continue;
      }
      await updateProduct(storeId, p.id, {
        title: p.title,
        description: p.description,
        price: l.price,
        mrp: l.mrp && l.mrp >= l.price ? l.mrp : undefined,
        stock: l.stock ?? p.stock,
        sku: p.sku!,
        images: p.images,
        status: l.active ? "active" : "draft",
      });
      updated++;
    }
  }
  await db.update(platformConnections).set({ meta: { ...conn.meta, syncedAt: new Date().toISOString(), updated, missing: missing.slice(0, 50) } }).where(eq(platformConnections.id, conn.id));
  await kv.log({ type: "seller_action", actor: "system", detail: `Flipkart sync for ${storeId}: ${updated} products updated, ${missing.length} SKUs not on Flipkart` });
  return { updated, missing };
}

