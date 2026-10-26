import { requireStoreAccess } from "@/lib/shop/access";
import { storeMoney } from "@/lib/orders/service";

/** Seller payouts: money held until delivery and released, plus recent orders (paise). */
export async function GET(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/money">) {
  const { store, denied } = await requireStoreAccess(request, (await ctx.params).id, "view");
  if (denied) return denied;
  const money = await storeMoney(store.id);
  return Response.json(
    { held: money.held, released: money.released, orders: money.orders.map((o) => ({ ...o, address: undefined })) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
