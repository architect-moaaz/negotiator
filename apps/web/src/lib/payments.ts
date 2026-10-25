import QRCode from "qrcode";
import { createUpiOrder, pinelabsConfigured } from "./pinelabs";
import { pinelabsMockConfigured, pinelabsMockEnabled } from "./pinelabs-mock";

export const LOCK_FEE_INR = Number(process.env.DEAL_LOCK_FEE_INR ?? 9);

/** Payments go through the test gateway: no money moves, and the deal page says so. */
export const testPayments = pinelabsMockEnabled;
/** A gateway we can confirm payments with: real Pine Labs, or the test gateway where it's allowed. */
export const paymentsAvailable = pinelabsConfigured && (!pinelabsMockConfigured || pinelabsMockEnabled);

/** No payment could be created. Callers turn this into a shopper-facing message; nothing is charged. */
export class PaymentsUnavailableError extends Error {}

/** Create a Pine Labs UPI payment. Never falls back to an unverifiable QR: if we can't confirm it, we don't ask for it. */
async function createUpiPayment({ dealId, reference, amountInr, note }: { dealId: string; reference: string; amountInr: number; note: string }) {
  if (!paymentsAvailable) throw new PaymentsUnavailableError("payments are not configured for this deployment");
  try {
    const { orderId, upiIntent } = await createUpiOrder({ reference, amountInr, note, returnTo: `/deal/${dealId}` });
    return { pinelabsOrderId: orderId, upiIntent, qrDataUrl: await QRCode.toDataURL(upiIntent, { margin: 1 }) };
  } catch (err) {
    console.error("Pine Labs order failed", err);
    throw new PaymentsUnavailableError("the payment gateway didn't accept the order");
  }
}

/** The small UPI payment that locks a deal's price. */
export function createDealPayment({ dealId, title }: { dealId: string; title: string }) {
  return createUpiPayment({ dealId, reference: dealId, amountInr: LOCK_FEE_INR, note: `GhostCart deal lock: ${title}` });
}

/** Suffix on the Pine Labs merchant reference for the balance payment, so webhooks can tell it apart. */
export const BALANCE_REF_SUFFIX = "-order";

/** The balance payment that turns a locked deal into an order. */
export function createBalancePayment({ dealId, title, amountInr }: { dealId: string; title: string; amountInr: number }) {
  return createUpiPayment({ dealId, reference: `${dealId}${BALANCE_REF_SUFFIX}`, amountInr, note: `GhostCart order: ${title}` });
}
