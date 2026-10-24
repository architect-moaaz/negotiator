import { after } from "next/server";
import { inr, runNegotiation } from "@/lib/negotiate";
import type { DealInput } from "@/lib/types";
import { normalizePhone, signUp } from "@/lib/users";
import { fetchTwilioMedia, sendWhatsApp, validateTwilioRequest } from "@/lib/whatsapp";

export const maxDuration = 60;

const twiml = (message?: string) =>
  new Response(`<Response>${message ? `<Message>${message}</Message>` : ""}</Response>`, {
    headers: { "Content-Type": "text/xml" },
  });

/** Twilio inbound WhatsApp: ack instantly, negotiate in the background, then reply with the deal link. */
export async function POST(request: Request) {
  const form = await request.formData();
  const params = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const publicUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/whatsapp`;
  if (!validateTwilioRequest(request.headers.get("x-twilio-signature"), publicUrl, params)) {
    return new Response("invalid signature", { status: 403 });
  }

  const from = params.From;
  const url = params.Body?.match(/https?:\/\/\S+/)?.[0];
  const mediaUrl = params.NumMedia && Number(params.NumMedia) > 0 ? params.MediaUrl0 : undefined;
  const mediaType = params.MediaContentType0;

  if (!url && !(mediaUrl && mediaType?.startsWith("image/"))) {
    return twiml("Send me any product link or a cart screenshot and I'll negotiate a 3-minute flash UPI deal ⚡");
  }

  after(async () => {
    try {
      const input: DealInput = url
        ? { kind: "url", url }
        : { kind: "screenshot", imageBase64: await fetchTwilioMedia(mediaUrl!), mediaType: mediaType! };
      const phone = normalizePhone(from.replace(/^whatsapp:/, ""));
      const user = phone ? await signUp({ name: params.ProfileName || "WhatsApp shopper", phone, channel: "whatsapp" }) : undefined;
      const deal = await runNegotiation(input, { channel: "whatsapp", waFrom: from, userId: user?.id });
      await sendWhatsApp(
        from,
        `⚡ ${deal.product.title}\nBest price anywhere ${inr(deal.negotiation?.terms.benchmark ?? deal.originalPrice)}. My opening offer: *${inr(deal.dealPrice)}*\nThink you can do better? Haggle with me:\n${process.env.NEXT_PUBLIC_APP_URL}/deal/${deal.id}`,
      );
    } catch (err) {
      console.error("WhatsApp negotiation failed", err);
      await sendWhatsApp(from, "Couldn't read that one 😅 Try another link or a clearer screenshot.");
    }
  });

  return twiml("⚡ Negotiating your deal… give me a few seconds.");
}
