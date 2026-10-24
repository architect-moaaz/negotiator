import QRCode from "qrcode";
import { createUpiOrder, pinelabsConfigured } from "./pinelabs";

export const LOCK_FEE_INR = Number(process.env.DEAL_LOCK_FEE_INR ?? 9);
export const simulateEnabled = process.env.DEMO_SIMULATE === "1" || !pinelabsConfigured;

/** Create the UPI payment that locks a deal. Pine Labs when configured, otherwise a static-VPA QR. */
export async function createDealPayment({ dealId, title }: { dealId: string; title: string }) {
  if (pinelabsConfigured) {
    try {
      const { orderId, upiIntent } = await createUpiOrder({
        reference: dealId,
        amountInr: LOCK_FEE_INR,
        note: `GhostCart deal lock: ${title}`,
      });
      return { pinelabsOrderId: orderId, upiIntent, qrDataUrl: await QRCode.toDataURL(upiIntent, { margin: 1 }) };
    } catch (err) {
      // Keep the demo alive if the gateway hiccups; the simulate button covers payment.
      console.error("Pine Labs order failed", err);
    }
  }

  if (!process.env.UPI_FALLBACK_VPA) return {};
  const upiIntent = `upi://pay?pa=${encodeURIComponent(process.env.UPI_FALLBACK_VPA)}&pn=GhostCart&am=${LOCK_FEE_INR}&tn=${encodeURIComponent(`Deal ${dealId}`)}&cu=INR`;
  return { upiIntent, qrDataUrl: await QRCode.toDataURL(upiIntent, { margin: 1 }) };
}
