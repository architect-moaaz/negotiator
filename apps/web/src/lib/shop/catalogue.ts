import { schema } from "@ghostcart/db";
import { and, desc, eq, gt, ilike, inArray, or, sql } from "drizzle-orm";
import { getDb } from "../db";

const { categories, products, stores } = schema;

export interface CatalogueItem {
  productId: string;
  title: string;
  price: number;
  mrp: number | null;
  image: string | null;
  storeName: string;
  storeSlug: string;
  category: string | null;
}

/**
 * Products shoppers can haggle on right now, across every live GhostCart seller: in stock, active, in a
 * live store. Search matches every word of the query in the title or category.
 */
export async function searchCatalogue(query = "", limit = 24): Promise<CatalogueItem[]> {
  const db = await getDb();
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1).slice(0, 6);
  const rows = await db
    .select({
      productId: products.id,
      title: products.title,
      price: products.price,
      mrp: products.mrp,
      images: products.images,
      storeName: stores.name,
      storeSlug: stores.slug,
      category: categories.name,
    })
    .from(products)
    .innerJoin(stores, eq(stores.id, products.storeId))
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(
      and(
        eq(stores.status, "live"),
        eq(products.status, "active"),
        gt(products.stock, 0),
        ...words.map((w) => or(ilike(products.title, `%${w.replace(/[%_]/g, "")}%`), ilike(categories.name, `%${w.replace(/[%_]/g, "")}%`))),
      ),
    )
    .orderBy(desc(products.updatedAt))
    .limit(Math.min(60, limit));
  return rows.map(({ images, ...r }) => ({ ...r, image: images[0] ?? null }));
}

/** Live shops with something to sell, for the home page. */
export async function liveShops(limit = 12) {
  const db = await getDb();
  const rows = await db
    .select({ name: stores.name, slug: stores.slug, products: sql<number>`count(${products.id})::int` })
    .from(stores)
    .innerJoin(products, and(eq(products.storeId, stores.id), eq(products.status, "active"), gt(products.stock, 0)))
    .where(and(eq(stores.status, "live"), inArray(stores.platform, ["ghostcart_shop", "website", "shopify", "woocommerce", "amazon", "flipkart"])))
    .groupBy(stores.name, stores.slug)
    .orderBy(desc(sql`count(${products.id})`))
    .limit(limit);
  return rows;
}
