import { normalizeGtin } from "@ghostcart/core";
import { schema } from "@ghostcart/db";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { upsertProductBySku } from "../shop/products";
import { numericId, shopifyGraphql } from "./admin";

/** GhostCart's ref for a Shopify product; the theme block prints the same ("shopify-{{ product.id }}"). */
export const shopifySku = (productId: string | number) => `shopify-${numericId(String(productId))}`;

const plain = (html: string | null | undefined) => (html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 4000);

interface GqlProduct {
  id: string;
  title: string;
  descriptionHtml: string;
  status: string;
  vendor?: string | null;
  featuredMedia: { preview: { image: { url: string } | null } | null } | null;
  variants: { nodes: { id: string; price: string; compareAtPrice: string | null; inventoryQuantity: number | null; barcode?: string | null }[] };
}

async function upsert(storeId: string, p: { id: string; title: string; description: string; price: number; mrp?: number; stock: number; image?: string; active: boolean; variantId: string; vendor?: string | null; barcode?: string | null }) {
  const { product } = await upsertProductBySku(storeId, {
    sku: shopifySku(p.id),
    title: p.title,
    description: p.description,
    price: Math.round(p.price),
    mrp: p.mrp && p.mrp > p.price ? Math.round(p.mrp) : undefined,
    stock: Math.max(0, p.stock),
    images: p.image ? [p.image] : [],
    status: p.active ? "active" : "draft",
    // Identity for Rescue my cart; left alone (not cleared) when Shopify has none, so seller edits stay.
    ...(p.vendor?.trim() && { brand: p.vendor.trim().slice(0, 60) }),
    ...(normalizeGtin(p.barcode) && { gtin: p.barcode!.trim() }),
  });
  // Remember which Shopify product and variant this is, for discount codes and cart links.
  const db = await getDb();
  await db.update(schema.products).set({ source: `shopify:${numericId(p.id)}:${numericId(p.variantId)}` }).where(eq(schema.products.id, product.id));
  return product;
}

/** Import (or refresh) the whole catalogue: first variant's price and stock per product. */
export async function importShopifyProducts(storeId: string, shop: string, token: string) {
  let cursor: string | null = null;
  let count = 0;
  for (let page = 0; page < 50; page++) {
    const data: { products: { nodes: GqlProduct[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } = await shopifyGraphql(
      shop,
      token,
      `query GhostCartProducts($cursor: String) {
        products(first: 100, after: $cursor) {
          nodes { id title descriptionHtml status vendor featuredMedia { preview { image { url } } } variants(first: 1) { nodes { id price compareAtPrice inventoryQuantity barcode } } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { cursor },
    );
    for (const p of data.products.nodes) {
      const v = p.variants.nodes[0];
      if (!v || !(Number(v.price) >= 1)) continue;
      await upsert(storeId, { id: p.id, title: p.title, description: plain(p.descriptionHtml), price: Number(v.price), mrp: v.compareAtPrice ? Number(v.compareAtPrice) : undefined, stock: v.inventoryQuantity ?? 0, image: p.featuredMedia?.preview?.image?.url, active: p.status === "ACTIVE", variantId: v.id, vendor: p.vendor, barcode: v.barcode });
      count++;
    }
    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
  }
  return count;
}

/** products/create and products/update webhook payload (REST shape). */
export async function syncShopifyProductWebhook(
  storeId: string,
  p: { id: number; title: string; body_html?: string; status?: string; vendor?: string | null; variants?: { id: number; price: string; compare_at_price?: string | null; inventory_quantity?: number; barcode?: string | null }[]; image?: { src: string } | null },
) {
  const v = p.variants?.[0];
  if (!v || !(Number(v.price) >= 1)) return null;
  return upsert(storeId, { id: String(p.id), title: p.title, description: plain(p.body_html), price: Number(v.price), mrp: v.compare_at_price ? Number(v.compare_at_price) : undefined, stock: v.inventory_quantity ?? 0, image: p.image?.src, active: (p.status ?? "active") === "active", variantId: String(v.id), vendor: p.vendor, barcode: v.barcode });
}

/** products/delete: archive it so old links stop working. */
export async function archiveShopifyProduct(storeId: string, productId: number) {
  const db = await getDb();
  await db.update(schema.products).set({ status: "archived", updatedAt: new Date() }).where(and(eq(schema.products.storeId, storeId), eq(schema.products.sku, shopifySku(productId))));
}
