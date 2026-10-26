import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AffiliateCompare } from "./affiliate-compare";

describe("AffiliateCompare", () => {
  it("discloses the commission and the price timestamp, links as sponsored, and never offers cashback", () => {
    const html = renderToStaticMarkup(
      <AffiliateCompare comparison={{ checkedAt: Date.UTC(2026, 9, 26, 4, 30), offers: [{ source: "amazon", title: "ZZ Kettle", price: 879, url: "https://www.amazon.in/dp/B000ZZ0001?tag=zz-21", inStock: true }] }} />,
    );
    expect(html).toContain("GhostCart may earn a commission if you buy through these links.");
    expect(html).toContain("Prices and availability from Amazon and Flipkart as of 26 Oct 2026");
    expect(html).toContain('rel="sponsored noopener"');
    expect(html).not.toMatch(/cashback|cash back|reward|rebate/i);
  });
});
