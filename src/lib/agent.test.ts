import { describe, expect, it } from "vitest";
import { computeOffer } from "./agent";
import type { Product } from "./types";

const product: Product = { title: "Air Force 1", seller: "Myntra", price: 5500, mrp: 7500, inStock: true };

describe("computeOffer", () => {
  it("caps the discount", () => {
    const offer = computeOffer(product, []);
    expect(offer.dealPrice).toBe(5300);
    expect(offer.originalPrice).toBe(7500);
    expect(offer.saved).toBe(2200);
  });

  it("benchmarks against the cheapest in-stock seller", () => {
    const offer = computeOffer(product, [
      { seller: "Ajio", url: "https://ajio.com/x", price: 4400, inStock: true },
      { seller: "Flipkart", url: "https://flipkart.com/x", price: 3000, inStock: false },
    ]);
    expect(offer.bestSeller).toBe("Ajio");
    expect(offer.dealPrice).toBe(4200);
  });

  it("uses a percentage discount on cheap items and never goes below ₹1", () => {
    expect(computeOffer({ ...product, price: 300, mrp: undefined }, []).dealPrice).toBe(285);
    expect(computeOffer({ ...product, price: 1, mrp: undefined }, []).dealPrice).toBe(1);
  });
});
