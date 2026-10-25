import type { DiscountPolicy, PolicyScope } from "@ghostcart/core";
import { logSellerAction, requireStoreAccess } from "@/lib/shop/access";
import { PolicyError, setPolicy, storePolicies } from "@/lib/shop/policies";

const num = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : Number(v));
const bool = (v: unknown) => (v === undefined || v === null ? undefined : Boolean(v));

/** Save the discount rules at one level. Body: { scope, targetId, policy }. Empty fields inherit. */
export async function PUT(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/policies">) {
  const { store, phone, denied } = await requireStoreAccess(request, (await ctx.params).id, "catalogue");
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { scope?: PolicyScope; targetId?: string | null; policy?: Record<string, unknown> };
  if (body.scope !== "store" && body.scope !== "category" && body.scope !== "product") return Response.json({ error: "Pick what this rule applies to." }, { status: 400 });
  const p = body.policy ?? {};
  const policy: DiscountPolicy = {
    enabled: bool(p.enabled),
    maxDiscountPct: num(p.maxDiscountPct),
    autoApprovePct: num(p.autoApprovePct),
    floorPrice: num(p.floorPrice),
    maxRounds: num(p.maxRounds),
    expiryMinutes: num(p.expiryMinutes),
    bundlesAllowed: bool(p.bundlesAllowed),
    channels: Array.isArray(p.channels) ? p.channels.map(String) : undefined,
  };
  try {
    await setPolicy(store.id, body.scope, body.scope === "store" ? null : (body.targetId ?? null), policy);
  } catch (err) {
    if (err instanceof PolicyError) return Response.json({ error: err.message, errors: err.errors }, { status: 400 });
    throw err;
  }
  await logSellerAction(store, phone, `set ${body.scope} discount rules${body.targetId ? ` for ${body.targetId}` : ""}: ${JSON.stringify(policy)}`);
  const all = await storePolicies(store.id);
  return Response.json({ store: all.store ?? {}, categories: Object.fromEntries(all.categories), products: Object.fromEntries(all.products) });
}
