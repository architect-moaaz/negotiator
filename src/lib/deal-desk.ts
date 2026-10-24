import { counterFromApprover, decideApproval, HaggleError, inr } from "./negotiate";
import { store } from "./store";
import type { AgentRecommendation, Deal } from "./types";

/** Everything the deal-desk agent needs to judge an escalated offer. Internal: includes margin limits. */
export function dealBrief(deal: Deal) {
  const n = deal.negotiation!;
  const t = n.terms;
  const offer = n.approval?.price;
  return {
    deal_id: deal.id,
    status: deal.status,
    product: { title: deal.product.title, listed_price: deal.product.price, mrp: deal.product.mrp, marketplace: deal.product.seller },
    sold_by: deal.product.soldBy ?? null,
    other_sellers: deal.alternatives.map((q) => ({ seller: q.seller, price: q.price, in_stock: q.inStock })),
    best_market_price: t.benchmark,
    discount_funded_by: t.fundedBy === "seller" ? `seller: ${t.sellerName}` : "ghostcart_commission",
    category: t.category,
    commission_rate_estimate: t.commissionRate,
    discount_budget: t.budget,
    floor_price: t.floor,
    auto_approve_limit: t.autoLimit,
    shopper_offer: offer ?? null,
    margin_left_at_shopper_offer: offer !== undefined ? offer - t.floor : null,
    discount_vs_market_pct: offer !== undefined ? Number((((t.benchmark - offer) / t.benchmark) * 100).toFixed(2)) : null,
    agent_last_offer: n.currentOffer,
    rounds_haggled: n.rounds,
    shopper_city: deal.city ?? null,
    transcript: n.messages.map((m) => `${m.from}: ${m.text}`),
    existing_recommendation: n.recommendation ?? null,
  };
}

export async function pendingEscalations() {
  return (await store.listDeals(300)).filter((d) => d.status === "awaiting_approval" && d.negotiation?.approval);
}

/** Store the agent's recommendation. It never decides by itself; a human approves it. */
export async function recordRecommendation(
  deal: Deal,
  rec: Omit<AgentRecommendation, "at" | "source"> & { source?: string },
) {
  const n = deal.negotiation;
  if (!n?.approval || deal.status !== "awaiting_approval") throw new HaggleError(`Deal ${deal.id} is ${deal.status}, not awaiting approval.`);
  const offer = n.approval.price;
  if (rec.decision === "counter") {
    if (!rec.price) throw new HaggleError("A counter recommendation needs a price.");
    rec.price = Math.round(rec.price);
    if (rec.price <= offer) throw new HaggleError(`Counter must be above the shopper's offer of ${offer}; recommend approve instead.`);
    if (rec.price > n.currentOffer) throw new HaggleError(`Counter must not exceed the agent's last offer of ${n.currentOffer}.`);
  }
  n.recommendation = {
    decision: rec.decision,
    price: rec.decision === "counter" ? rec.price : undefined,
    confidence: Math.max(0, Math.min(1, rec.confidence)),
    reasoning: rec.reasoning.slice(0, 1000),
    source: rec.source ?? "agenticorg",
    at: Date.now(),
  };
  // The agent replies minutes later; don't overwrite a human's decision made in the meantime.
  // ponytail: read-then-write, not atomic; use a Redis WATCH/version check if this ever races in practice.
  const latest = await store.getDeal(deal.id);
  if (latest?.status !== "awaiting_approval" || latest.negotiation?.approval?.requestedAt !== n.approval.requestedAt)
    throw new HaggleError(`Deal ${deal.id} was already decided; recommendation not recorded.`);
  await store.saveDeal(deal);
  await store.log({
    type: "agent_recommendation",
    actor: "agent",
    userId: deal.userId,
    dealId: deal.id,
    detail: `${n.recommendation.source} deal-desk agent recommends ${rec.decision}${rec.decision === "counter" ? ` at ${inr(rec.price!)}` : ` ${inr(offer)}`} (confidence ${Math.round(n.recommendation.confidence * 100)}%): ${n.recommendation.reasoning.slice(0, 200)}`,
  });
  return n.recommendation;
}

/** A human signs off on the agent's recommendation. */
export async function applyRecommendation(deal: Deal, decidedBy: string, role: "desk" | "seller") {
  const rec = deal.negotiation?.recommendation;
  if (!rec) throw new HaggleError("No agent recommendation to apply.");
  const by = `${decidedBy} (accepted agent recommendation)`;
  if (rec.decision === "counter") return counterFromApprover(deal, rec.price!, by, role);
  return decideApproval(deal, rec.decision === "approve" ? "approved" : "rejected", by, role);
}
