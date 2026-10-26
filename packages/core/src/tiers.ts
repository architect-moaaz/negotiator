/**
 * Seller tiers set how much risk GhostCart takes on a seller: the largest single order they can take
 * and how long their payout is held after delivery before it's released.
 */
export type SellerTier = "new" | "verified" | "trusted";

export interface TierLimits {
  /** Largest order value (deal price) in INR. */
  maxOrderValue: number;
  /** Days the seller's payout is held after confirmed delivery (the buyer's dispute window). */
  payoutHoldDays: number;
  /** Delivered orders and maximum dispute rate needed to move up to this tier. */
  promotion?: { deliveredOrders: number; maxDisputeRate: number; distinctBuyers: number };
}

export const TIER_LIMITS: Record<SellerTier, TierLimits> = {
  new: { maxOrderValue: 10_000, payoutHoldDays: 7 },
  verified: { maxOrderValue: 1_00_000, payoutHoldDays: 3, promotion: { deliveredOrders: 0, maxDisputeRate: 1, distinctBuyers: 0 } },
  trusted: { maxOrderValue: 5_00_000, payoutHoldDays: 1, promotion: { deliveredOrders: 50, maxDisputeRate: 0.02, distinctBuyers: 30 } },
};

/** Whether a seller's record earns the next tier. "verified" is granted by review, not by orders. */
export function earnsTrusted(stats: { delivered: number; disputes: number; distinctBuyers: number }) {
  const p = TIER_LIMITS.trusted.promotion!;
  return stats.delivered >= p.deliveredOrders && stats.distinctBuyers >= p.distinctBuyers && stats.disputes / Math.max(1, stats.delivered) <= p.maxDisputeRate;
}
