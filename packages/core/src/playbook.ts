/**
 * Seller playbook: suggestions from the seller's own haggles. Suggestions only (the seller decides),
 * and never beyond the maximum discount the seller already set.
 */
export interface HaggleOutcome {
  productId: string;
  title: string;
  /** List price, rupees. */
  list: number;
  /** The shopper's lowest offer, rupees. */
  bestShopperOffer: number;
  won: boolean;
  /** The product's rules when it happened, in % off list. */
  autoPct: number;
  maxPct: number;
}

export interface Suggestion {
  productId: string;
  title: string;
  haggles: number;
  lost: number;
  /** Lost haggles whose shopper offer was within the seller's own max discount. */
  closable: number;
  currentAutoPct: number;
  suggestedAutoPct: number;
}

const MIN_LOST = 3;

/**
 * For each product: haggles that ended without a sale although the shopper's offer was inside the
 * seller's own maximum (so only the agent's alone-limit, or a missed approval, stood in the way). When
 * there are enough, suggest the alone-limit that would have closed about two thirds of them.
 */
export function playbook(outcomes: HaggleOutcome[]): Suggestion[] {
  const by = new Map<string, HaggleOutcome[]>();
  for (const o of outcomes) by.set(o.productId, [...(by.get(o.productId) ?? []), o]);
  const out: Suggestion[] = [];
  for (const [productId, list] of by) {
    const lost = list.filter((o) => !o.won && o.list > 0 && o.bestShopperOffer > 0);
    const latest = list.at(-1)!;
    const gaps = lost.map((o) => (1 - o.bestShopperOffer / o.list) * 100).filter((g) => g > latest.autoPct && g <= latest.maxPct).sort((a, b) => a - b);
    if (lost.length < MIN_LOST || gaps.length < MIN_LOST) continue;
    const target = gaps[Math.ceil(gaps.length * (2 / 3)) - 1];
    const suggested = Math.min(latest.maxPct, Math.ceil(target));
    if (suggested <= latest.autoPct) continue;
    out.push({ productId, title: latest.title, haggles: list.length, lost: lost.length, closable: gaps.filter((g) => g <= suggested).length, currentAutoPct: latest.autoPct, suggestedAutoPct: suggested });
  }
  return out.sort((a, b) => b.closable - a.closable);
}
