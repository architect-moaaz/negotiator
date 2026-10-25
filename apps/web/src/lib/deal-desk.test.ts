import { describe, expect, it } from "vitest";
import { applyRecommendation, dealBrief, recordRecommendation } from "./deal-desk";
import { computeTerms } from "./haggle";
import { store } from "./store";
import type { Deal, Product } from "./types";

const product: Product = { title: "Sony WH-1000XM5 Headphones", seller: "Amazon", price: 19989, inStock: true };

async function escalatedDeal(id: string): Promise<Deal> {
  const { terms, bestSeller, originalPrice } = computeTerms(product, []);
  const deal: Deal = {
    id,
    product,
    alternatives: [],
    originalPrice,
    dealPrice: 19495,
    saved: 494,
    perk: "Free instant shipping",
    bestSeller,
    haggle: "",
    negotiation: { terms, currentOffer: 19495, rounds: 2, messages: [], approval: { price: 19200, requestedAt: Date.now() } },
    lockFee: 9,
    testPayments: true,
    createdAt: Date.now(),
    expiresAt: Date.now() + 600_000,
    status: "awaiting_approval",
    channel: "web",
  };
  await store.saveDeal(deal, true);
  return deal;
}

describe("deal desk", () => {
  it("briefs the agent with margin context", async () => {
    const brief = dealBrief(await escalatedDeal("brief1"));
    expect(brief.shopper_offer).toBe(19200);
    expect(brief.floor_price).toBe(18990);
    expect(brief.margin_left_at_shopper_offer).toBe(210);
  });

  it("rejects counters outside the shopper offer and the agent's last offer", async () => {
    const deal = await escalatedDeal("rec1");
    await expect(recordRecommendation(deal, { decision: "counter", price: 19100, confidence: 0.8, reasoning: "too low for us" })).rejects.toThrow(/above the shopper/);
    await expect(recordRecommendation(deal, { decision: "counter", price: 19600, confidence: 0.8, reasoning: "too high for us" })).rejects.toThrow(/not exceed/);
    const rec = await recordRecommendation(deal, { decision: "counter", price: 19350, confidence: 0.7, reasoning: "Thin margin; meet in the middle." });
    expect(rec.price).toBe(19350);
  });

  it("only acts when a human applies the recommendation", async () => {
    const deal = await escalatedDeal("rec2");
    await recordRecommendation(deal, { decision: "approve", confidence: 0.9, reasoning: "Within budget and the shopper haggled hard." });
    expect(deal.status).toBe("awaiting_approval");
    const done = await applyRecommendation(deal, "Moaaz", "desk");
    expect(done.status).toBe("pending");
    expect(done.dealPrice).toBe(19200);
  });

  it("doesn't overwrite a decision a human made while the agent was thinking", async () => {
    const deal = await escalatedDeal("rec3");
    await store.saveDeal({ ...structuredClone(deal), status: "pending" });
    await expect(recordRecommendation(deal, { decision: "approve", confidence: 0.9, reasoning: "Within budget, approve it." })).rejects.toThrow(/already decided/);
    expect((await store.getDeal("rec3"))?.status).toBe("pending");
  });
});
