import type { DailyMetrics } from "../warehouse";
import { summarise } from "../warehouse";

/** What GST adds to GhostCart's fee (18%). */
const GST = 0.18;

/**
 * A seller's results for a period, in plain terms (money in rupees). "Sales" are haggles that ended in
 * an agreed price (paid on GhostCart or on the store's own checkout); "discounts" are what those
 * shoppers got off the list price, which is the seller's cost of selling this way. GhostCart fees here
 * are for orders paid on GhostCart; fees on store-checkout sales arrive on the monthly invoice.
 */
export function sellerResults(rows: DailyMetrics[]) {
  const s = summarise(rows);
  const r = (paise: number) => Math.round(paise / 100);
  const fees = r(s.fees * (1 + GST));
  const sales = r(s.agreedValue);
  return {
    haggles: s.negotiations,
    deals: s.agreed,
    agreeRate: s.agreeRate,
    /** Deals the agent closed on its own, without asking the seller. */
    closedByAgent: Math.max(0, s.agreed - s.humanApproved),
    cameToYou: s.escalated,
    listValue: r(s.listValue),
    sales,
    discounts: r(s.listValue - s.agreedValue),
    averageDiscount: s.averageDiscount,
    paidOnGhostCart: r(s.gmv),
    fees,
    refunds: r(s.refunds),
    /** Paid on GhostCart, less fees (with GST) and refunds: what reaches the seller's bank. */
    keptFromGhostCartOrders: r(s.gmv - s.refunds) - fees,
    disputes: s.disputes,
  };
}
export type SellerResults = ReturnType<typeof sellerResults>;
