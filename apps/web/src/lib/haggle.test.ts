import { describe, expect, it } from "vitest";
import { candidateMoves, commissionFor, computeTerms, MAX_ROUNDS } from "./haggle";
import type { Product } from "./types";

const headphones: Product = { title: "Sony WH-1000XM5 Headphones", brand: "Sony", seller: "Amazon", price: 20990, mrp: 34990, inStock: true };

describe("computeTerms", () => {
  it("budgets from the category commission on the cheapest in-stock price", () => {
    const { terms, bestSeller, originalPrice } = computeTerms(headphones, [
      { seller: "Flipkart", url: "https://flipkart.com/x", price: 19989, inStock: true },
      { seller: "Croma", url: "https://croma.com/x", price: 18000, inStock: false },
    ]);
    expect(bestSeller).toBe("Flipkart");
    expect(originalPrice).toBe(34990);
    expect(terms.category).toBe("accessories");
    expect(terms.budget).toBe(999); // 5% of 19,989
    expect(terms.floor).toBe(18990);
    expect(terms.autoLimit).toBe(19390);
    expect(terms.opening).toBe(19739);
    expect(terms.floor).toBeLessThan(terms.autoLimit);
    expect(terms.autoLimit).toBeLessThan(terms.opening);
  });

  it("classifies categories, accessories before phones", () => {
    expect(commissionFor({ ...headphones, title: "iPhone 15 silicone case" })[1]).toBe("accessories");
    expect(commissionFor({ ...headphones, title: "Apple iPhone 15 128GB" })[1]).toBe("phones & computers");
    expect(commissionFor({ ...headphones, title: "Nike Air Force 1 sneakers" })[1]).toBe("fashion");
    expect(commissionFor({ ...headphones, title: "Mystery item" })[1]).toBe("general");
  });
});

describe("candidateMoves", () => {
  const { terms } = computeTerms(headphones, [{ seller: "Flipkart", url: "u", price: 19989, inStock: true }]);
  const start = { currentOffer: terms.opening, rounds: 0 };

  it("accepts at our own offer when the shopper meets or beats it", () => {
    expect(candidateMoves(start, terms, 20500)).toEqual([{ action: "accept", price: terms.opening }]);
  });

  it("concedes part of the gap on a reasonable counter", () => {
    const [move] = candidateMoves(start, terms, 19400);
    expect(move.action).toBe("counter");
    expect(move.price).toBeLessThan(terms.opening);
    expect(move.price).toBeGreaterThan(terms.autoLimit);
  });

  it("escalates below the auto-approve limit only after some haggling", () => {
    expect(candidateMoves(start, terms, 19100)[0].action).toBe("counter");
    expect(candidateMoves({ currentOffer: 19500, rounds: 2 }, terms, 19100)).toEqual([{ action: "escalate", price: 19100 }]);
  });

  it("never offers below the auto-approve limit, never accepts below the floor", () => {
    for (let rounds = 0; rounds <= MAX_ROUNDS; rounds++) {
      for (const offer of [100, 15000, terms.floor - 1, terms.floor, terms.autoLimit - 1, terms.autoLimit, 19500, 19700, 25000]) {
        for (const currentOffer of [terms.opening, 19500, terms.autoLimit]) {
          for (const move of candidateMoves({ currentOffer, rounds }, terms, offer)) {
            if (move.action === "escalate") expect(move.price).toBeGreaterThanOrEqual(terms.floor);
            else expect(move.price).toBeGreaterThanOrEqual(terms.autoLimit);
            expect(move.price).toBeLessThanOrEqual(currentOffer);
          }
        }
      }
    }
  });

  it("holds firm on lowballs once it has nothing left to give", () => {
    expect(candidateMoves({ currentOffer: terms.autoLimit, rounds: 3 }, terms, 10000)).toEqual([{ action: "hold", price: terms.autoLimit }]);
  });

  it("on the last round, takes any offer above the limit and answers lowballs with a final offer", () => {
    expect(candidateMoves({ currentOffer: 19600, rounds: MAX_ROUNDS - 1 }, terms, 19395)[0]).toEqual({ action: "accept", price: 19395 });
    expect(candidateMoves({ currentOffer: 19600, rounds: MAX_ROUNDS - 1 }, terms, 15000)[0]).toEqual({ action: "final", price: terms.autoLimit });
  });
});
