import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { candidateMoves, MAX_ROUNDS } from "./moves";
import { computeTerms } from "./terms";

const product = fc.record({
  title: fc.constantFrom("Sony WH-1000XM5 Headphones", "Apple iPhone 15", "Nike sneakers", "Mystery item", "LG washing machine"),
  seller: fc.constant("Amazon"),
  price: fc.integer({ min: 50, max: 300_000 }),
  inStock: fc.constant(true),
});
const seller = fc.option(
  fc.record({
    id: fc.constant("s1"),
    storeName: fc.constant("ZZ Test Store"),
    budgetPct: fc.double({ min: 0.01, max: 0.3, noNaN: true }),
    autoApproveShare: fc.double({ min: 0.1, max: 1, noNaN: true }),
  }),
  { nil: undefined },
);

describe("negotiation invariants", () => {
  it("terms are ordered floor <= autoLimit <= opening <= benchmark", () => {
    fc.assert(
      fc.property(product, seller, (p, s) => {
        const { terms } = computeTerms(p, [], s);
        expect(terms.floor).toBeGreaterThanOrEqual(1);
        expect(terms.floor).toBeLessThanOrEqual(terms.autoLimit);
        expect(terms.autoLimit).toBeLessThanOrEqual(terms.opening);
        expect(terms.opening).toBeLessThanOrEqual(terms.benchmark);
      }),
    );
  });

  it("no move goes below the floor, and only an escalation goes below the auto-approve limit", () => {
    fc.assert(
      fc.property(product, seller, fc.integer({ min: 0, max: MAX_ROUNDS }), fc.double({ min: 0, max: 1, noNaN: true }), fc.integer({ min: 1, max: 600_000 }), (p, s, rounds, pos, offer) => {
        const { terms } = computeTerms(p, [], s);
        // The agent's standing offer is always somewhere between its auto-approve limit and its opening.
        const currentOffer = Math.round(terms.autoLimit + (terms.opening - terms.autoLimit) * pos);
        for (const move of candidateMoves({ currentOffer, rounds }, terms, offer)) {
          expect(move.price).toBeGreaterThanOrEqual(terms.floor);
          expect(move.price).toBeLessThanOrEqual(currentOffer);
          if (move.action !== "escalate") expect(move.price).toBeGreaterThanOrEqual(terms.autoLimit);
          if (move.action === "accept") expect(move.price).toBeLessThanOrEqual(Math.max(offer, currentOffer));
        }
      }),
    );
  });
});
