import { signAwsRequest } from "./sigv4";

/**
 * Price comparison through official affiliate programmes only: compare and link out, never scrape,
 * never rebate the commission. Written from the Flipkart Affiliate API and Amazon PA-API 5.0 docs;
 * both need approved affiliate accounts. (Amazon is moving PA-API to its Creators API; the provider
 * interface is the seam for that switch.)
 */
export interface AffiliateOffer {
  source: "amazon" | "flipkart";
  title: string;
  price: number;
  mrp?: number;
  image?: string;
  url: string; // affiliate link
  inStock: boolean;
}

export interface AffiliateProvider {
  source: AffiliateOffer["source"];
  search(query: string): Promise<AffiliateOffer[]>;
  /** Look up the product behind a pasted link (ASIN / Flipkart pid), or null if it isn't theirs. */
  lookup(url: string): Promise<AffiliateOffer | null>;
}

/* ---------- Flipkart Affiliate API ---------- */

interface FkProduct {
  productBaseInfoV1?: {
    productId: string;
    title: string;
    productUrl: string;
    imageUrls?: Record<string, string>;
    flipkartSellingPrice?: { amount: number };
    flipkartSpecialPrice?: { amount: number };
    maximumRetailPrice?: { amount: number };
    inStock?: boolean;
  };
}

function flipkart(id: string, token: string): AffiliateProvider {
  const BASE = "https://affiliate-api.flipkart.net/affiliate/1.0";
  const call = async <T>(path: string) => {
    const res = await fetch(`${BASE}${path}`, { headers: { "Fk-Affiliate-Id": id, "Fk-Affiliate-Token": token }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Flipkart affiliate API ${res.status}`);
    return (await res.json()) as T;
  };
  const map = (p: FkProduct): AffiliateOffer | null => {
    const b = p.productBaseInfoV1;
    const price = b?.flipkartSpecialPrice?.amount ?? b?.flipkartSellingPrice?.amount;
    if (!b || !price) return null;
    return { source: "flipkart", title: b.title, price: Math.round(price), mrp: b.maximumRetailPrice?.amount, image: b.imageUrls?.["200x200"] ?? Object.values(b.imageUrls ?? {})[0], url: b.productUrl, inStock: b.inStock !== false };
  };
  return {
    source: "flipkart",
    async search(query) {
      const data = await call<{ products?: FkProduct[] }>(`/search.json?query=${encodeURIComponent(query)}&resultCount=6`);
      return (data.products ?? []).map(map).filter((o): o is AffiliateOffer => !!o);
    },
    async lookup(url) {
      const pid = new URL(url).searchParams.get("pid");
      if (!/flipkart\.com$/.test(new URL(url).hostname) || !pid) return null;
      return map(await call<FkProduct>(`/product.json?id=${encodeURIComponent(pid)}`));
    },
  };
}

/* ---------- Amazon Product Advertising API 5.0 ---------- */

interface PaItem {
  ASIN: string;
  DetailPageURL: string;
  ItemInfo?: { Title?: { DisplayValue: string } };
  Images?: { Primary?: { Medium?: { URL: string } } };
  Offers?: { Listings?: { Price?: { Amount: number }; SavingBasis?: { Amount: number }; Availability?: { Type?: string } }[] };
}

function amazon(accessKey: string, secretKey: string, partnerTag: string): AffiliateProvider {
  const host = "webservices.amazon.in";
  const resources = ["ItemInfo.Title", "Images.Primary.Medium", "Offers.Listings.Price", "Offers.Listings.SavingBasis", "Offers.Listings.Availability.Type"];
  const call = async <T>(op: "SearchItems" | "GetItems", payload: Record<string, unknown>) => {
    const path = `/paapi5/${op.toLowerCase()}`;
    const body = JSON.stringify({ ...payload, PartnerTag: partnerTag, PartnerType: "Associates", Marketplace: "www.amazon.in", Resources: resources });
    const headers = signAwsRequest({ host, path, region: "eu-west-1", service: "ProductAdvertisingAPI", target: `com.amazon.paapi5.v1.ProductAdvertisingAPIv1.${op}`, body, accessKey, secretKey });
    const res = await fetch(`https://${host}${path}`, { method: "POST", headers, body, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Amazon PA-API ${res.status}`);
    return (await res.json()) as T;
  };
  const map = (i: PaItem): AffiliateOffer | null => {
    const l = i.Offers?.Listings?.[0];
    if (!l?.Price?.Amount) return null;
    return { source: "amazon", title: i.ItemInfo?.Title?.DisplayValue ?? i.ASIN, price: Math.round(l.Price.Amount), mrp: l.SavingBasis?.Amount, image: i.Images?.Primary?.Medium?.URL, url: i.DetailPageURL, inStock: l.Availability?.Type !== "OutOfStock" };
  };
  return {
    source: "amazon",
    async search(query) {
      const data = await call<{ SearchResult?: { Items?: PaItem[] } }>("SearchItems", { Keywords: query, ItemCount: 6 });
      return (data.SearchResult?.Items ?? []).map(map).filter((o): o is AffiliateOffer => !!o);
    },
    async lookup(url) {
      const asin = url.match(/(?:\/dp\/|\/gp\/product\/|\/product\/)([A-Z0-9]{10})/)?.[1];
      if (!/amazon\.in$/.test(new URL(url).hostname) || !asin) return null;
      const data = await call<{ ItemsResult?: { Items?: PaItem[] } }>("GetItems", { ItemIds: [asin] });
      const item = data.ItemsResult?.Items?.[0];
      return item ? map(item) : null;
    },
  };
}

/* ---------- Development mock ---------- */

const sample = (source: AffiliateOffer["source"], q: string, base: number): AffiliateOffer => ({
  source,
  title: `${q.replace(/\b\w/g, (c) => c.toUpperCase())} (${source === "amazon" ? "Amazon" : "Flipkart"} sample)`,
  price: base,
  mrp: Math.round(base * 1.3),
  url: source === "amazon" ? `https://www.amazon.in/s?k=${encodeURIComponent(q)}&tag=zz-dev-21` : `https://www.flipkart.com/search?q=${encodeURIComponent(q)}&affid=zzdev`,
  inStock: true,
});

function mock(source: AffiliateOffer["source"]): AffiliateProvider {
  return {
    source,
    async search(q) {
      const base = 500 + ((q.length * 137) % 2000);
      return q.trim() ? [sample(source, q, source === "amazon" ? base : base + 49)] : [];
    },
    async lookup(url) {
      const host = new URL(url).hostname;
      if (source === "amazon" ? !/amazon\.in$/.test(host) : !/flipkart\.com$/.test(host)) return null;
      return sample(source, "pasted product", 1299);
    },
  };
}

export function affiliateProviders(): AffiliateProvider[] {
  const list: AffiliateProvider[] = [];
  if (process.env.AMAZON_PAAPI_ACCESS_KEY && process.env.AMAZON_PAAPI_SECRET_KEY && process.env.AMAZON_PARTNER_TAG)
    list.push(amazon(process.env.AMAZON_PAAPI_ACCESS_KEY, process.env.AMAZON_PAAPI_SECRET_KEY, process.env.AMAZON_PARTNER_TAG));
  if (process.env.FLIPKART_AFFILIATE_ID && process.env.FLIPKART_AFFILIATE_TOKEN) list.push(flipkart(process.env.FLIPKART_AFFILIATE_ID, process.env.FLIPKART_AFFILIATE_TOKEN));
  if (!list.length && process.env.VERCEL_ENV !== "production" && process.env.AFFILIATE_MOCK === "1") list.push(mock("amazon"), mock("flipkart"));
  return list;
}
