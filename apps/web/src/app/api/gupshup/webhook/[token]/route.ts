import { handleIncomingChat } from "@/lib/chat/engine";
import { gupshupByToken, readGupshupInbound, sendGupshupText } from "@/lib/gupshup/gupshup";
import { whatsappShopper } from "@/lib/meta/whatsapp";

/** Gupshup's inbound message callback for one seller (the secret token identifies the connection). */
export async function POST(request: Request, ctx: RouteContext<"/api/gupshup/webhook/[token]">) {
  const conn = await gupshupByToken((await ctx.params).token);
  if (!conn?.storeId) return new Response("not found", { status: 404 });
  const msg = await readGupshupInbound(await request.json().catch(() => ({})));
  if (msg) {
    const send = (text: string) => sendGupshupText(conn.externalId, msg.from, text);
    const shopper = await whatsappShopper(msg.from, msg.name);
    if (!shopper) await send("Sorry, this shop can only chat with Indian mobile numbers for now.");
    else await handleIncomingChat({ channel: "whatsapp", storeId: conn.storeId, threadKey: `gs:${conn.externalId}:${msg.from}`, userId: shopper.id, text: msg.text }, send);
  }
  return new Response(null, { status: 200 }); // Gupshup expects a 2xx quickly, or it retries
}
