import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { candidateMoves } from "./moves";
import { POLICY_DEFAULTS, resolvePolicy, termsFromPolicy, validatePolicy, type DiscountPolicy } from "./policy";

const ctx = { sellerId: "s1", sellerName: "ZZ Store", category: "Electronics" };

describe("resolvePolicy", () => {
  it("lets a product beat its category, and the category beat the store, field by field", () => {
    const p = resolvePolicy({
      store: { maxDiscountPct: 10, autoApprovePct: 4, maxRounds: 3 },
      category: { maxDiscountPct: 15 },
      product: { autoApprovePct: 8, floorPrice: 900 },
    });
    expect(p).toMatchObject({ maxDiscountPct: 15, autoApprovePct: 8, maxRounds: 3, floorPrice: 900, expiryMinutes: POLICY_DEFAULTS.expiryMinutes });
    expect(p.source).toMatchObject({ maxDiscountPct: "category", autoApprovePct: "product", maxRounds: "store", expiryMinutes: "default" });
  });

  it("never lets an inherited agent-alone discount exceed a lower max discount", () => {
    const p = resolvePolicy({ store: { maxDiscountPct: 20, autoApprovePct: 12 }, product: { maxDiscountPct: 6 } });
    expect(p.autoApprovePct).toBe(6);
  });

  it("can switch haggling off for one product", () => {
    const p = resolvePolicy({ store: { maxDiscountPct: 10 }, product: { enabled: false } });
    expect(termsFromPolicy(p, 1000, ctx)).toBeNull();
  });
});

describe("termsFromPolicy", () => {
  it("turns percentages into rupee limits on the list price", () => {
    const t = termsFromPolicy(resolvePolicy({ store: { maxDiscountPct: 10, autoApprovePct: 5 } }), 20000, ctx)!;
    expect(t).toMatchObject({ fundedBy: "seller", benchmark: 20000, floor: 18000, autoLimit: 19000, opening: 19750, budget: 2000, benchmarkKind: "list" });
  });

  it("respects a product's absolute floor when it's above the percentage floor", () => {
    const t = termsFromPolicy(resolvePolicy({ store: { maxDiscountPct: 30, autoApprovePct: 10 }, product: { floorPrice: 850 } }), 1000, ctx)!;
    expect(t.floor).toBe(850);
    expect(t.autoLimit).toBe(900);
  });

  it("only haggles on the channels the seller picked", () => {
    const p = resolvePolicy({ store: { channels: ["widget", "shop"] } });
    expect(termsFromPolicy(p, 1000, { ...ctx, channel: "whatsapp" })).toBeNull();
    expect(termsFromPolicy(p, 1000, { ...ctx, channel: "shop" })).not.toBeNull();
  });

  it("uses the policy's round limit for the agent's last offer", () => {
    const t = termsFromPolicy(resolvePolicy({ store: { maxRounds: 2 } }), 10000, ctx)!;
    expect(candidateMoves({ currentOffer: 9900, rounds: 1 }, t, 5000)[0]).toEqual({ action: "final", price: t.autoLimit });
  });

  const policy = fc.record(
    {
      enabled: fc.constant(true),
      maxDiscountPct: fc.integer({ min: 0, max: 90 }),
      autoApprovePct: fc.integer({ min: 0, max: 90 }),
      floorPrice: fc.integer({ min: 1, max: 500_000 }),
      maxRounds: fc.integer({ min: 1, max: 10 }),
    },
    { requiredKeys: [] },
  ) as fc.Arbitrary<DiscountPolicy>;

  it("always keeps floor ≤ auto-approve ≤ opening ≤ list price, and no move goes below the floor", () => {
    fc.assert(
      fc.property(policy, policy, policy, fc.integer({ min: 1, max: 500_000 }), fc.integer({ min: 0, max: 10 }), fc.integer({ min: 1, max: 1_000_000 }), (s, c, p, price, rounds, offer) => {
        const { floorPrice: _ignored, ...store } = s;
        const { floorPrice: _alsoIgnored, ...category } = c;
        const t = termsFromPolicy(resolvePolicy({ store, category, product: p }), price, ctx)!;
        expect(t.floor).toBeGreaterThanOrEqual(1);
        expect(t.floor).toBeLessThanOrEqual(t.autoLimit);
        expect(t.autoLimit).toBeLessThanOrEqual(t.opening);
        expect(t.opening).toBeLessThanOrEqual(price);
        for (const move of candidateMoves({ currentOffer: t.opening, rounds }, t, offer)) {
          expect(move.price).toBeGreaterThanOrEqual(t.floor);
          if (move.action !== "escalate") expect(move.price).toBeGreaterThanOrEqual(t.autoLimit);
        }
      }),
    );
  });
});

describe("validatePolicy", () => {
  it("explains what's wrong in the seller's terms", () => {
    expect(validatePolicy({ maxDiscountPct: 5, autoApprovePct: 8 }, "store")).toContain("What the agent gives alone can't be more than your max discount.");
    expect(validatePolicy({ floorPrice: 500 }, "category")).toContain("A price floor can only be set on a product.");
    expect(validatePolicy({ maxDiscountPct: 95 }, "store")).toContain("Max discount must be between 0% and 90%.");
    expect(validatePolicy({ maxDiscountPct: 10, autoApprovePct: 5, floorPrice: 900 }, "product")).toEqual([]);
  });
});
