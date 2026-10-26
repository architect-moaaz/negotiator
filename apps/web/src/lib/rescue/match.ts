import { matchProduct, normalizeGtin, normalizeModel, rankMatches, titleTokens, type MatchResult } from "@ghostcart/core";
import { schema } from "@ghostcart/db";
import { and, eq, gt, ilike, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "../db";
import { policyForProduct } from "../shop/policies";

const { products, stores } = schema;

export interface RescueQuery {
  title: string;
  brand?: string;
  gtin?: string;
  model?: string;
}

export interface RescueOffer {
  productId: string;
  title: string;
  image?: string;
  price: number;
  mrp: number | null;
  storeId: string;
  storeName: string;
  storeSlug: string;
  platform: string;
  match: MatchResult;
}

const PER_ITEM = 5;

/**
 * GhostCart sellers who have this item (or something very like it) and haggle on it: live stores,
 * active and in stock. The same item (barcode, brand + model) comes before similar ones, then cheapest.
 */
export async function findOffers(q: RescueQuery): Promise<RescueOffer[]> {
  const db = await getDb();
  const gtin = normalizeGtin(q.gtin);
  const words = [...new Set(titleTokens(`${q.brand ?? ""} ${q.title}`))].filter((w) => w.length >= 3).sort((a, b) => b.length - a.length).slice(0, 4);
  const find: SQL[] = [];
  if (gtin) find.push(eq(products.gtin, gtin));
  for (const w of words) find.push(ilike(products.title, `%${w.replace(/[%_\\]/g, "")}%`));
  if (q.brand?.trim()) find.push(ilike(products.brand, q.brand.trim().replace(/[%_\\]/g, "")));
  // Model numbers compared on letters and digits only, from the query's model or any model-like title word.
  const models = [...new Set([normalizeModel(q.model), ...titleTokens(q.title).map(normalizeModel)].filter((m): m is string => !!m && /[A-Z]/.test(m)))].slice(0, 4);
  for (const m of models) find.push(sql`upper(regexp_replace(${products.modelNumber}, '[^A-Za-z0-9]', '', 'g')) = ${m}`);
  if (!find.length) return [];
  const rows = await db
    .select({ p: products, s: { name: stores.name, slug: stores.slug, platform: stores.platform } })
    .from(products)
    .innerJoin(stores, eq(stores.id, products.storeId))
    .where(and(eq(stores.status, "live"), eq(products.status, "active"), gt(products.stock, 0), or(...find)))
    .limit(300);

  const offers: RescueOffer[] = [];
  for (const { p, s } of rows) {
    const match = matchProduct(q, p);
    if (!match) continue;
    if (!(await policyForProduct(p)).enabled) continue; // sold at a fixed price: nothing to haggle
    offers.push({ productId: p.id, title: p.title, image: p.images[0], price: p.price, mrp: p.mrp, storeId: p.storeId, storeName: s.name, storeSlug: s.slug, platform: s.platform, match });
  }
  // One offer per store for the same query: its best match.
  const best = new Map<string, RescueOffer>();
  for (const o of rankMatches(offers)) if (!best.has(o.storeId)) best.set(o.storeId, o);
  return [...best.values()].slice(0, PER_ITEM);
}
