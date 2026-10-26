import { logSellerAction, requireStoreAccess } from "@/lib/shop/access";
import { DisclosureError, saveDisclosure } from "@/lib/shop/disclosure";

/** Save what buyers are shown about the seller: address, customer care, return policy. Owner only. */
export async function PUT(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/disclosure">) {
  const { store, phone, denied } = await requireStoreAccess(request, (await ctx.params).id, "manage");
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  try {
    const disclosure = await saveDisclosure(store.id, body);
    await logSellerAction(store, phone, "updated shop details for buyers (address, customer care, returns)");
    return Response.json({ disclosure });
  } catch (err) {
    if (err instanceof DisclosureError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
