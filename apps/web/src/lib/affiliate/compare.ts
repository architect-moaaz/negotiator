import { store as kv } from "../store";
import { affiliateProviders, type AffiliateOffer } from "./providers";

/** Amazon allows showing PA-API prices for up to 24 hours; we refresh far sooner. */
const CACHE_S = 60 * 60;

export interface Comparison {
  offers: AffiliateOffer[];
  checkedAt: number;
  /** The product behind a pasted marketplace link, when the query was one. */
  pasted?: AffiliateOffer;
}

export const isMarketplaceLink = (q: string) => /^https?:\/\/(www\.)?(amazon\.in|flipkart\.com)\//i.test(q.trim());

/** Offers from every configured affiliate programme, cached briefly. Failures drop that source, never the page. */
export async function compare(query: string): Promise<Comparison | null> {
  const providers = affiliateProviders();
  const q = query.trim().slice(0, 300);
  if (!providers.length || !q) return null;
  const key = `affiliate:${q.toLowerCase()}`;
  const cached = await kv.kvGet<Comparison>(key);
  if (cached && Date.now() - cached.checkedAt < CACHE_S * 1000) return cached;

  let pasted: AffiliateOffer | undefined;
  let searchFor = q;
  if (isMarketplaceLink(q)) {
    for (const p of providers) {
      pasted = (await p.lookup(q).catch(() => null)) ?? undefined;
      if (pasted) break;
    }
    if (!pasted) return { offers: [], checkedAt: Date.now() };
    searchFor = pasted.title.split(/[,(|]/)[0].split(/\s+/).slice(0, 6).join(" ");
  }
  const results = await Promise.all(providers.map((p) => p.search(searchFor).catch((err) => (console.warn(`${p.source} affiliate search failed`, err), [] as AffiliateOffer[]))));
  const offers = results
    .map((r) => r.filter((o) => o.inStock).sort((a, b) => a.price - b.price)[0])
    .filter((o): o is AffiliateOffer => !!o)
    .sort((a, b) => a.price - b.price);
  const result: Comparison = { offers, checkedAt: Date.now(), pasted };
  await kv.kvSet(key, result, CACHE_S);
  return result;
}
