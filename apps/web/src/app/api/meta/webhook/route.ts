import { handleIncomingChat } from "@/lib/chat/engine";
import { metaConfig, verifyMetaSignature } from "@/lib/meta/config";
import { handleInstagramWebhook, instagramSender, sendInstagramText } from "@/lib/meta/instagram";
import { handleWhatsAppWebhook, sendWhatsAppText, whatsappShopper } from "@/lib/meta/whatsapp";

/** Meta's webhook verification handshake. */
export function GET(request: Request) {
  const url = new URL(request.url);
  const ok = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === metaConfig().verifyToken && metaConfig().verifyToken;
  return ok ? new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 }) : new Response("forbidden", { status: 403 });
}

/** WhatsApp and Instagram messages for connected sellers. Verified by X-Hub-Signature-256. */
export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"))) return new Response("invalid signature", { status: 401 });
  const body = JSON.parse(raw || "{}");
  if (body.object === "whatsapp_business_account") {
    await handleWhatsAppWebhook(body, async (m) => {
      const shopper = await whatsappShopper(m.from, m.name);
      const send = (text: string) => sendWhatsAppText(m.phoneNumberId, m.token, m.from, text);
      if (!shopper) return send("Sorry, this shop can only chat with Indian mobile numbers for now.");
      await handleIncomingChat({ channel: "whatsapp", storeId: m.storeId, threadKey: `${m.phoneNumberId}:${m.from}`, userId: shopper.id, text: m.text }, send);
    });
  }
  if (body.object === "instagram") {
    await handleInstagramWebhook(body, async (m) => {
      const sender = await instagramSender(m.igUserId);
      if (!sender) return;
      const send = (text: string) => sendInstagramText(sender.pageId, sender.token, m.sender, text);
      // Instagram gives a scoped id, not a phone number; the deal link collects contact details at checkout.
      await handleIncomingChat({ channel: "instagram", storeId: m.storeId, threadKey: `${m.igUserId}:${m.sender}`, userId: `ig_${m.sender}`, text: m.text }, send);
    });
  }
  return new Response(null, { status: 200 }); // always 200 once verified, or Meta retries and then disables the webhook
}
