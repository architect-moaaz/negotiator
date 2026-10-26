import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { candidateMoves } from "./moves";
import { resolvePolicy } from "./policy";
import { allocateCartDiscount, applyRecovery, cartTerms, recoveryLineTerms, validateRecovery } from "./recovery";

const ctx = { sellerId: "s1", sellerName: "ZZ Store", category: "Audio" };
const policy = resolvePolicy({ store: { maxDiscountPct: 10, autoApprovePct: 5 } });

describe("validateRecovery", () => {
  it("accepts sane settings and rejects nonsense", () => {
    expect(validateRecovery({ enabled: true, maxDiscountPct: 12, autoApprovePct: 6, delayMinutes: 60, channels: ["email", "voice"] })).toEqual([]);
    expect(validateRecovery({ maxDiscountPct: 95 })).toHaveLength(1);
    expect(validateRecovery({ maxDiscountPct: 5, autoApprovePct: 8 })).toHaveLength(1);
    expect(validateRecovery({ delayMinutes: 5 })).toHaveLength(1);
    expect(validateRecovery({ channels: ["sms" as never] })).toHaveLength(1);
  });
});

describe("applyRecovery", () => {
  it("overrides the store percentages and never lets auto exceed max", () => {
    expect(applyRecovery(policy, { maxDiscountPct: 15, autoApprovePct: 8 })).toMatchObject({ maxDiscountPct: 15, autoApprovePct: 8 });
    expect(applyRecovery(policy, { maxDiscountPct: 3 })).toMatchObject({ maxDiscountPct: 3, autoApprovePct: 3 });
    expect(applyRecovery(policy, {})).toMatchObject({ maxDiscountPct: 10, autoApprovePct: 5 });
  });

  it("ignores the channel list (recovery is switched on by its own setting)", () => {
    const p = resolvePolicy({ store: { maxDiscountPct: 10, autoApprovePct: 5, channels: ["widget"] } });
    expect(recoveryLineTerms(p, {}, 1000, ctx)).not.toBeNull();
  });
});

describe("cartTerms", () => {
  it("sums each line's limits, times quantity", () => {
    const a = recoveryLineTerms(policy, {}, 20000, ctx)!; // floor 18000, auto 19000
    const b = recoveryLineTerms(policy, {}, 1000, ctx)!; // floor 900, auto 950
    const t = cartTerms([{ terms: a, quantity: 1 }, { terms: b, quantity: 2 }], { sellerId: "s1", sellerName: "ZZ Store" })!;
    expect(t).toMatchObject({ benchmark: 22000, floor: 19800, autoLimit: 20900, budget: 2200, category: "cart", benchmarkKind: "list", fundedBy: "seller" });
    expect(t.opening).toBe(22000 - Math.round((22000 - 20900) * 0.25));
  });

  it("refuses the cart if any line can't be haggled", () => {
    const fixed = recoveryLineTerms(resolvePolicy({ store: { enabled: false } }), {}, 500, ctx);
    const a = recoveryLineTerms(policy, {}, 1000, ctx);
    expect(cartTerms([{ terms: a!, quantity: 1 }, fixed && { terms: fixed, quantity: 1 }], { sellerId: "s1", sellerName: "x" })).toBeNull();
    expect(cartTerms([], { sellerId: "s1", sellerName: "x" })).toBeNull();
  });

  it("property: the cart floor is never below the sum of per-item floors, and every move stays at or above it", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ price: fc.integer({ min: 1, max: 200000 }), qty: fc.integer({ min: 1, max: 5 }) }), { minLength: 1, maxLength: 6 }),
        fc.integer({ min: 0, max: 90 }),
        fc.integer({ min: 0, max: 90 }),
        fc.integer({ min: 1, max: 500000 }),
        (items, maxPct, autoPct, offer) => {
          const rec = { maxDiscountPct: maxPct, autoApprovePct: Math.min(autoPct, maxPct) };
          const lines = items.map((i) => ({ terms: recoveryLineTerms(policy, rec, i.price, ctx)!, quantity: i.qty }));
          const t = cartTerms(lines, { sellerId: "s1", sellerName: "x" })!;
          const perItemFloor = lines.reduce((s, l) => s + l.terms.floor * l.quantity, 0);
          expect(t.floor).toBe(perItemFloor);
          expect(t.floor).toBeLessThanOrEqual(t.autoLimit);
          expect(t.autoLimit).toBeLessThanOrEqual(t.opening);
          for (const m of candidateMoves({ currentOffer: t.opening, rounds: 0 }, t, offer)) {
            if (m.action === "escalate") expect(m.price).toBeGreaterThanOrEqual(t.floor);
            else expect(m.price).toBeGreaterThanOrEqual(t.autoLimit);
          }
        },
      ),
    );
  });
});

describe("allocateCartDiscount", () => {
  it("splits the discount by list value and adds up exactly", () => {
    const lines = [{ unitPrice: 20000, quantity: 1 }, { unitPrice: 1000, quantity: 2 }];
    const shares = allocateCartDiscount(lines, 20901);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(22000 - 20901);
    expect(shares[0]).toBeGreaterThan(shares[1]);
  });

  it("property: shares are non-negative and sum to the discount", () => {
    fc.assert(
      fc.property(fc.array(fc.record({ unitPrice: fc.integer({ min: 1, max: 100000 }), quantity: fc.integer({ min: 1, max: 4 }) }), { minLength: 1, maxLength: 8 }), fc.float({ min: 0, max: 1, noNaN: true }), (lines, f) => {
        const list = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
        const agreed = Math.round(list * f);
        const shares = allocateCartDiscount(lines, agreed);
        expect(shares.every((x) => x >= 0)).toBe(true);
        expect(shares.reduce((a, b) => a + b, 0)).toBe(list - agreed);
      }),
    );
  });
});
