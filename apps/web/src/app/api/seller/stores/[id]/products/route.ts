import { logSellerAction, requireStoreAccess } from "@/lib/shop/access";
import { createProduct, ProductError } from "@/lib/shop/products";

export async function POST(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/products">) {
  const { store, phone, denied } = await requireStoreAccess(request, (await ctx.params).id, "catalogue");
  if (denied) return denied;
  try {
    const product = await createProduct(store.id, await request.json().catch(() => ({})));
    await logSellerAction(store, phone, `added ${product.title} at ₹${product.price}`);
    return Response.json(product);
  } catch (err) {
    if (err instanceof ProductError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
