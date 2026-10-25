import type { NegotiationTerms, Product, SellerQuote, SellerTerms } from "./types";

/**
 * Estimated affiliate commission GhostCart earns per category. The seller agent can give
 * away up to this much; it's the real money behind every concession. First match wins.
 */
const COMMISSION: [RegExp, number, string][] = [
  [/headphone|earbud|earphone|charger|cable|\bcase\b|cover|power ?bank|speaker|mouse|keyboard|smartwatch|accessor/i, 0.05, "accessories"],
  [/shoe|sneaker|shirt|t-shirt|jeans|dress|kurta|jacket|hoodie|apparel|fashion|\bwatch\b|handbag|backpack|wallet|sunglass/i, 0.08, "fashion"],
  [/lipstick|serum|moisturi[sz]er|cream|beauty|skincare|perfume|shampoo|makeup/i, 0.07, "beauty"],
  [/swiggy|zomato|blinkit|zepto|pizza|burger|biryani|grocery|snack/i, 0.05, "food & grocery"],
  [/kitchen|cookware|decor|furniture|mattress|bedsheet|home/i, 0.05, "home"],
  [/\bbook\b|novel|paperback|hardcover/i, 0.04, "books"],
  [/refrigerator|fridge|washing machine|air conditioner|television|\btv\b|microwave|appliance/i, 0.03, "appliances"],
  [/iphone|smartphone|mobile|laptop|macbook|tablet|ipad|camera|console|playstation/i, 0.025, "phones & computers"],
];
const DEFAULT_RATE: [number, string] = [0.04, "general"];
/** Cap on what GhostCart funds from its own commission on a single deal. */
export const DEFAULT_MAX_BUDGET = 1000;

export function commissionFor(product: Product): [number, string] {
  const text = `${product.title} ${product.brand ?? ""} ${product.seller}`;
  const hit = COMMISSION.find(([re]) => re.test(text));
  return hit ? [hit[1], hit[2]] : DEFAULT_RATE;
}

/**
 * Negotiation limits. If the listing's seller is on GhostCart, their own margin funds the discount
 * and their auto-approve share applies; otherwise GhostCart's estimated commission does.
 */
export function computeTerms(product: Product, quotes: SellerQuote[], seller?: SellerTerms, { maxBudget = DEFAULT_MAX_BUDGET } = {}) {
  const candidates = [{ seller: product.seller, price: product.price }, ...quotes.filter((q) => q.inStock)];
  const best = candidates.reduce((a, b) => (b.price < a.price ? b : a));
  const [commissionRate, category] = commissionFor(product);
  const benchmark = best.price;
  const budget = seller
    ? Math.max(1, Math.round(benchmark * seller.budgetPct))
    : Math.max(1, Math.min(maxBudget, Math.round(benchmark * commissionRate)));
  const autoShare = seller?.autoApproveShare ?? 0.6;
  const terms: NegotiationTerms = {
    fundedBy: seller ? "seller" : "ghostcart",
    sellerId: seller?.id,
    sellerName: seller?.storeName,
    category,
    commissionRate,
    benchmark,
    budget,
    floor: Math.max(1, benchmark - budget),
    autoLimit: Math.max(1, benchmark - Math.round(budget * autoShare)),
    opening: Math.max(1, benchmark - Math.round(budget * Math.min(0.25, autoShare / 2))),
  };
  return { terms, bestSeller: best.seller, originalPrice: Math.max(product.mrp ?? 0, product.price) };
}
