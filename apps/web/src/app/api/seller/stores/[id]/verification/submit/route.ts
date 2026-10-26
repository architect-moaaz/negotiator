import { requireStoreAccess } from "@/lib/shop/access";
import { submitForReview, VerificationError } from "@/lib/verification/service";

export async function POST(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/verification/submit">) {
  const { store, denied } = await requireStoreAccess(request, (await ctx.params).id, "manage");
  if (denied) return denied;
  try {
    await submitForReview(store);
    return Response.json({ status: "pending_review" });
  } catch (err) {
    if (err instanceof VerificationError) return Response.json({ error: err.message }, { status: 409 });
    throw err;
  }
}
