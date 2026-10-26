import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { assertBalanced, orderMoney, paidPostings, refundPostings, releasePostings, UnbalancedTransactionError } from "./money";

describe("order money", () => {
  it("splits a ₹9,200 order with a 2% fee and 18% GST on the fee", () => {
    expect(orderMoney({ priceInr: 9200, lockFeeInr: 9, feeBps: 200 })).toEqual({
      total: 920_000,
      fee: 18_400,
      gst: 3_312,
      sellerShare: 898_288,
      lockFee: 900,
      balance: 919_100,
    });
  });

  it("always adds up, and every posting set balances, for any price and fee", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_00_000 }), fc.integer({ min: 0, max: 99 }), fc.integer({ min: 0, max: 2000 }), (price, lock, bps) => {
        const m = orderMoney({ priceInr: price, lockFeeInr: lock, feeBps: bps });
        expect(m.fee + m.gst + m.sellerShare).toBe(m.total);
        expect(m.lockFee + m.balance).toBe(m.total);
        expect(m.sellerShare).toBeGreaterThanOrEqual(0);
        assertBalanced(paidPostings(m, "st"));
        assertBalanced(releasePostings(m, "st"));
        const refund = Math.max(1, Math.floor(m.total / 3));
        assertBalanced(refundPostings(m, "st", refund));
        assertBalanced(refundPostings(m, "st", m.total));
      }),
    );
  });

  it("refunds come out of the seller's held share first", () => {
    const m = orderMoney({ priceInr: 1000, lockFeeInr: 9, feeBps: 200 });
    const p = refundPostings(m, "st", 50_000);
    expect(p.find((x) => x.account === "seller:st:held")?.amount).toBe(50_000);
    expect(p.find((x) => x.account === "ghostcart:fee:held")?.amount).toBe(0);
  });

  it("refuses unbalanced or fractional postings", () => {
    expect(() => assertBalanced([{ account: "a", amount: 1 }])).toThrow(UnbalancedTransactionError);
    expect(() => assertBalanced([{ account: "a", amount: 0.5 }, { account: "b", amount: -0.5 }])).toThrow(UnbalancedTransactionError);
  });
});
