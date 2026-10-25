import { createHmac } from "node:crypto";
import { metaConfig } from "@/lib/meta/config";
import { store as kv } from "@/lib/store";

/**
 * Development stand-in for the Meta Graph calls GhostCart makes for WhatsApp (token exchange, WABA
 * subscription, number registration, sending) plus dev tools to simulate an incoming message and read
 * what was sent. Point META_GRAPH_BASE at <app>/api/mock-meta. Never available in production.
 */
const off = () => process.env.VERCEL_ENV === "production" || !process.env.META_GRAPH_BASE;
type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, ctx: Ctx) {
  if (off()) return new Response("Not found", { status: 404 });
  const [, ...rest] = (await ctx.params).path; // drop the version segment
  const path = rest.join("/");
  if ((await ctx.params).path[0] === "sent") return Response.json((await kv.kvGet<unknown[]>(`mockmeta:sent:${(await ctx.params).path[1]}`)) ?? []);
  if (path === "oauth/access_token") return Response.json({ access_token: "EAAmock-business-token", token_type: "bearer" });
  if (/^\d+$/.test(path)) return Response.json({ id: path, display_phone_number: "+91 90000 00999", verified_name: "ZZ Mock WhatsApp Store" });
  return Response.json({ error: { message: `mock-meta doesn't know GET ${path}` } }, { status: 404 });
}

export async function POST(request: Request, ctx: Ctx) {
  if (off()) return new Response("Not found", { status: 404 });
  const segments = (await ctx.params).path;
  if (segments[0] === "simulate" && segments[1] === "whatsapp") {
    const { phoneNumberId, from, text, name } = (await request.json()) as { phoneNumberId: string; from: string; text: string; name?: string };
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: "WABA", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: phoneNumberId }, contacts: [{ wa_id: from, profile: { name: name ?? "ZZ Shopper" } }], messages: [{ from, id: `wamid.${Date.now()}${Math.random()}`, type: "text", text: { body: text } }] } }] }],
    });
    const res = await fetch(`${metaConfig().appUrl}/api/meta/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": `sha256=${createHmac("sha256", metaConfig().appSecret).update(body).digest("hex")}` }, body });
    return Response.json({ delivered: res.status });
  }
  const path = segments.slice(1).join("/");
  if (/\/subscribed_apps$/.test(path) || /\/register$/.test(path)) return Response.json({ success: true });
  const send = path.match(/^(\d+)\/messages$/);
  if (send) {
    const payload = await request.json();
    const list = (await kv.kvGet<unknown[]>(`mockmeta:sent:${send[1]}`)) ?? [];
    await kv.kvSet(`mockmeta:sent:${send[1]}`, [...list, payload].slice(-200));
    return Response.json({ messaging_product: "whatsapp", messages: [{ id: `wamid.out.${Date.now()}` }] });
  }
  return Response.json({ error: { message: `mock-meta doesn't know POST ${path}` } }, { status: 404 });
}
