/** Razorpay webhook (payment_link.paid). */
export async function POST(request: Request) {
  const raw = await request.text();
  // TODO: verify X-Razorpay-Signature with RAZORPAY_WEBHOOK_SECRET, then
  // look up deal by payload.payment_link.entity.reference_id, mark paid, push ticker event.
  void raw;
  return Response.json({ ok: true });
}
