import { termsFromPolicy, type ResolvedPolicy } from "./policy";
import type { NegotiationTerms } from "./types";

/**
 * GhostCart Privilege: how a seller wants abandoned carts turned into private haggles. Store level only.
 * Percentages override the store's normal discount rules for recovery haggles; unset means "use them".
 */
export interface RecoverySettings {
  enabled: boolean;
  /** Most the seller will take off a recovered cart, as % of its list value. */
  maxDiscountPct?: number;
  /** How much of that the agent may give without asking, as % of list value. */
  autoApprovePct?: number;
  /** Minutes after the last cart activity before it counts as abandoned. */
  delayMinutes: number;
  /** How a private invite may reach the shopper (each still needs their consent). */
  channels: RecoveryChannel[];
  /** Show the "make an offer on your cart" prompt when a shopper is leaving the cart page. */
  exitPrompt: boolean;
}

export type RecoveryChannel = "email" | "whatsapp" | "voice";

export const RECOVERY_DEFAULTS: RecoverySettings = {
  enabled: false,
  delayMinutes: 60,
  channels: ["email"],
  exitPrompt: true,
};

const CHANNELS: RecoveryChannel[] = ["email", "whatsapp", "voice"];

/** Problems with recovery settings as entered; an empty list means they can be saved. */
export function validateRecovery(r: Partial<RecoverySettings>): string[] {
  const errors: string[] = [];
  const pct = (v: number | undefined, name: string) => {
    if (v !== undefined && !(Number.isFinite(v) && v >= 0 && v <= 90)) errors.push(`${name} must be between 0% and 90%.`);
  };
  pct(r.maxDiscountPct, "Recovery max discount");
  pct(r.autoApprovePct, "Recovery agent-alone discount");
  if (r.maxDiscountPct !== undefined && r.autoApprovePct !== undefined && r.autoApprovePct > r.maxDiscountPct)
    errors.push("What the agent gives alone can't be more than your recovery max discount.");
  if (r.delayMinutes !== undefined && !(Number.isInteger(r.delayMinutes) && r.delayMinutes >= 15 && r.delayMinutes <= 7 * 24 * 60))
    errors.push("Wait between 15 minutes and 7 days before calling a cart abandoned.");
  if (r.channels && r.channels.some((c) => !CHANNELS.includes(c))) errors.push("Unknown invite channel.");
  return errors;
}

/** The store's resolved policy with the recovery percentages applied (never letting auto exceed max). */
export function applyRecovery(policy: ResolvedPolicy, recovery: Pick<RecoverySettings, "maxDiscountPct" | "autoApprovePct">): ResolvedPolicy {
  const maxDiscountPct = recovery.maxDiscountPct ?? policy.maxDiscountPct;
  const autoApprovePct = Math.min(recovery.autoApprovePct ?? policy.autoApprovePct, maxDiscountPct);
  return { ...policy, maxDiscountPct, autoApprovePct };
}

export interface CartLineTerms {
  /** Limits for one unit, from termsFromPolicy. */
  terms: NegotiationTerms;
  quantity: number;
}

/**
 * Limits for a whole cart negotiated as one bundle: each line keeps its own rules (a floor never
 * crosses products), and the cart's list, floor and agent-alone limit are the sums. Returns null when
 * any line can't be haggled, so the cart is offered only when every item's seller rules allow it.
 */
export function cartTerms(lines: (CartLineTerms | null)[], ctx: { sellerId: string; sellerName: string }): NegotiationTerms | null {
  if (!lines.length || lines.some((l) => !l || !(l.quantity >= 1))) return null;
  const ok = lines as CartLineTerms[];
  const sum = (pick: (t: NegotiationTerms) => number) => ok.reduce((s, l) => s + pick(l.terms) * l.quantity, 0);
  const benchmark = sum((t) => t.benchmark);
  const floor = sum((t) => t.floor);
  const autoLimit = sum((t) => t.autoLimit);
  const opening = benchmark - Math.round((benchmark - autoLimit) * 0.25);
  const rounds = ok.map((l) => l.terms.maxRounds).filter((r): r is number => r !== undefined);
  return {
    fundedBy: "seller",
    sellerId: ctx.sellerId,
    sellerName: ctx.sellerName,
    category: ok.length === 1 ? ok[0].terms.category : "cart",
    commissionRate: 0,
    benchmark,
    budget: benchmark - floor,
    floor,
    autoLimit,
    opening,
    maxRounds: rounds.length ? Math.min(...rounds) : undefined,
    benchmarkKind: "list",
  };
}

/** Per-unit terms for one cart line under recovery rules (null when haggling is off for it). */
export function recoveryLineTerms(
  policy: ResolvedPolicy,
  recovery: Pick<RecoverySettings, "maxDiscountPct" | "autoApprovePct">,
  unitPrice: number,
  ctx: { sellerId: string; sellerName: string; category: string },
): NegotiationTerms | null {
  // Gated by RecoverySettings.enabled rather than the policy's channel list.
  return termsFromPolicy(applyRecovery(policy, recovery), unitPrice, ctx);
}

/**
 * Split an agreed cart price across its lines in proportion to each line's list value, so per-line
 * discounts add up exactly to the cart discount (rounding goes to the most expensive line).
 */
export function allocateCartDiscount(lines: { unitPrice: number; quantity: number }[], agreedTotal: number): number[] {
  const list = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const discount = Math.max(0, list - agreedTotal);
  const shares = lines.map((l) => Math.floor((discount * l.unitPrice * l.quantity) / (list || 1)));
  const rest = discount - shares.reduce((a, b) => a + b, 0);
  if (rest && lines.length) {
    const biggest = lines.reduce((bi, l, i) => (l.unitPrice * l.quantity > lines[bi].unitPrice * lines[bi].quantity ? i : bi), 0);
    shares[biggest] += rest;
  }
  return shares;
}
