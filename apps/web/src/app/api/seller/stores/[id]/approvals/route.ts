import { applyRecommendation } from "@/lib/deal-desk";
import { counterFromApprover, decideApproval, HaggleError, toPublic } from "@/lib/negotiate";
import { logSellerAction, requireStoreAccess } from "@/lib/shop/access";
import { memberName } from "@/lib/shop/orgs";
import { store as kv } from "@/lib/store";
import type { Deal } from "@/lib/types";

const forStore = (storeId: string) => async () => (await kv.listDeals(2000)).filter((d) => d.shop?.storeId === storeId);

/** Offers waiting on this store, plus recent negotiations, with the limits the agent worked within. */
export async function GET(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/approvals">) {
  const { store, denied } = await requireStoreAccess(request, (await ctx.params).id, "view");
  if (denied) return denied;
  const deals = await forStore(store.id)();
  const view = (d: Deal) => ({ ...toPublic(d), terms: d.negotiation?.terms, recommendation: d.negotiation?.recommendation ?? null });
  return Response.json(
    { waiting: deals.filter((d) => d.status === "awaiting_approval").map(view), recent: deals.filter((d) => d.status !== "awaiting_approval").slice(0, 30).map(view) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Body: { dealId, decision: "approved" | "rejected" | "recommendation" | "counter", price? }. */
export async function POST(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/approvals">) {
  const { store, phone, denied } = await requireStoreAccess(request, (await ctx.params).id, "approve");
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { dealId?: string; decision?: string; price?: number };
  const deal = body.dealId ? await kv.getDeal(body.dealId) : undefined;
  if (!deal || deal.shop?.storeId !== store.id) return Response.json({ error: "Deal not found." }, { status: 404 });
  const by = (await memberName(store.orgId, phone)) ?? store.name;
  try {
    let updated: Deal;
    if (body.decision === "approved" || body.decision === "rejected") updated = await decideApproval(deal, body.decision, by, "seller");
    else if (body.decision === "recommendation") updated = await applyRecommendation(deal, by, "seller");
    else if (body.decision === "counter") {
      const t = deal.negotiation!.terms;
      const price = Math.round(Number(body.price));
      // The seller can name any price between the shopper's offer and the list price; the floor still binds.
      if (!(price >= Math.max(t.floor, deal.negotiation!.approval?.price ?? 0) && price <= t.benchmark))
        return Response.json({ error: `Counter between the shopper's offer and the list price, and not below your floor of ₹${t.floor.toLocaleString("en-IN")}.` }, { status: 400 });
      updated = await counterFromApprover(deal, price, by, "seller");
    } else return Response.json({ error: "Approve, reject or counter." }, { status: 400 });
    await logSellerAction(store, phone, `${body.decision} on deal ${deal.id}${body.decision === "counter" ? ` at ₹${body.price}` : ""}`);
    return Response.json(toPublic(updated));
  } catch (err) {
    if (err instanceof HaggleError) {
      const message = /payments are paused/.test(err.message) ? "Payments are paused, so the shopper can't lock this price yet. Try approving again in a few minutes." : err.message;
      return Response.json({ error: message }, { status: 409 });
    }
    throw err;
  }
}
