import { schema } from "@ghostcart/db";
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { newId } from "./ids";

const { categories, products } = schema;

export type Product = typeof products.$inferSelect;
export type Category = typeof categories.$inferSelect;

/** What a seller types (or a CSV row holds). Prices are whole rupees. */
export const productInput = z.object({
  title: z.string().trim().min(2, "Add a product name.").max(160),
  description: z.string().trim().max(4000).default(""),
  price: z.coerce.number({ error: "Add a price." }).int("Price must be whole rupees.").min(1, "Add a price."),
  mrp: z.coerce.number({ error: "MRP must be a number." }).int("MRP must be whole rupees.").min(1).optional(),
  stock: z.coerce.number({ error: "Stock must be a number." }).int("Stock must be a whole number.").min(0, "Stock can't be negative.").default(0),
  category: z.string().trim().max(60).optional(),
  sku: z.string().trim().max(60).optional(),
  images: z.array(z.string().url()).max(8).default([]),
  status: z.enum(["active", "draft", "archived"]).default("active"),
});
export type ProductInput = z.input<typeof productInput>;

export class ProductError extends Error {}

function parse(input: ProductInput) {
  const r = productInput.safeParse(input);
  if (!r.success) throw new ProductError(r.error.issues[0]?.message ?? "Check the product details.");
  if (r.data.mrp !== undefined && r.data.mrp < r.data.price) throw new ProductError("MRP can't be below the price.");
  return r.data;
}

/** The category with this name in the store, created on first use. */
export async function ensureCategory(storeId: string, name: string) {
  const db = await getDb();
  const clean = name.trim().slice(0, 60);
  await db.insert(categories).values({ id: newId("cat"), storeId, name: clean }).onConflictDoNothing();
  const [row] = await db.select().from(categories).where(and(eq(categories.storeId, storeId), eq(categories.name, clean)));
  return row;
}

export async function listCategories(storeId: string) {
  const db = await getDb();
  return db.select().from(categories).where(eq(categories.storeId, storeId)).orderBy(asc(categories.name));
}

export async function createProduct(storeId: string, input: ProductInput, source = "manual"): Promise<Product> {
  const db = await getDb();
  const p = parse(input);
  const categoryId = p.category ? (await ensureCategory(storeId, p.category)).id : null;
  const [row] = await db
    .insert(products)
    .values({ id: newId("prd"), storeId, categoryId, title: p.title, description: p.description, price: p.price, mrp: p.mrp ?? null, stock: p.stock, sku: p.sku ?? null, images: p.images, status: p.status, source })
    .returning();
  return row;
}

export async function updateProduct(storeId: string, id: string, input: ProductInput) {
  const db = await getDb();
  const p = parse(input);
  const categoryId = p.category ? (await ensureCategory(storeId, p.category)).id : null;
  const [row] = await db
    .update(products)
    .set({ categoryId, title: p.title, description: p.description, price: p.price, mrp: p.mrp ?? null, stock: p.stock, sku: p.sku ?? null, images: p.images, status: p.status, updatedAt: new Date() })
    .where(and(eq(products.id, id), eq(products.storeId, storeId)))
    .returning();
  return row as Product | undefined;
}

export async function getProduct(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(products).where(eq(products.id, id));
  return row as Product | undefined;
}

export async function listProducts(storeId: string, { status }: { status?: Product["status"][] } = {}) {
  const db = await getDb();
  return db
    .select()
    .from(products)
    .where(status ? and(eq(products.storeId, storeId), inArray(products.status, status)) : eq(products.storeId, storeId))
    .orderBy(desc(products.updatedAt));
}

/** Minimal RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

export const CSV_COLUMNS = ["title", "price", "mrp", "stock", "category", "sku", "description", "image_url"] as const;

/**
 * Other names for our columns, so a marketplace's own listing export imports as-is: Amazon's inventory
 * report (item-name, seller-sku, price, quantity) and Flipkart's listing export (Seller SKU Id, Product
 * Title, Your Selling Price, MRP, System Stock). Matched after lowercasing and collapsing separators.
 */
const COLUMN_ALIASES: Record<string, (typeof CSV_COLUMNS)[number]> = {
  item_name: "title",
  product_title: "title",
  product_name: "title",
  listing_title: "title",
  name: "title",
  seller_sku: "sku",
  seller_sku_id: "sku",
  sku_id: "sku",
  your_selling_price: "price",
  selling_price: "price",
  sale_price: "price",
  maximum_retail_price: "mrp",
  list_price: "mrp",
  quantity: "stock",
  system_stock: "stock",
  stock_count: "stock",
  inventory: "stock",
  available_quantity: "stock",
  item_description: "description",
  product_description: "description",
  image: "image_url",
  main_image_url: "image_url",
  image_link: "image_url",
  product_category: "category",
  vertical: "category",
};

/**
 * Import a catalogue CSV (header row required; columns in any order, see CSV_COLUMNS). Valid rows are
 * created; each bad row is reported with its line number and reason, and the rest still import.
 */
export async function importProductsCsv(storeId: string, text: string, source = "csv") {
  const [header, ...rows] = parseCsv(text.replace(/^﻿/, ""));
  if (!header) return { created: 0, errors: ["The file is empty."] };
  const cols: string[] = header.map((h) => {
    const key = h.trim().toLowerCase().replace(/[\s\-()]+/g, "_").replace(/_+$/, "");
    return COLUMN_ALIASES[key] ?? key;
  });
  if (!cols.includes("title") || !cols.includes("price")) return { created: 0, errors: ["The header row needs at least title and price columns."] };
  if (rows.length > 5000) return { created: 0, errors: ["Import up to 5,000 products at a time."] };

  let created = 0;
  const errors: string[] = [];
  for (const [i, cells] of rows.entries()) {
    const get = (c: string) => {
      const v = cells[cols.indexOf(c)]?.trim();
      return v ? v : undefined;
    };
    try {
      const save = get("sku") ? (input: ProductInput) => upsertProductBySku(storeId, { ...input, sku: get("sku") }) : (input: ProductInput) => createProduct(storeId, input, source);
      await save(
        {
          title: get("title") ?? "",
          price: Number(get("price")?.replace(/[₹,\s]/g, "")),
          mrp: get("mrp") ? Number(get("mrp")!.replace(/[₹,\s]/g, "")) : undefined,
          stock: get("stock") ? Number(get("stock")) : 0,
          category: get("category"),
          sku: get("sku"),
          description: get("description") ?? "",
          images: get("image_url") ? [get("image_url")!] : [],
        },
      );
      created++;
    } catch (err) {
      errors.push(`Line ${i + 2}: ${err instanceof ProductError ? err.message : "couldn't be saved."}`);
    }
  }
  return { created, errors };
}

/** One unit sold. Never goes below zero; returns false if it was already out of stock. */
export async function takeStock(productId: string) {
  const db = await getDb();
  const rows = await db
    .update(products)
    .set({ stock: sql`${products.stock} - 1`, updatedAt: new Date() })
    .where(and(eq(products.id, productId), gt(products.stock, 0)))
    .returning({ id: products.id });
  return rows.length > 0;
}

/** A product by the seller's SKU, or by GhostCart product id. */
export async function getProductByRef(storeId: string, ref: string) {
  const db = await getDb();
  const [bySku] = await db.select().from(products).where(and(eq(products.storeId, storeId), eq(products.sku, ref)));
  if (bySku) return bySku;
  const [byId] = await db.select().from(products).where(and(eq(products.storeId, storeId), eq(products.id, ref)));
  return byId as Product | undefined;
}

/** Catalogue sync: create or update by SKU (the SKU is required here). */
export async function upsertProductBySku(storeId: string, input: ProductInput & { sku?: string }) {
  if (!input.sku?.trim()) throw new ProductError("Each product needs a sku.");
  const existing = await getProductByRef(storeId, input.sku.trim());
  if (existing && existing.sku === input.sku.trim()) return { product: (await updateProduct(storeId, existing.id, input))!, created: false };
  return { product: await createProduct(storeId, input, "api"), created: true };
}
