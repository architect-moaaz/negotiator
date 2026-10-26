import { rateLimit } from "@/lib/rate-limit";
import { logSellerAction, requireStoreAccess } from "@/lib/shop/access";
import { checkDomainOwnership, VerificationError } from "@/lib/verification/service";

/** Check the DNS TXT record or meta tag now. Body: { method: "dns" | "meta" }. */
export async function POST(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/verification/ownership">) {
  const { store, phone, denied } = await requireStoreAccess(request, (await ctx.params).id, "manage");
  if (denied) return denied;
  const limited = await rateLimit({ name: "ownership:store", id: store.id, max: 30, windowSeconds: 60 * 60 });
  if (limited) return limited;
  const { method } = (await request.json().catch(() => ({}))) as { method?: string };
  if (method !== "dns" && method !== "meta") return Response.json({ error: "Pick DNS or meta tag." }, { status: 400 });
  try {
    const check = await checkDomainOwnership(store, method);
    await logSellerAction(store, phone, `checked ${method} ownership of ${store.domain}: ${check.status}`);
    return Response.json({ check: { type: check.type, status: check.status, reason: check.details.reason ?? null } });
  } catch (err) {
    if (err instanceof VerificationError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
