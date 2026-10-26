import { rateLimit } from "@/lib/rate-limit";
import { logSellerAction, requireStoreAccess } from "@/lib/shop/access";
import { saveBankAccount, VerificationError } from "@/lib/verification/service";

export async function POST(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/verification/bank">) {
  const { store, phone, denied } = await requireStoreAccess(request, (await ctx.params).id, "manage");
  if (denied) return denied;
  const limited = await rateLimit({ name: "bank:org", id: store.orgId, max: 5, windowSeconds: 24 * 60 * 60 });
  if (limited) return limited;
  const body = (await request.json().catch(() => ({}))) as { holderName?: string; account?: string; ifsc?: string };
  try {
    const check = await saveBankAccount(store.orgId, { holderName: body.holderName ?? "", account: body.account ?? "", ifsc: body.ifsc ?? "" });
    await logSellerAction(store, phone, `added payout account ${check.masked} (${check.status})`);
    return Response.json({ check: { type: check.type, status: check.status, masked: check.masked } });
  } catch (err) {
    if (err instanceof VerificationError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
