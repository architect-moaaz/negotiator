import { describe, expect, it } from "vitest";
import { queryFromUrl } from "./scrape";

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
