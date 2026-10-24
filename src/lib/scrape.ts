import Firecrawl, { type ProductProfile } from "@mendable/firecrawl-js";
import { extractProductFromText } from "./agent";
import type { Product, SellerQuote } from "./types";

const firecrawl = process.env.FIRECRAWL_API_KEY ? new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY }) : null;

const IN_RETAILERS = [
  "amazon.in",
  "flipkart.com",
  "croma.com",
  "reliancedigital.in",
  "myntra.com",
  "ajio.com",
  "tatacliq.com",
  "nykaa.com",
];

export function sellerName(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const name = host.split(".")[0];
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return "Store";
  }
}

function fromProfile(profile: ProductProfile | undefined, url: string): Product | null {
  const variant = profile?.variants.find((v) => v.price?.amount);
  if (!profile || !variant?.price) return null;
  return {
    title: profile.title,
    brand: profile.brand,
    imageUrl: variant.images?.[0]?.url,
    sourceUrl: url,
    seller: sellerName(url),
    price: Math.round(variant.price.amount),
    mrp: variant.sale?.originalPrice.amount ? Math.round(variant.sale.originalPrice.amount) : undefined,
    inStock: variant.availability.inStock,
  };
}

/** Plain fetch fallback when Firecrawl isn't configured. Many retailers block this, so it's best-effort. */
async function fetchPageText(url: string) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36" },
    signal: AbortSignal.timeout(15000),
  });
  const html = await res.text();
  const meta = [...html.matchAll(/<meta[^>]+(?:property|name)="(og:[^"]+|product:[^"]+)"[^>]+content="([^"]*)"/g)]
    .map((m) => `${m[1]}: ${m[2]}`)
    .join("\n");
  const text = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  return `${meta}\n\n${text}`;
}

export async function scrapeProduct(url: string): Promise<Product> {
  if (firecrawl) {
    const doc = await firecrawl.scrape(url, {
      formats: ["product", "markdown"],
      onlyMainContent: true,
      location: { country: "IN" },
      timeout: 25000,
    });
    const product = fromProfile(doc.product, url);
    if (product) return product;
    return extractProductFromText(doc.markdown ?? "", url);
  }
  return extractProductFromText(await fetchPageText(url), url);
}

/** Look up the same product on other Indian retailers. Never throws; an empty list still lets the haggle run. */
export async function findAlternatives(query: string, excludeUrl?: string): Promise<SellerQuote[]> {
  if (!firecrawl) return [];
  const excludeHost = excludeUrl ? new URL(excludeUrl).hostname.replace(/^www\./, "") : "";
  try {
    const result = await firecrawl.search(query, {
      country: "IN",
      limit: 5,
      includeDomains: IN_RETAILERS.filter((d) => d !== excludeHost),
      timeout: 15000,
      scrapeOptions: { formats: ["product"], onlyMainContent: true, timeout: 12000 },
    });
    return (result.web ?? [])
      .map((r) => {
        const url = "url" in r && r.url ? r.url : (r as { metadata?: { sourceURL?: string } }).metadata?.sourceURL;
        const product = "product" in r ? fromProfile(r.product, url ?? "") : null;
        if (!url || !product) return null;
        return { seller: sellerName(url), url, price: product.price, inStock: product.inStock };
      })
      .filter((q): q is SellerQuote => !!q && q.price > 0)
      .slice(0, 4);
  } catch (err) {
    console.warn("findAlternatives failed", err);
    return [];
  }
}
