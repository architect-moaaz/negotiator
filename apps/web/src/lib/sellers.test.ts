import { describe, expect, it } from "vitest";
import { computeTerms } from "@ghostcart/agent";
import { normalizeSellerName } from "./sellers";
import type { Product, Seller } from "./types";

describe("normalizeSellerName", () => {
  it("matches marketplace legal names to what sellers type", () => {
    expect(normalizeSellerName("Clicktech Retail Private Ltd")).toBe(normalizeSellerName("clicktech retail"));
    expect(normalizeSellerName("SVPeripherals")).toBe("svperipherals");
    expect(normalizeSellerName("Appario Retail Pvt. Ltd.")).toBe("apparioretail");
  });
});

describe("seller-funded terms", () => {
  const product: Product = { title: "Sony WH-1000XM5 Headphones", seller: "Flipkart", price: 20000, inStock: true };
  const seller: Seller = {
    id: "s1",
    storeName: "SV Peripherals",
    aliases: ["svperipherals"],
    contactName: "A",
    phone: "+919000000000",
    budgetPct: 0.1,
    autoApproveShare: 0.5,
    createdAt: 0,
  };

  it("uses the seller's budget and auto-approve share instead of GhostCart's commission", () => {
    const { terms } = computeTerms(product, [], seller);
    expect(terms.fundedBy).toBe("seller");
    expect(terms.sellerName).toBe("SV Peripherals");
    expect(terms.budget).toBe(2000);
    expect(terms.floor).toBe(18000);
    expect(terms.autoLimit).toBe(19000);
    expect(terms.opening).toBe(19500);
  });

  it("falls back to GhostCart's commission when the seller isn't registered", () => {
    const { terms } = computeTerms(product, []);
    expect(terms.fundedBy).toBe("ghostcart");
    expect(terms.budget).toBe(1000); // 5% accessories
  });
});
