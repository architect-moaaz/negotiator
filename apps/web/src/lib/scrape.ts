import Firecrawl, { type ProductProfile } from "@mendable/firecrawl-js";
import { extractProductFromText } from "./agent";
import type { ListingSeller, Product, SellerQuote } from "./types";

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
    const labels = new URL(url).hostname.split(".");
    // Registrable name: tatacliq from luxury.tatacliq.com, amazon from amazon.co.in.
    const name = labels.length > 2 && /^(co|com|net|org)$/.test(labels[labels.length - 2]) ? labels[labels.length - 3] : labels[labels.length - 2] ?? labels[0];
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

/** Stores like Amazon answer automated reads with an error page (503 "Service Unavailable", robot check). */
export function isBlockedPage(doc: { metadata?: { statusCode?: number; title?: string }; product?: { title?: string } }) {
  const status = doc.metadata?.statusCode ?? 200;
  const title = `${doc.product?.title ?? ""} ${doc.metadata?.title ?? ""}`;
  return status >= 400 || /\b503\b|service unavailable|robot check|captcha|access denied/i.test(title);
}

export async function scrapeProduct(url: string): Promise<Product> {
  if (firecrawl) {
    const doc = await firecrawl.scrape(url, {
      formats: ["product", "markdown"],
      onlyMainContent: true,
      location: { country: "IN", languages: ["en-IN", "en"] },
      timeout: 25000,
    });
    // Don't try to get around it: tell the shopper and steer them to a screenshot.
    if (isBlockedPage(doc)) throw new Error(`Store blocked automated reading (HTTP ${doc.metadata?.statusCode ?? "?"})`);
    const soldBy = extractListingSeller(doc.markdown ?? "", url);
    const product = fromProfile(doc.product, url) ?? (await extractProductFromText(doc.markdown ?? "", url));
    return { ...product, soldBy };
  }
  const text = await fetchPageText(url);
  return { ...(await extractProductFromText(text, url)), soldBy: extractListingSeller(text, url) };
}

/** Read the merchant behind a listing ("Sold by …" on Amazon, "Seller: …" on Flipkart) from page markdown. */
export function extractListingSeller(markdown: string, url: string): ListingSeller | undefined {
  const marketplace = sellerName(url);
  const amazon = markdown.match(/Sold by\s*\n*\s*\[([^\]\n]{2,80})\]\(([^)\s]*)/i);
  if (amazon) {
    const id = amazon[2].match(/[?&]seller=([A-Z0-9]+)/)?.[1];
    if (!/^amazon(\.in)?$/i.test(amazon[1].trim()) || id) return { name: amazon[1].trim(), marketplace, marketplaceSellerId: id };
  }
  const flipkart = markdown.match(/Seller:\s*([^\n\]]{2,80})\n(?:[\s\S]{0,160}?\n(\d(?:\.\d)?)\n)?/);
  if (flipkart) return { name: flipkart[1].trim(), marketplace, rating: flipkart[2] ? Number(flipkart[2]) : undefined };
  const generic = markdown.match(/(?:Sold by|Seller)\s*[:\-]?\s*\n*\s*\[?([A-Za-z0-9][^\]\n(]{1,79})/);
  if (generic && !/^(account|central|hub|support|become)/i.test(generic[1].trim())) return { name: generic[1].trim(), marketplace };
  return undefined;
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
      location: "India",
      timeout: 25000,
      scrapeOptions: { formats: ["product"], onlyMainContent: true, timeout: 12000, location: { country: "IN", languages: ["en-IN", "en"] } },
    });
    return (result.web ?? [])
      .map((r): SellerQuote | null => {
        const url = "url" in r && r.url ? r.url : (r as { metadata?: { sourceURL?: string } }).metadata?.sourceURL;
        const product = "product" in r ? fromProfile(r.product, url ?? "") : null;
        if (!url || !product) return null;
        return { seller: sellerName(url), title: product.title, url, price: product.price, inStock: product.inStock };
      })
      .filter((q): q is SellerQuote => !!q && q.price > 0);
  } catch (err) {
    console.warn("findAlternatives failed", err);
    return [];
  }
}

/** Product name from a retailer URL slug (e.g. amazon.in/Sony-WH-1000XM5-Wireless/dp/…), so search can start before the scrape finishes. */
export function queryFromUrl(url: string) {
  try {
    const slug = new URL(url).pathname
      .split("/")
      .filter((seg) => seg.includes("-"))
      .sort((a, b) => b.length - a.length)[0];
    const words = (slug ?? "")
      .split("-")
      .filter((w) => w && !/^\d{5,}$/.test(w) && !/^(buy|online|p|dp|itm\w+)$/i.test(w))
      .slice(0, 8);
    return words.length >= 3 ? decodeURIComponent(words.join(" ")) : null;
  } catch {
    return null;
  }
}

/** Model-number-like tokens ("wh1000xm5", "128gb", "airforce1"…) that must match for two listings to be the same product. */
function modelTokens(title: string) {
  return new Set(
    title
      .toLowerCase()
      .replace(/(\w)[-\s](?=\d)/g, "$1") // "wh-1000xm5" / "iphone 15" -> "wh1000xm5" / "iphone15"
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && /\d/.test(t) && /[a-z]/.test(t)),
  );
}

/**
 * Keep only listings that are plausibly the same product: matching model tokens and a price within
 * a sane band of the source. One quote per seller (the cheapest), at most four.
 */
export function sameProductQuotes(product: Product, quotes: SellerQuote[]) {
  const wanted = modelTokens(`${product.brand ?? ""} ${product.title}`);
  const bySeller = new Map<string, SellerQuote>();
  for (const q of quotes) {
    if (q.price < product.price * 0.75 || q.price > product.price * 1.6) continue;
    if (wanted.size && q.title) {
      const have = modelTokens(q.title);
      if (![...wanted].some((t) => have.has(t))) continue;
    }
    if (q.seller === product.seller && q.price >= product.price) continue;
    const prev = bySeller.get(q.seller);
    if (!prev || q.price < prev.price) bySeller.set(q.seller, q);
  }
  return [...bySeller.values()].sort((a, b) => a.price - b.price).slice(0, 4);
}
