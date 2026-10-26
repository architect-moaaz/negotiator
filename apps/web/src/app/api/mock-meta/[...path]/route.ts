import { createHmac } from "node:crypto";
import { metaConfig } from "@ghostcart/channels";
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
  if (path === "dialog/oauth") {
    // Facebook Login: the seller "approves" instantly and is sent back with a code.
    const url = new URL(request.url);
    const back = new URL(url.searchParams.get("redirect_uri")!);
    back.searchParams.set("code", `mockfb_${Date.now()}`);
    back.searchParams.set("state", url.searchParams.get("state") ?? "");
    return Response.redirect(back, 302);
  }
  if (path === "oauth/access_token") return Response.json({ access_token: "EAAmock-business-token", token_type: "bearer" });
  if (path === "me/accounts")
    return Response.json({ data: [{ id: "3099000000001", name: "ZZ Mock Page", access_token: "EAAmock-page-token", instagram_business_account: { id: "17841400000000001", username: "zz_mock_store" } }] });
  if (/^\d+$/.test(path)) return Response.json({ id: path, display_phone_number: "+91 90000 00999", verified_name: "ZZ Mock WhatsApp Store" });
  return Response.json({ error: { message: `mock-meta doesn't know GET ${path}` } }, { status: 404 });
}

export async function POST(request: Request, ctx: Ctx) {
  if (off()) return new Response("Not found", { status: 404 });
  const segments = (await ctx.params).path;
  if (segments[0] === "simulate" && segments[1] === "instagram") {
    const { igUserId, sender, text } = (await request.json()) as { igUserId: string; sender: string; text: string };
    const body = JSON.stringify({ object: "instagram", entry: [{ id: igUserId, time: Date.now(), messaging: [{ sender: { id: sender }, recipient: { id: igUserId }, timestamp: Date.now(), message: { mid: `mid.${Date.now()}${Math.random()}`, text } }] }] });
    const res = await fetch(`${metaConfig().appUrl}/api/meta/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": `sha256=${createHmac("sha256", metaConfig().appSecret).update(body).digest("hex")}` }, body });
    return Response.json({ delivered: res.status });
  }
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
