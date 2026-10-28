import { schema } from "@ghostcart/db";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { grantAdapterFor } from "../grants/adapters";
import type { Product } from "./products";
import type { Store } from "./stores";

const { products } = schema;

/**
 * Ask the seller's own platform (Shopify, WooCommerce) how many are in stock right now and save it, so
 * a shopper never haggles for something already sold elsewhere. If the platform doesn't answer in time
 * the last synced stock stands: a slow store shouldn't block haggling.
 */
export async function refreshLiveStock(store: Store, items: Product[], timeoutMs = 4000) {
  const adapter = await grantAdapterFor(store);
  if (!adapter?.liveStock || !items.length) return items;
  let live: Map<string, number>;
  try {
    live = await Promise.race([adapter.liveStock({ store, products: items }), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs))]);
  } catch (err) {
    console.warn(`live stock check failed for ${store.id}`, err);
    return items;
  }
  const db = await getDb();
  const out: Product[] = [];
  for (const p of items) {
    const qty = live.get(p.id);
    if (qty === undefined || qty === p.stock) {
      out.push(p);
      continue;
    }
    await db.update(products).set({ stock: qty, updatedAt: new Date() }).where(eq(products.id, p.id));
    out.push({ ...p, stock: qty });
  }
  return out;
}

/** Units back on the shelf: an order cancelled before shipping, or a return received. */
export async function putBackStock(productId: string | null, quantity = 1) {
  if (!productId || quantity < 1) return;
  const db = await getDb();
  await db.update(products).set({ stock: sql`${products.stock} + ${quantity}`, updatedAt: new Date() }).where(eq(products.id, productId));
}
