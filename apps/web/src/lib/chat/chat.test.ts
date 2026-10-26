import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

const webhook = await import("@/app/api/meta/webhook/route");
const { metaConfig } = await import("../meta/config");
const { connectWhatsApp } = await import("../meta/whatsapp");
const { parseAmount, readIntent } = await import("./intent");
const { createOrg } = await import("../shop/orgs");
const { setPolicy } = await import("../shop/policies");
const { createProduct } = await import("../shop/products");
const { createStore, updateStore } = await import("../shop/stores");
const { decideApproval } = await import("../negotiate");
const { store: kv } = await import("../store");

describe("reading shopper messages", () => {
  it("understands prices the way Indian shoppers write them", () => {
    expect(parseAmount("₹1,250")).toBe(1250);
    expect(parseAmount("can you do rs 900?")).toBe(900);
    expect(parseAmount("900/-")).toBe(900);
    expect(parseAmount("9k")).toBe(9000);
    expect(parseAmount("1.5k final")).toBe(1500);
    expect(parseAmount("no number here")).toBeNull();
  });

  it("tells accepting, stopping, picking and offering apart without a model", async () => {
    expect(await readIntent("ok deal", { listPrice: 1000 })).toEqual({ kind: "accept" });
    expect(await readIntent("theek hai", { listPrice: 1000 })).toEqual({ kind: "accept" });
    expect(await readIntent("stop", { listPrice: 1000 })).toEqual({ kind: "stop" });
    expect(await readIntent("2", { listPrice: 0, choosing: 3 })).toEqual({ kind: "pick", index: 1 });
    expect(await readIntent("how about 850", { listPrice: 1000 })).toEqual({ kind: "offer", amount: 850 });
    expect((await readIntent("50000", { listPrice: 1000 })).kind).toBe("unknown"); // out of bounds
  });
});

let n = 0;
async function whatsappShop() {
  const org = await createOrg({ name: "ZZ WA Seller", ownerPhone: `+9190000021${String(++n).padStart(2, "0")}`, ownerName: "ZZ" });
  const s = (await updateStore((await createStore({ orgId: org.id, name: "ZZ WA Store", platform: "ghostcart_shop" })).id, { status: "live", tier: "verified" }))!;
  await setPolicy(s.id, "store", null, { maxDiscountPct: 10, autoApprovePct: 5 });
  await createProduct(s.id, { title: "ZZ WA Kurta", price: 1000, stock: 5 });
  const phoneNumberId = `10990000${String(n).padStart(5, "0")}`;
  await connectWhatsApp({ storeId: s.id, code: "mock-code", phoneNumberId, wabaId: `2099${n}` });
  return { store: s, phoneNumberId };
}

const from = (i: number) => `9198765${String(43000 + i).padStart(5, "0")}`;
async function shopperSays(phoneNumberId: string, wa: string, text: string, opts: { id?: string; sig?: string } = {}) {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: phoneNumberId }, contacts: [{ wa_id: wa, profile: { name: "ZZ Shopper" } }], messages: [{ from: wa, id: opts.id ?? `wamid.${Math.random()}`, type: "text", text: { body: text } }] } }] }],
  });
  return webhook.POST(new Request("http://test/api/meta/webhook", { method: "POST", headers: { "X-Hub-Signature-256": opts.sig ?? `sha256=${createHmac("sha256", metaConfig().appSecret).update(body).digest("hex")}` }, body }));
}
const sent = async (phoneNumberId: string) => ((await kv.kvGet<{ to: string; text: { body: string } }[]>(`mockmeta:sent:${phoneNumberId}`)) ?? []).map((m) => m.text.body);

describe("haggling on WhatsApp", () => {
  it("answers Meta's verification handshake only with the right token", () => {
    const ok = webhook.GET(new Request(`http://test/api/meta/webhook?hub.mode=subscribe&hub.verify_token=${metaConfig().verifyToken}&hub.challenge=42`));
    expect(ok.status).toBe(200);
    expect(webhook.GET(new Request("http://test/api/meta/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42")).status).toBe(403);
  });

  it("goes from hello to a payment link in a chat", async () => {
    const { phoneNumberId } = await whatsappShop();
    const wa = from(n);
    await shopperSays(phoneNumberId, wa, "hi");
    expect((await sent(phoneNumberId)).at(-1)).toContain("1. ZZ WA Kurta, ₹1,000");
    await shopperSays(phoneNumberId, wa, "1");
    expect((await sent(phoneNumberId)).at(-1)).toContain("Make me an offer");
    // The hint comes from the current offer (₹987 → ₹940), never from the seller's floor (₹900).
    expect((await sent(phoneNumberId)).at(-1)).toContain('like "₹940"');
    await shopperSays(phoneNumberId, wa, "can you do 960?");
    await shopperSays(phoneNumberId, wa, "ok");
    expect((await sent(phoneNumberId)).at(-1)).toMatch(/Lock it with a ₹9 UPI payment in the next 3 minutes: http.*\/deal\/\w+/);
  });

  it("messages the shopper when the seller decides on a low offer", async () => {
    const { phoneNumberId } = await whatsappShop();
    const wa = from(n);
    await shopperSays(phoneNumberId, wa, "hi");
    await shopperSays(phoneNumberId, wa, "1");
    for (let i = 0; i < 4; i++) await shopperSays(phoneNumberId, wa, "920");
    expect((await sent(phoneNumberId)).at(-1)).toMatch(/asked|Asking|hang tight|checking/i);
    const deal = (await kv.listDeals(500)).find((d) => d.chat?.threadKey === `${phoneNumberId}:${wa}`)!;
    expect(deal.status).toBe("awaiting_approval");
    await decideApproval(deal, "approved", "ZZ Owner", "seller");
    expect((await sent(phoneNumberId)).at(-1)).toContain("approved ₹920");
  });

  it("rejects forged webhooks and handles a retried message once", async () => {
    const { phoneNumberId } = await whatsappShop();
    expect((await shopperSays(phoneNumberId, from(n), "hi", { sig: "sha256=forged" })).status).toBe(401);
    await shopperSays(phoneNumberId, from(n), "hi", { id: "wamid.same" });
    await shopperSays(phoneNumberId, from(n), "hi", { id: "wamid.same" });
    expect((await sent(phoneNumberId)).length).toBe(1);
  });
});
