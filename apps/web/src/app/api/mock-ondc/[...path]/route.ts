import { ondcConfig } from "@/lib/ondc/config";
import { authorizationHeader, generateSigningKeys, parseAuthorization, verifyAuthorization } from "@/lib/ondc/crypto";

/**
 * Development stand-in for the ONDC network: the registry (/registry/v2.0/lookup), the gateway
 * (/gateway/search) and one seller app (/bpp/select|init|confirm|status) with a small ZZ catalogue.
 * The seller app signs its callbacks with a fixed dev key. Point ONDC_REGISTRY_URL, ONDC_GATEWAY_URL at
 * <app>/api/mock-ondc/registry and /gateway. Never available in production.
 *
 * Test hooks: pincodes starting with 9 are unserviceable; item zz-bap-only asks for buyer-app collection.
 */
const off = () => process.env.VERCEL_ENV === "production" || !ondcConfig().registryUrl.includes("/api/mock-ondc");
type Ctx = { params: Promise<{ path: string[] }> };
type Json = Record<string, unknown>;

// The mock seller app's signing key, made fresh per server process (kept across hot reloads).
const g = globalThis as typeof globalThis & { __mockOndcKey?: ReturnType<typeof generateSigningKeys> };
g.__mockOndcKey ??= generateSigningKeys();
const BPP = { subscriberId: "zz-mock-seller-app.ondc.test", ukId: "zz-mock-uk-1", ...g.__mockOndcKey };
const CATALOG = [
  { id: "zz-ondc-kettle", name: "ZZ ONDC Steel Kettle 1.5L", price: 899, mrp: 1199 },
  { id: "zz-ondc-atta", name: "ZZ ONDC Whole Wheat Atta 5kg", price: 289, mrp: 320 },
  { id: "zz-ondc-earbuds", name: "ZZ ONDC Wireless Earbuds", price: 1499, mrp: 2499 },
  { id: "zz-bap-only", name: "ZZ ONDC Kettle (buyer-app payment only)", price: 949, mrp: 1199 },
];
const DELIVERY = 40;
const PROVIDER = { id: "zz-provider-1", descriptor: { name: "ZZ Mock Kirana" }, locations: [{ id: "zz-loc-1" }] };

async function callBack(ctx: Json, action: string, body: { message?: Json; error?: Json }) {
  const reply = JSON.stringify({ context: { ...ctx, action, bpp_id: BPP.subscriberId, bpp_uri: bppUri(), timestamp: new Date().toISOString() }, ...body });
  await fetch(`${String(ctx.bap_uri).replace(/\/$/, "")}/${action}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: authorizationHeader(reply, BPP) }, body: reply });
}
const bppUri = () => ondcConfig().registryUrl.replace(/\/registry\/?$/, "/bpp");
const ack = () => Response.json({ message: { ack: { status: "ACK" } } });
const quoteFor = (items: { id: string; quantity?: { count?: number } }[]) => {
  const lines = items.map((i) => {
    const item = CATALOG.find((c) => c.id === i.id)!;
    const count = i.quantity?.count ?? 1;
    return { "@ondc/org/item_id": item.id, "@ondc/org/item_quantity": { count }, "@ondc/org/title_type": "item", title: item.name, price: { currency: "INR", value: (item.price * count).toFixed(2) } };
  });
  const total = lines.reduce((s, l) => s + Number(l.price.value), 0) + DELIVERY;
  return { price: { currency: "INR", value: total.toFixed(2) }, breakup: [...lines, { "@ondc/org/item_id": "F1", "@ondc/org/title_type": "delivery", title: "Delivery charges", price: { currency: "INR", value: DELIVERY.toFixed(2) } }], ttl: "PT15M" };
};
const FULFILLMENT = { id: "F1", "@ondc/org/category": "Standard Delivery", "@ondc/org/TAT": "P2D", state: { descriptor: { code: "Serviceable" } } };

export async function POST(request: Request, ctx: Ctx) {
  if (off()) return new Response("Not found", { status: 404 });
  const path = (await ctx.params).path.join("/");
  const raw = await request.text();
  const body = JSON.parse(raw || "{}") as { context?: Json; message?: Json };
  const us = ondcConfig();

  if (path === "registry/v2.0/lookup") {
    const all = [
      { subscriber_id: BPP.subscriberId, ukId: BPP.ukId, signing_public_key: BPP.publicKey, type: "BPP", subscriber_url: bppUri() },
      { subscriber_id: us.subscriberId, ukId: us.ukId, signing_public_key: us.signingPublicKey, type: "BAP", subscriber_url: us.bapUri },
    ];
    const q = body as unknown as { subscriber_id?: string; ukId?: string };
    return Response.json(all.filter((s) => (!q.subscriber_id || s.subscriber_id === q.subscriber_id) && (!q.ukId || s.ukId === q.ukId)));
  }

  // Everything else must be signed by the buyer app, as on the real network.
  const auth = parseAuthorization(request.headers.get("authorization"));
  if (!auth || auth.subscriberId !== us.subscriberId || !verifyAuthorization(raw, auth, us.signingPublicKey))
    return Response.json({ message: { ack: { status: "NACK" } }, error: { type: "POLICY-ERROR", code: "10001", message: "Bad signature" } }, { status: 401 });
  const c = body.context ?? {};
  const order = (body.message?.order ?? {}) as Json;

  if (path === "gateway/search") {
    const q = String((((body.message?.intent as Json)?.item as Json)?.descriptor as Json)?.name ?? "").toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const items = CATALOG.filter((i) => words.some((w) => i.name.toLowerCase().includes(w))).map((i) => ({
      id: i.id,
      descriptor: { name: i.name, images: [] },
      price: { currency: "INR", value: i.price.toFixed(2), maximum_value: i.mrp.toFixed(2) },
      quantity: { available: { count: "25" } },
      location_id: "zz-loc-1",
    }));
    if (items.length) await callBack(c, "on_search", { message: { catalog: { "bpp/descriptor": { name: "ZZ Mock Seller App" }, "bpp/providers": [{ ...PROVIDER, items }] } } });
    return ack();
  }
  if (path === "bpp/select") {
    const items = (order.items as { id: string; quantity?: { count?: number } }[]) ?? [];
    const pincode = String(((((order.fulfillments as Json[])?.[0]?.end as Json)?.location as Json)?.address as Json)?.area_code ?? "");
    if (pincode.startsWith("9")) await callBack(c, "on_select", { error: { type: "DOMAIN-ERROR", code: "30009", message: "We don't deliver to that pincode." } });
    else await callBack(c, "on_select", { message: { order: { provider: PROVIDER, items: items.map((i) => ({ id: i.id, fulfillment_id: "F1" })), fulfillments: [FULFILLMENT], quote: quoteFor(items) } } });
    return ack();
  }
  if (path === "bpp/init") {
    const items = (order.items as { id: string; quantity?: { count?: number } }[]) ?? [];
    const bapOnly = items.some((i) => i.id === "zz-bap-only");
    const payment = bapOnly ? { type: "ON-ORDER", collected_by: "BAP" } : { type: "ON-ORDER", collected_by: "BPP", uri: `${bppUri()}/pay/${c.transaction_id}`, status: "NOT-PAID" };
    await callBack(c, "on_init", { message: { order: { ...order, provider: PROVIDER, fulfillments: [{ ...FULFILLMENT, ...((order.fulfillments as Json[])?.[0] ?? {}) }], quote: quoteFor(items), payment } } });
    return ack();
  }
  if (path === "bpp/confirm") {
    await callBack(c, "on_confirm", { message: { order: { ...order, state: "Accepted", fulfillments: [{ ...FULFILLMENT, state: { descriptor: { code: "Pending" } } }] } } });
    return ack();
  }
  if (path === "bpp/status") {
    await callBack(c, "on_status", { message: { order: { id: (body.message as Json)?.order_id, state: "In-progress", fulfillments: [{ ...FULFILLMENT, state: { descriptor: { code: "Order-picked-up" } } }] } } });
    return ack();
  }
  if (path === "bpp/cancel") {
    const m = body.message as Json;
    await callBack(c, "on_cancel", { message: { order: { id: m.order_id, state: "Cancelled", cancellation: { cancelled_by: us.subscriberId, reason: { id: m.cancellation_reason_id } }, fulfillments: [{ ...FULFILLMENT, state: { descriptor: { code: "Cancelled" } } }] } } });
    return ack();
  }
  if (path === "bpp/update") {
    const o = (body.message as Json).order as Json;
    await callBack(c, "on_update", { message: { order: { id: o.id, state: "Completed", fulfillments: [{ id: "R1", type: "Return", state: { descriptor: { code: "Return_Initiated" } } }] } } });
    return ack();
  }
  if (path === "bpp/track") {
    await callBack(c, "on_track", { message: { tracking: { url: `${bppUri()}/track/${(body.message as Json).order_id}`, status: "active" } } });
    return ack();
  }
  if (path === "bpp/support") {
    await callBack(c, "on_support", { message: { phone: "+919000000999", email: "zz-support@mock-seller.test", uri: `${bppUri()}/support` } });
    return ack();
  }
  if (path === "bpp/issue") {
    const issue = (body.message as Json).issue as Json;
    await callBack(c, "on_issue", { message: { issue: { id: issue.id, status: "OPEN", issue_actions: { respondent_actions: [{ respondent_action: "PROCESSING", short_desc: "We're looking into it", updated_at: new Date().toISOString() }] } } } });
    return ack();
  }
  if (path === "bpp/issue_status") {
    const id = (body.message as Json).issue_id;
    await callBack(c, "on_issue_status", { message: { issue: { id, status: "CLOSED", issue_actions: { respondent_actions: [{ respondent_action: "RESOLVED", short_desc: "Refund issued", updated_at: new Date().toISOString() }] }, resolution: { short_desc: "Refunded the item", action_triggered: "REFUND", refund_amount: "899.00" } } } });
    return ack();
  }
  return Response.json({ error: `mock-ondc doesn't know ${path}` }, { status: 404 });
}

/** The mock seller app's payment page (seller-collected payment): nothing to pay, it just says so. */
export async function GET(_request: Request, ctx: Ctx) {
  if (off()) return new Response("Not found", { status: 404 });
  const path = (await ctx.params).path;
  if (path[0] !== "bpp" || path[1] !== "pay") return new Response("Not found", { status: 404 });
  return new Response(`<!doctype html><meta charset="utf-8"><title>ZZ Mock Seller App</title><p>ZZ Mock Seller App payment page for ${path[2]?.replace(/[^\w-]/g, "")}. Test mode: no money moves.</p>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
