import QRCode from "qrcode";
import { createUpiOrder, pinelabsConfigured } from "./pinelabs";

export const LOCK_FEE_INR = Number(process.env.DEAL_LOCK_FEE_INR ?? 9);
export const simulateEnabled = process.env.DEMO_SIMULATE === "1" || !pinelabsConfigured;

/** Create a UPI payment for a deal. Pine Labs when configured, otherwise a static-VPA QR. */
async function createUpiPayment({ dealId, reference, amountInr, note }: { dealId: string; reference: string; amountInr: number; note: string }) {
  if (pinelabsConfigured) {
    try {
      const { orderId, upiIntent } = await createUpiOrder({ reference, amountInr, note, returnTo: `/deal/${dealId}` });
      return { pinelabsOrderId: orderId, upiIntent, qrDataUrl: await QRCode.toDataURL(upiIntent, { margin: 1 }) };
    } catch (err) {
      // Keep the demo alive if the gateway hiccups; the simulate button covers payment.
      console.error("Pine Labs order failed", err);
    }
  }

  if (!process.env.UPI_FALLBACK_VPA) return {};
  const upiIntent = `upi://pay?pa=${encodeURIComponent(process.env.UPI_FALLBACK_VPA)}&pn=GhostCart&am=${amountInr}&tn=${encodeURIComponent(`Deal ${reference}`)}&cu=INR`;
  return { upiIntent, qrDataUrl: await QRCode.toDataURL(upiIntent, { margin: 1 }) };
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
