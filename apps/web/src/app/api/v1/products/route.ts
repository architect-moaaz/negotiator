import { bearer, storeForKey } from "@/lib/integrations/keys";
import { listProducts, ProductError, upsertProductBySku } from "@/lib/shop/products";

/** Catalogue for the seller's own systems. Secret key: Authorization: Bearer gc_sk_… */
export async function GET(request: Request) {
  const found = await storeForKey(bearer(request), "secret");
  if (!found) return Response.json({ error: "Invalid or revoked API key." }, { status: 401 });
  const products = await listProducts(found.store.id, { status: ["active", "draft"] });
  return Response.json({ products: products.map((p) => ({ id: p.id, sku: p.sku, title: p.title, price: p.price, mrp: p.mrp, stock: p.stock, status: p.status, images: p.images })) });
}

/** Upsert products by SKU. Body: { products: [{ sku, title, price, mrp?, stock?, category?, description?, images?, status? }] } (max 500). */
export async function POST(request: Request) {
  const found = await storeForKey(bearer(request), "secret");
  if (!found) return Response.json({ error: "Invalid or revoked API key." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { products?: Record<string, unknown>[] };
  if (!Array.isArray(body.products) || !body.products.length) return Response.json({ error: "Send { products: [...] }." }, { status: 400 });
  if (body.products.length > 500) return Response.json({ error: "Up to 500 products per request." }, { status: 413 });
  const results = [];
  for (const [i, p] of body.products.entries()) {
    try {
      const saved = await upsertProductBySku(found.store.id, p as never);
      results.push({ index: i, sku: saved.product.sku, id: saved.product.id, created: saved.created });
    } catch (err) {
      results.push({ index: i, sku: p.sku ?? null, error: err instanceof ProductError ? err.message : "couldn't be saved" });
    }
  }
  return Response.json({ results });
}
