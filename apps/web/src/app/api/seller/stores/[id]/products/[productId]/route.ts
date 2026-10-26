import { logSellerAction, requireStoreAccess } from "@/lib/shop/access";
import { ProductError, updateProduct } from "@/lib/shop/products";

export async function PUT(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/products/[productId]">) {
  const { id, productId } = await ctx.params;
  const { store, phone, denied } = await requireStoreAccess(request, id, "catalogue");
  if (denied) return denied;
  try {
    const product = await updateProduct(store.id, productId, await request.json().catch(() => ({})));
    if (!product) return Response.json({ error: "Product not found." }, { status: 404 });
    await logSellerAction(store, phone, `updated ${product.title}: ₹${product.price}, ${product.stock} in stock, ${product.status}`);
    return Response.json(product);
  } catch (err) {
    if (err instanceof ProductError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
