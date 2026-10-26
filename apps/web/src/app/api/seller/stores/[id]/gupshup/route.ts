import { connectGupshup, GupshupError } from "@/lib/gupshup/gupshup";
import { logSellerAction, requireStoreAccess } from "@/lib/shop/access";

/** Connect the seller's Gupshup WhatsApp app. Body: { appName, apiKey, phone }. Owner only. */
export async function POST(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/gupshup">) {
  const { store, phone, denied } = await requireStoreAccess(request, (await ctx.params).id, "manage");
  if (denied) return denied;
  try {
    const out = await connectGupshup(store.id, await request.json().catch(() => ({})));
    await logSellerAction(store, phone, `connected WhatsApp via Gupshup (${out.phone})`);
    return Response.json(out);
  } catch (err) {
    if (err instanceof GupshupError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
