import type { AwayRule } from "@ghostcart/core";
import { applyAutoPct, getAwayRule, setAwayRule, storePlaybook } from "@/lib/shop/automation";
import { logSellerAction, requireStoreAccess } from "@/lib/shop/access";
import { PolicyError } from "@/lib/shop/policies";

/** The store's away rule and playbook suggestions. */
export async function GET(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/automation">) {
  const { store, denied } = await requireStoreAccess(request, (await ctx.params).id, "view");
  if (denied) return denied;
  const [away, suggestions] = await Promise.all([getAwayRule(store.id), storePlaybook(store.id)]);
  return Response.json({ away, suggestions }, { headers: { "Cache-Control": "no-store" } });
}

/** Save the away rule. Body: Partial<AwayRule>. */
export async function PUT(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/automation">) {
  const { store, phone, denied } = await requireStoreAccess(request, (await ctx.params).id, "manage");
  if (denied) return denied;
  const b = (await request.json().catch(() => ({}))) as Partial<Record<keyof AwayRule, unknown>>;
  const input: Partial<AwayRule> = {
    ...(typeof b.enabled === "boolean" ? { enabled: b.enabled } : {}),
    ...(b.maxPctOff !== undefined ? { maxPctOff: Number(b.maxPctOff) } : {}),
    ...(Array.isArray(b.days) ? { days: b.days.map(Number) } : {}),
    ...(b.startHour !== undefined ? { startHour: Number(b.startHour) } : {}),
    ...(b.endHour !== undefined ? { endHour: Number(b.endHour) } : {}),
  };
  try {
    const away = await setAwayRule(store.id, input);
    await logSellerAction(store, phone, `set away rule: ${JSON.stringify(away)}`);
    return Response.json({ away });
  } catch (err) {
    if (err instanceof PolicyError) return Response.json({ error: err.message, errors: err.errors }, { status: 400 });
    throw err;
  }
}

/** Apply a playbook suggestion. Body: { productId, autoApprovePct }. */
export async function POST(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/automation">) {
  const { store, phone, denied } = await requireStoreAccess(request, (await ctx.params).id, "catalogue");
  if (denied) return denied;
  const { productId, autoApprovePct } = (await request.json().catch(() => ({}))) as { productId?: string; autoApprovePct?: unknown };
  try {
    await applyAutoPct(store.id, String(productId ?? ""), Number(autoApprovePct));
    await logSellerAction(store, phone, `applied playbook: agent alone to ${autoApprovePct}% on ${productId}`);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof PolicyError) return Response.json({ error: err.message, errors: err.errors }, { status: 400 });
    throw err;
  }
}
