import { FlipkartError } from "@/lib/flipkart/api";
import { syncFlipkartListings } from "@/lib/flipkart/connect";
import { logSellerAction, requireStoreAccess } from "@/lib/shop/access";

/** Refresh prices and stock from Flipkart for the store's SKUs. Body: { storeId }. */
export async function POST(request: Request) {
  const { storeId } = (await request.json().catch(() => ({}))) as { storeId?: string };
  const { store, phone, denied } = await requireStoreAccess(request, storeId ?? "", "catalogue");
  if (denied) return denied;
  try {
    const out = await syncFlipkartListings(store.id);
    await logSellerAction(store, phone, `synced Flipkart listings: ${out.updated} updated`);
    return Response.json(out);
  } catch (err) {
    if (err instanceof FlipkartError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
