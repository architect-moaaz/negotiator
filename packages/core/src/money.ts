/**
 * Order money, in paise (integers only, never floats). The buyer pays the agreed price; GhostCart's
 * fee and 18% GST on that fee come out of it, and the rest is the seller's share. The buyer pays in
 * two parts: the small lock fee, then the balance.
 */
export interface OrderMoney {
  total: number;
  fee: number;
  gst: number;
  sellerShare: number;
  lockFee: number;
  balance: number;
}

export const toPaise = (inr: number) => Math.round(inr * 100);
export const fromPaise = (paise: number) => paise / 100;

/** feeBps: platform fee in basis points of the order value (200 = 2%). gstBps: GST on the fee (1800 = 18%). */
export function orderMoney({ priceInr, lockFeeInr, feeBps, gstBps = 1800 }: { priceInr: number; lockFeeInr: number; feeBps: number; gstBps?: number }): OrderMoney {
  const total = toPaise(priceInr);
  const lockFee = Math.min(total, toPaise(lockFeeInr));
  const fee = Math.round((total * feeBps) / 10_000);
  const gst = Math.round((fee * gstBps) / 10_000);
  return { total, fee, gst, sellerShare: total - fee - gst, lockFee, balance: total - lockFee };
}

/** A posting: debits positive, credits negative. Every transaction's postings sum to zero. */
export interface Posting {
  account: string;
  amount: number;
}

export class UnbalancedTransactionError extends Error {}

export function assertBalanced(postings: Posting[]) {
  const sum = postings.reduce((s, p) => s + p.amount, 0);
  if (sum !== 0 || postings.some((p) => !Number.isInteger(p.amount))) throw new UnbalancedTransactionError(`postings sum to ${sum}`);
  return postings;
}

/** Ledger accounts. Seller money is per store; GhostCart's fee and GST are held with the seller's share until release. */
export const accounts = {
  gateway: "gateway:receivable",
  sellerHeld: (storeId: string) => `seller:${storeId}:held`,
  sellerPayable: (storeId: string) => `seller:${storeId}:payable`,
  feeHeld: "ghostcart:fee:held",
  fee: "ghostcart:fee",
  gstHeld: "ghostcart:gst:held",
  gst: "ghostcart:gst",
};

/** Buyer paid in full: the money is receivable from the gateway and owed, on hold, to seller and GhostCart. */
export const paidPostings = (m: OrderMoney, storeId: string): Posting[] =>
  assertBalanced([
    { account: accounts.gateway, amount: m.total },
    { account: accounts.sellerHeld(storeId), amount: -m.sellerShare },
    { account: accounts.feeHeld, amount: -m.fee },
    { account: accounts.gstHeld, amount: -m.gst },
  ]);

/** What's still held for an order: the full split at first, less any partial refunds. */
export type Held = Pick<OrderMoney, "sellerShare" | "fee" | "gst">;

/** Hold released after delivery and the dispute window: the seller's share becomes payable, the fee earned. */
export const releasePostings = (m: Held, storeId: string): Posting[] =>
  assertBalanced([
    { account: accounts.sellerHeld(storeId), amount: m.sellerShare },
    { account: accounts.sellerPayable(storeId), amount: -m.sellerShare },
    { account: accounts.feeHeld, amount: m.fee },
    { account: accounts.fee, amount: -m.fee },
    { account: accounts.gstHeld, amount: m.gst },
    { account: accounts.gst, amount: -m.gst },
  ]);

/**
 * Refund while the money is still held (seller never shipped, or a dispute upheld). A partial refund
 * comes out of the seller's share first, then GhostCart's fee and GST in proportion.
 */
export function refundPostings(m: Held, storeId: string, amount: number): Posting[] {
  const held = m.sellerShare + m.fee + m.gst;
  if (!(Number.isInteger(amount) && amount > 0 && amount <= held)) throw new UnbalancedTransactionError("refund must be between 1 paisa and what's still held");
  const fromSeller = Math.min(amount, m.sellerShare);
  const rest = amount - fromSeller;
  const fromFee = m.fee + m.gst > 0 ? Math.round((rest * m.fee) / (m.fee + m.gst)) : 0;
  const fromGst = rest - fromFee;
  return assertBalanced([
    { account: accounts.sellerHeld(storeId), amount: fromSeller },
    { account: accounts.feeHeld, amount: fromFee },
    { account: accounts.gstHeld, amount: fromGst },
    // Paid back to the buyer through the gateway, so less is receivable from it.
    { account: accounts.gateway, amount: -amount },
  ]);
}
