import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveSigningKey, signAwsRequest } from "./sigv4";

const env = { ...process.env };
const realFetch = globalThis.fetch;
afterEach(() => {
  process.env = { ...env };
  globalThis.fetch = realFetch;
  vi.resetModules();
});

describe("AWS SigV4", () => {
  it("derives the signing key exactly as AWS's published example", () => {
    // From the AWS docs "Examples of how to derive a signing key".
    const key = deriveSigningKey("wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", "20120215", "us-east-1", "iam");
    expect(key.toString("hex")).toBe("f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d");
  });

  it("signs PA-API requests with the scope and headers Amazon expects", () => {
    const h = signAwsRequest({ host: "webservices.amazon.in", path: "/paapi5/searchitems", region: "eu-west-1", service: "ProductAdvertisingAPI", target: "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems", body: "{}", accessKey: "AKIDEXAMPLE", secretKey: "secret", now: new Date("2026-10-26T10:00:00Z") });
    expect(h["x-amz-date"]).toBe("20261026T100000Z");
    expect(h.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261026\/eu-west-1\/ProductAdvertisingAPI\/aws4_request, SignedHeaders=content-encoding;content-type;host;x-amz-date;x-amz-target, Signature=[0-9a-f]{64}$/);
  });
});

describe("affiliate providers", () => {
  beforeEach(() => {
    process.env.FLIPKART_AFFILIATE_ID = "zzaff";
    process.env.FLIPKART_AFFILIATE_TOKEN = "zztok";
    process.env.AMAZON_PAAPI_ACCESS_KEY = "AKIDZZ";
    process.env.AMAZON_PAAPI_SECRET_KEY = "zzsecret";
    process.env.AMAZON_PARTNER_TAG = "zz-21";
  });

  it("read Flipkart and Amazon responses into comparable offers", async () => {
    const seen: { url: string; headers: Headers }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, headers: new Headers(init?.headers) });
      if (url.includes("affiliate-api.flipkart.net"))
        return Response.json({ products: [{ productBaseInfoV1: { productId: "P1", title: "ZZ Kettle", productUrl: "https://dl.flipkart.com/x?affid=zzaff", imageUrls: { "200x200": "https://img/x.jpg" }, flipkartSellingPrice: { amount: 899 }, flipkartSpecialPrice: { amount: 849 }, maximumRetailPrice: { amount: 1299 }, inStock: true } }] });
      if (url.includes("webservices.amazon.in"))
        return Response.json({ SearchResult: { Items: [{ ASIN: "B000ZZ0001", DetailPageURL: "https://www.amazon.in/dp/B000ZZ0001?tag=zz-21", ItemInfo: { Title: { DisplayValue: "ZZ Kettle 1.5L" } }, Offers: { Listings: [{ Price: { Amount: 879 }, SavingBasis: { Amount: 1299 } }] } }] } });
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    const { affiliateProviders } = await import("./providers");
    const [amazon, flipkart] = affiliateProviders();
    expect(await flipkart.search("kettle")).toEqual([{ source: "flipkart", title: "ZZ Kettle", price: 849, mrp: 1299, image: "https://img/x.jpg", url: "https://dl.flipkart.com/x?affid=zzaff", inStock: true }]);
    expect((await amazon.search("kettle"))[0]).toMatchObject({ source: "amazon", price: 879, url: "https://www.amazon.in/dp/B000ZZ0001?tag=zz-21" });
    expect(seen.find((s) => s.url.includes("flipkart"))!.headers.get("Fk-Affiliate-Id")).toBe("zzaff");
    expect(seen.find((s) => s.url.includes("amazon"))!.headers.get("x-amz-target")).toBe("com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems");
  });
});

describe("comparison", () => {
  it("returns the cheapest in-stock offer per source, and looks up pasted links without scraping", async () => {
    for (const k of ["FLIPKART_AFFILIATE_ID", "FLIPKART_AFFILIATE_TOKEN", "AMAZON_PAAPI_ACCESS_KEY", "AMAZON_PAAPI_SECRET_KEY", "AMAZON_PARTNER_TAG"]) delete process.env[k];
    process.env.AFFILIATE_MOCK = "1";
    const { compare, isMarketplaceLink } = await import("./compare");
    const result = (await compare(`zz steel bottle ${Date.now()}`))!;
    expect(result.offers.map((o) => o.source).sort()).toEqual(["amazon", "flipkart"]);
    expect(result.offers[0].price).toBeLessThanOrEqual(result.offers[1].price);
    expect(isMarketplaceLink("https://www.amazon.in/dp/B09XS7JWHH")).toBe(true);
    expect(isMarketplaceLink("https://evil.example/amazon.in/")).toBe(false);
    const pasted = (await compare(`https://www.amazon.in/dp/B0${Date.now() % 100000000}`))!;
    expect(pasted.pasted).toMatchObject({ source: "amazon", price: 1299 });
  });

  it("is off when no affiliate programme is configured", async () => {
    for (const k of ["FLIPKART_AFFILIATE_ID", "AMAZON_PAAPI_ACCESS_KEY", "AFFILIATE_MOCK"]) delete process.env[k];
    const { compare } = await import("./compare");
    expect(await compare("kettle")).toBeNull();
  });
});
