import { schema } from "@ghostcart/db";
import { and, eq, isNull } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "../crypto";
import { getDb } from "../db";
import { importProductsCsv } from "../shop/products";
import { store as kv } from "../store";
import { accessTokenFor, exchangeAuthCode, fetchReportIfReady, listingsTsvToCsv, requestListingsReport } from "./spapi";

const { kycChecks, platformConnections } = schema;

/**
 * Seller Central authorised GhostCart: keep the refresh token (encrypted), record the authorisation as
 * proof that the seller owns the Amazon account, and start importing their listings.
 */
export async function completeAmazonConnect(input: { storeId: string; orgId: string; code: string; sellingPartnerId: string }) {
  const tokens = await exchangeAuthCode(input.code);
  if (!tokens.refresh_token) throw new Error("Amazon didn't return a refresh token.");
  const db = await getDb();
  const [conn] = await db
    .insert(platformConnections)
    .values({ id: `pcn_${randomBytes(8).toString("base64url")}`, storeId: input.storeId, platform: "amazon", externalId: input.sellingPartnerId, accessTokenEncrypted: encryptSecret(tokens.refresh_token), scopes: "listings:read" })
    .onConflictDoUpdate({ target: [platformConnections.platform, platformConnections.externalId], set: { storeId: input.storeId, accessTokenEncrypted: encryptSecret(tokens.refresh_token), installedAt: new Date(), uninstalledAt: null } })
    .returning();
  await db.insert(kycChecks).values({
    id: `kyc_${randomBytes(9).toString("base64url")}`,
    orgId: input.orgId,
    storeId: input.storeId,
    type: "ownership_marketplace",
    status: "passed",
    provider: "amazon",
    masked: input.sellingPartnerId,
    details: { reason: "Authorised GhostCart from Amazon Seller Central." },
  });
  const reportId = await requestListingsReport(tokens.access_token);
  await db.update(platformConnections).set({ meta: { reportId, reportRequestedAt: new Date().toISOString() } }).where(eq(platformConnections.id, conn.id));
  return { reportId };
}

/** Scheduled: import any listings reports Amazon has finished building. */
export async function pollAmazonImports() {
  const db = await getDb();
  const pending = (await db.select().from(platformConnections).where(and(eq(platformConnections.platform, "amazon"), isNull(platformConnections.uninstalledAt)))).filter((c) => c.meta.reportId && !c.meta.importedAt);
  const done: { storeId: string; imported: number; errors: number }[] = [];
  for (const c of pending) {
    try {
      const access = await accessTokenFor(decryptSecret(c.accessTokenEncrypted));
      const tsv = await fetchReportIfReady(access, String(c.meta.reportId));
      if (tsv === null || !c.storeId) continue;
      const result = await importProductsCsv(c.storeId, listingsTsvToCsv(tsv), "amazon");
      await db.update(platformConnections).set({ meta: { ...c.meta, importedAt: new Date().toISOString(), imported: result.created, importErrors: result.errors.slice(0, 50) } }).where(eq(platformConnections.id, c.id));
      await kv.log({ type: "seller_action", actor: "system", detail: `Amazon listings imported into ${c.storeId}: ${result.created} products, ${result.errors.length} skipped` });
      done.push({ storeId: c.storeId, imported: result.created, errors: result.errors.length });
    } catch (err) {
      console.error(`Amazon import failed for ${c.storeId}`, err);
      await db.update(platformConnections).set({ meta: { ...c.meta, lastError: String(err).slice(0, 300) } }).where(eq(platformConnections.id, c.id));
    }
  }
  return done;
}
