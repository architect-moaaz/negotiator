import { rateLimit } from "@/lib/rate-limit";
import { logSellerAction, requireStoreAccess } from "@/lib/shop/access";
import { saveBusinessDetails, VerificationError } from "@/lib/verification/service";

export async function POST(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/verification/business">) {
  const { store, phone, denied } = await requireStoreAccess(request, (await ctx.params).id, "manage");
  if (denied) return denied;
  const limited = await rateLimit({ name: "kyc:org", id: store.orgId, max: 10, windowSeconds: 24 * 60 * 60 });
  if (limited) return limited;
  const body = (await request.json().catch(() => ({}))) as { legalName?: string; businessType?: string; pan?: string; gstin?: string };
  try {
    const checks = await saveBusinessDetails(store.orgId, { legalName: body.legalName ?? "", businessType: body.businessType ?? "", pan: body.pan ?? "", gstin: body.gstin });
    await logSellerAction(store, phone, `submitted business details (${checks.map((c) => `${c.type} ${c.status}`).join(", ")})`);
    return Response.json({ checks: checks.map((c) => ({ type: c.type, status: c.status, masked: c.masked })) });
  } catch (err) {
    if (err instanceof VerificationError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
