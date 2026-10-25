import type { NegotiationTerms } from "./types";

/**
 * Seller discount rules. A store sets defaults, a category can override some of them, and a product
 * can override again; each field resolves from the most specific level that sets it.
 */
export type PolicyScope = "store" | "category" | "product";

export interface DiscountPolicy {
  /** False turns haggling off (fixed price) at this level. */
  enabled?: boolean;
  /** Most the seller will ever take off, as % of the list price. */
  maxDiscountPct?: number;
  /** How much of that the agent may give without asking, as % of the list price. */
  autoApprovePct?: number;
  /** Absolute lowest price in INR. Product level only: a price floor means nothing across products. */
  floorPrice?: number;
  maxRounds?: number;
  /** Minutes a negotiation stays open before it expires. */
  expiryMinutes?: number;
  bundlesAllowed?: boolean;
  /** Channels where the agent may haggle; unset means all. */
  channels?: string[];
}

export type PolicyField = keyof DiscountPolicy;
export type ResolvedPolicy = Required<Omit<DiscountPolicy, "floorPrice" | "channels">> &
  Pick<DiscountPolicy, "floorPrice" | "channels"> & {
    /** Which level each value came from, so the editor can say "from Electronics". */
    source: Record<PolicyField, PolicyScope | "default">;
  };

export const POLICY_DEFAULTS: Required<Omit<DiscountPolicy, "floorPrice" | "channels">> = {
  enabled: true,
  maxDiscountPct: 10,
  autoApprovePct: 5,
  maxRounds: 4,
  expiryMinutes: 15,
  bundlesAllowed: false,
};

const FIELDS: PolicyField[] = ["enabled", "maxDiscountPct", "autoApprovePct", "floorPrice", "maxRounds", "expiryMinutes", "bundlesAllowed", "channels"];

/** Cascade store → category → product. Unset fields fall through to the next level, then to defaults. */
export function resolvePolicy(levels: Partial<Record<PolicyScope, DiscountPolicy | undefined>>): ResolvedPolicy {
  const order: PolicyScope[] = ["product", "category", "store"];
  const out: Record<string, unknown> = {};
  const source = {} as ResolvedPolicy["source"];
  for (const field of FIELDS) {
    const level = order.find((scope) => levels[scope]?.[field] !== undefined);
    if (level) {
      out[field] = levels[level]![field];
      source[field] = level;
    } else {
      out[field] = (POLICY_DEFAULTS as Record<string, unknown>)[field];
      source[field] = "default";
    }
  }
  const resolved = { ...out, source } as ResolvedPolicy;
  // A category or product can lower the discount below an inherited auto-approve share; never let the agent exceed it.
  resolved.autoApprovePct = Math.min(resolved.autoApprovePct, resolved.maxDiscountPct);
  return resolved;
}

/** Problems with a policy as entered at a given level; an empty list means it can be saved. */
export function validatePolicy(p: DiscountPolicy, scope: PolicyScope): string[] {
  const errors: string[] = [];
  const pct = (v: number | undefined, name: string) => {
    if (v !== undefined && !(Number.isFinite(v) && v >= 0 && v <= 90)) errors.push(`${name} must be between 0% and 90%.`);
  };
  pct(p.maxDiscountPct, "Max discount");
  pct(p.autoApprovePct, "Agent-alone discount");
  if (p.maxDiscountPct !== undefined && p.autoApprovePct !== undefined && p.autoApprovePct > p.maxDiscountPct)
    errors.push("What the agent gives alone can't be more than your max discount.");
  if (p.floorPrice !== undefined && scope !== "product") errors.push("A price floor can only be set on a product.");
  if (p.floorPrice !== undefined && !(Number.isInteger(p.floorPrice) && p.floorPrice >= 1)) errors.push("Price floor must be a whole number of rupees.");
  if (p.maxRounds !== undefined && !(Number.isInteger(p.maxRounds) && p.maxRounds >= 1 && p.maxRounds <= 10)) errors.push("Rounds must be between 1 and 10.");
  if (p.expiryMinutes !== undefined && !(Number.isInteger(p.expiryMinutes) && p.expiryMinutes >= 5 && p.expiryMinutes <= 24 * 60))
    errors.push("Expiry must be between 5 minutes and 24 hours.");
  return errors;
}

/**
 * Negotiation limits for a seller's own product. The list price is the benchmark; the seller's margin
 * funds every rupee. Returns null when haggling is off for this product or channel.
 */
export function termsFromPolicy(
  policy: ResolvedPolicy,
  listPrice: number,
  ctx: { sellerId: string; sellerName: string; category: string; channel?: string },
): NegotiationTerms | null {
  if (!policy.enabled || !(listPrice >= 1)) return null;
  if (ctx.channel && policy.channels?.length && !policy.channels.includes(ctx.channel)) return null;
  const byPct = (pct: number) => Math.round(listPrice * (1 - pct / 100));
  const floor = Math.min(listPrice, Math.max(1, byPct(policy.maxDiscountPct), policy.floorPrice ?? 0));
  const autoLimit = Math.min(listPrice, Math.max(floor, byPct(policy.autoApprovePct)));
  const opening = listPrice - Math.round((listPrice - autoLimit) * 0.25);
  return {
    fundedBy: "seller",
    sellerId: ctx.sellerId,
    sellerName: ctx.sellerName,
    category: ctx.category,
    commissionRate: 0,
    benchmark: listPrice,
    budget: listPrice - floor,
    floor,
    autoLimit,
    opening,
    maxRounds: policy.maxRounds,
  };
}
