import { OrderError } from "@/lib/orders/service";
import { replyToReview, reviewsForStore } from "@/lib/reviews";
import { logSellerAction, requireStoreAccess } from "@/lib/shop/access";

/** What buyers said about this store's orders (hidden ones included, marked). */
export async function GET(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/reviews">) {
  const { store, denied } = await requireStoreAccess(request, (await ctx.params).id, "view");
  if (denied) return denied;
  const rows = await reviewsForStore(store.id);
  return Response.json({
    reviews: rows.map((r) => ({ id: r.id, productId: r.productId, authorName: r.authorName, rating: r.rating, body: r.body, sellerReply: r.sellerReply, hidden: !!r.hiddenAt, createdAt: r.createdAt })),
  });
}

/** Reply once to a review. Body: { reviewId, reply }. */
export async function POST(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/reviews">) {
  const { store, phone, denied } = await requireStoreAccess(request, (await ctx.params).id, "catalogue");
  if (denied) return denied;
  const { reviewId, reply } = (await request.json().catch(() => ({}))) as { reviewId?: string; reply?: string };
  try {
    const r = await replyToReview(store.id, String(reviewId ?? ""), String(reply ?? ""));
    await logSellerAction(store, phone, `replied to review ${r.id}`);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof OrderError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
