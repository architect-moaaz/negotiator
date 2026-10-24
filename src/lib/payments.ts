import Razorpay from "razorpay";
import QRCode from "qrcode";

const razorpay =
  process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
    ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
    : null;

/** Create a payment link that expires with the deal. Falls back to a static UPI QR for demos. */
export async function createDealPayment(opts: {
  dealId: string;
  amountInr: number;
  description: string;
  expiresAt: number;
}) {
  if (razorpay) {
    const link = await razorpay.paymentLink.create({
      amount: Math.round(opts.amountInr * 100),
      currency: "INR",
      upi_link: true,
      customer: {},
      description: opts.description,
      reference_id: opts.dealId,
      // Razorpay requires expiry ≥ 15 min out; the 180s countdown is enforced app-side.
      expire_by: Math.floor(Math.max(opts.expiresAt, Date.now() + 16 * 60_000) / 1000),
      callback_url: `${process.env.NEXT_PUBLIC_APP_URL}/deal/${opts.dealId}`,
      callback_method: "get",
    });
    return { paymentUrl: link.short_url, upiQrDataUrl: await QRCode.toDataURL(link.short_url) };
  }

  const upi = `upi://pay?pa=${process.env.UPI_FALLBACK_VPA}&pn=GhostCart&am=${opts.amountInr}&tn=${encodeURIComponent(opts.dealId)}&cu=INR`;
  return { paymentUrl: upi, upiQrDataUrl: await QRCode.toDataURL(upi) };
}
