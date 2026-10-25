import { requireStoreAccess } from "@/lib/shop/access";
import { ownershipToken, verificationChecklist } from "@/lib/verification/service";
import { ownershipValue } from "@/lib/verification/ownership";

/** The seller's verification checklist, with masked evidence and the ownership token to publish. */
export async function GET(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/verification">) {
  const { store, denied } = await requireStoreAccess(request, (await ctx.params).id, "view");
  if (denied) return denied;
  const { steps, canSubmit, org, checks } = await verificationChecklist(store);
  const token = store.domain ? await ownershipToken(store) : null;
  return Response.json(
    {
      status: store.status,
      reviewNote: store.reviewNote,
      platform: store.platform,
      domain: store.domain,
      steps,
      canSubmit,
      org,
      ownership: token ? { txt: ownershipValue(token), meta: `<meta name="ghostcart-verification" content="${token}">` } : null,
      checks: checks.map((c) => ({ type: c.type, status: c.status, masked: c.masked, reason: c.details.reason ?? null, createdAt: c.createdAt })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
