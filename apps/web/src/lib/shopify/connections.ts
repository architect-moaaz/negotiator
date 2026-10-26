import { schema } from "@ghostcart/db";
import { and, eq, isNull } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "../crypto";
import { getDb } from "../db";

const { platformConnections } = schema;
export type Connection = typeof platformConnections.$inferSelect;

export async function saveShopifyConnection(shop: string, accessToken: string, scopes: string) {
  const db = await getDb();
  const [row] = await db
    .insert(platformConnections)
    .values({ id: `pcn_${randomBytes(8).toString("base64url")}`, platform: "shopify", externalId: shop, accessTokenEncrypted: encryptSecret(accessToken), scopes })
    .onConflictDoUpdate({
      target: [platformConnections.platform, platformConnections.externalId],
      set: { accessTokenEncrypted: encryptSecret(accessToken), scopes, installedAt: new Date(), uninstalledAt: null },
    })
    .returning();
  return row;
}

export async function connectionForShop(shop: string) {
  const db = await getDb();
  const [row] = await db.select().from(platformConnections).where(and(eq(platformConnections.platform, "shopify"), eq(platformConnections.externalId, shop)));
  return row;
}

export async function connectionForStore(storeId: string) {
  const db = await getDb();
  const [row] = await db.select().from(platformConnections).where(and(eq(platformConnections.storeId, storeId), isNull(platformConnections.uninstalledAt)));
  return row;
}

export async function updateConnection(id: string, patch: Partial<Pick<Connection, "storeId" | "meta" | "uninstalledAt">>) {
  const db = await getDb();
  const [row] = await db.update(platformConnections).set(patch).where(eq(platformConnections.id, id)).returning();
  return row;
}

export const tokenOf = (c: Connection) => decryptSecret(c.accessTokenEncrypted);
