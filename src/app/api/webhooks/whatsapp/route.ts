import { sendWhatsApp } from "@/lib/whatsapp";

/** Twilio inbound WhatsApp webhook (form-encoded). */
export async function POST(request: Request) {
  const form = await request.formData();
  const from = String(form.get("From") ?? "");
  const body = String(form.get("Body") ?? "");
  const url = body.match(/https?:\/\/\S+/)?.[0];

  if (!url) {
    await sendWhatsApp(from, "Send me any product link and I'll find you a 3-minute flash UPI deal ⚡");
  } else {
    const res = await fetch(new URL("/api/deal", request.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, channel: "whatsapp" }),
    });
    const deal = await res.json();
    await sendWhatsApp(
      from,
      res.ok
        ? `⚡ ${deal.product.title}\n₹${deal.originalPrice} → ₹${deal.dealPrice} + ${deal.perk}\nPay within 180s: ${process.env.NEXT_PUBLIC_APP_URL}/deal/${deal.id}`
        : "Couldn't read that link — try another one?",
    );
  }

  // TODO: verify X-Twilio-Signature
  return new Response("<Response/>", { headers: { "Content-Type": "text/xml" } });
}
