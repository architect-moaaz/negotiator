import { describe, expect, it } from "vitest";
import { DEMO_URL } from "./format";
import { queryFromUrl, scrapeProduct } from "./scrape";

describe("queryFromUrl", () => {
  it("reads product names from Amazon and Flipkart slugs", () => {
    expect(queryFromUrl("https://www.amazon.in/Sony-WH-1000XM5-Wireless-Cancelling-Headphones/dp/B09XS7JWHH")).toBe(
      "Sony WH 1000XM5 Wireless Cancelling Headphones",
    );
    expect(queryFromUrl("https://www.flipkart.com/apple-iphone-15-black-128-gb/p/itm6ac6485515ae4")).toBe("apple iphone 15 black 128 gb");
  });

  it("returns null when the URL has no descriptive slug", () => {
    expect(queryFromUrl("https://www.amazon.in/dp/B09XS7JWHH")).toBeNull();
    expect(queryFromUrl("not a url")).toBeNull();
  });
});

describe("sellerName", () => {
  it("uses the registrable domain", async () => {
    const { sellerName } = await import("./scrape");
    expect(sellerName("https://luxury.tatacliq.com/x")).toBe("Tatacliq");
    expect(sellerName("https://www.amazon.in/x")).toBe("Amazon");
    expect(sellerName("https://www.amazon.co.in/x")).toBe("Amazon");
  });
});

describe("sameProductQuotes", () => {
  it("drops other models, implausible prices and duplicate sellers", async () => {
    const { sameProductQuotes } = await import("./scrape");
    const product = { title: "SONY WH-1000XM5 Wireless Noise Cancellation", brand: "Sony", seller: "Flipkart", price: 19989, inStock: true };
    const q = (seller: string, title: string, price: number) => ({ seller, title, price, url: `https://${seller}.in/${price}`, inStock: true });
    const kept = sameProductQuotes(product, [
      q("Amazon", "Sony WH-1000XM5 Headphones", 19989),
      q("Amazon", "Sony WH1000XM5 Black", 19490),
      q("Amazon", "Sony WH-1000XM4 Headphones", 13989), // older model
      q("Croma", "Sony WH-1000XM5 (Renewed)", 9999), // implausibly cheap
      q("Tatacliq", "Sony WH-1000XM5", 22990),
    ]);
    expect(kept.map((k) => [k.seller, k.price])).toEqual([
      ["Amazon", 19490],
      ["Tatacliq", 22990],
    ]);
  });
});

describe("extractListingSeller", () => {
  it("reads Amazon's Sold by block with the merchant id", async () => {
    const { extractListingSeller } = await import("./scrape");
    const md =
      "Ships from\n\nAmazon\n\nSold by\n\n[Clicktech Retail Private Ltd](https://www.amazon.in/gp/help/seller/at-a-glance.html/ref=dp_merchant_link?ie=UTF8&seller=AJ6SIZC8YQDZX&asin=B09XS7JWHH)";
    expect(extractListingSeller(md, "https://www.amazon.in/dp/B09XS7JWHH")).toEqual({
      name: "Clicktech Retail Private Ltd",
      marketplace: "Amazon",
      marketplaceSellerId: "AJ6SIZC8YQDZX",
    });
  });

  it("reads Flipkart's Seller line with rating", async () => {
    const { extractListingSeller } = await import("./scrape");
    const md = "Delivery by\n\nTuesday, 27 Oct\n\nSeller: SVPeripherals\n\n[See other sellers](https://www.flipkart.com/sellers?pid=X)\n\n4.5\n\n•\n\n3 years with Flipkart";
    expect(extractListingSeller(md, "https://www.flipkart.com/x/p/itm1")).toEqual({ name: "SVPeripherals", marketplace: "Flipkart", rating: 4.5 });
  });

  it("ignores pages without a seller", async () => {
    const { extractListingSeller } = await import("./scrape");
    expect(extractListingSeller("[Become a Seller](https://seller.flipkart.com)", "https://www.flipkart.com/x")).toBeUndefined();
  });
});

describe("demo listing", () => {
  it("serves the demo product without scraping", async () => {
    const p = await scrapeProduct(DEMO_URL);
    expect(p.price).toBeGreaterThan(0);
    expect(p.sourceUrl).toBe(DEMO_URL);
  });
});
