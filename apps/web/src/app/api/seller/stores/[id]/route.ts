import { requireStoreAccess } from "@/lib/shop/access";
import { storePolicies } from "@/lib/shop/policies";
import { listCategories, listProducts } from "@/lib/shop/products";

/** Everything the seller dashboard shows for one store. */
export async function GET(request: Request, ctx: RouteContext<"/api/seller/stores/[id]">) {
  const { store, role, denied } = await requireStoreAccess(request, (await ctx.params).id, "view");
  if (denied) return denied;
  const [categories, products, policies] = await Promise.all([listCategories(store.id), listProducts(store.id, { status: ["active", "draft"] }), storePolicies(store.id)]);
  return Response.json(
    {
      store,
      role,
      categories,
      products,
      policies: { store: policies.store ?? {}, categories: Object.fromEntries(policies.categories), products: Object.fromEntries(policies.products) },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
