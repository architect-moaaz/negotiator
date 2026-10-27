import { schema } from "@ghostcart/db";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { store as kv } from "../store";
import { getProduct } from "./products";

const { productBoosts } = schema;

export class BoostError extends Error {}

/**
 * Promoted listings, set by GhostCart staff once a seller has paid (pricing and billing are a business
 * decision still open). A boost only moves a product up the catalogue; the shopper always sees
 * "Sponsored", and the seller's prices and haggle rules are untouched.
 */
export async function setBoost(productId: string, days: number, note: string, by: string, now = new Date()) {
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new BoostError("Boost for 1 to 90 days.");
  const p = await getProduct(productId);
  if (!p) throw new BoostError("Product not found.");
  const until = new Date(now.getTime() + days * 86_400_000);
  const db = await getDb();
  const values = { storeId: p.storeId, until, note: note.trim().slice(0, 200), createdBy: by, createdAt: now };
  await db.insert(productBoosts).values({ productId, ...values }).onConflictDoUpdate({ target: productBoosts.productId, set: values });
  await kv.log({ type: "staff_action", actor: "human", detail: `${by} boosted ${p.title} (${productId}) until ${until.toISOString().slice(0, 10)}: ${note}` });
  return { productId, until };
}

export async function removeBoost(productId: string, by: string) {
  const db = await getDb();
  const [row] = await db.delete(productBoosts).where(eq(productBoosts.productId, productId)).returning();
  if (row) await kv.log({ type: "staff_action", actor: "human", detail: `${by} removed the boost on ${productId}` });
  return !!row;
}
