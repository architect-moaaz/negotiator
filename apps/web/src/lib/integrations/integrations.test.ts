import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { placeOrder, saveAddress } from "../checkout";
import { decryptSecret, encryptSecret } from "../crypto";
import { acceptOffer, markPaid } from "../negotiate";
import { createOrg } from "../shop/orgs";
import { createProduct } from "../shop/products";
import { startShopNegotiation } from "../shop/negotiation";
import { createStore, updateStore } from "../shop/stores";
import { allowedReturnUrl, createApiKey, revokeApiKey, storeForKey } from "./keys";
import { addWebhookEndpoint, emitWebhook, signPayload, WebhookError } from "./webhooks";

let n = 0;
async function siteStore() {
  const org = await createOrg({ name: "ZZ Site", ownerPhone: `+9190000016${String(++n).padStart(2, "0")}`, ownerName: "ZZ" });
  const s = await createStore({ orgId: org.id, name: "ZZ Site Store", platform: "website", domain: `zzsite${n}.in` });
  return (await updateStore(s.id, { status: "live" }))!;
}

describe("secrets", () => {
  it("round-trip through AES-GCM and refuse tampering", () => {
    const sealed = encryptSecret("whsec_abc");
    expect(sealed).not.toContain("whsec_abc");
    expect(decryptSecret(sealed)).toBe("whsec_abc");
    const [v, iv, tag, body] = sealed.split(".");
    expect(() => decryptSecret([v, iv, tag, body.slice(0, -2) + (body.endsWith("A") ? "BB" : "AA")].join("."))).toThrow();
  });
});

describe("API keys", () => {
  it("publishable keys work only from the store's own site", async () => {
    const s = await siteStore();
    const { value } = await createApiKey(s, "publishable", "owner");
    expect(value.startsWith("gc_pk_")).toBe(true);
    expect(await storeForKey(value, "publishable", `https://${s.domain}`)).toMatchObject({ store: { id: s.id } });
    expect(await storeForKey(value, "publishable", "https://evil.example")).toBeNull();
    expect(await storeForKey(value, "secret")).toBeNull(); // wrong kind
  });

  it("secret keys stop working once revoked", async () => {
    const s = await siteStore();
    const { value, key } = await createApiKey(s, "secret", "owner");
    expect(await storeForKey(value, "secret")).not.toBeNull();
    await revokeApiKey(s.id, key.id);
    expect(await storeForKey(value, "secret")).toBeNull();
  });

  it("only allow return links back to the store's widget sites", async () => {
    const s = await siteStore();
    await createApiKey(s, "publishable", "owner");
    expect(await allowedReturnUrl(s.id, `https://${s.domain}/products/phone?x=1`)).toBe(`https://${s.domain}/products/phone?x=1`);
    expect(await allowedReturnUrl(s.id, "https://phish.example/login")).toBeNull();
    expect(await allowedReturnUrl(s.id, "javascript:alert(1)")).toBeNull();
  });
});

describe("webhooks", () => {
  it("need a public https endpoint", async () => {
    const s = await siteStore();
    await expect(addWebhookEndpoint(s.id, "http://zzsite.in/hook")).rejects.toBeInstanceOf(WebhookError);
    await expect(addWebhookEndpoint(s.id, "https://localhost/hook")).rejects.toBeInstanceOf(WebhookError);
  });

  it("deliver signed order events the seller can verify", async () => {
    const s = await siteStore();
    const { secret } = await addWebhookEndpoint(s.id, `https://${s.domain}/hook`);
    const received: { headers: Headers; body: string }[] = [];
    const fake = (async (_url: string, init: RequestInit) => {
      received.push({ headers: new Headers(init.headers), body: String(init.body) });
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    await emitWebhook(s.id, "order.placed", { id: "ord_x", total: 100 }, fake);
    expect(received).toHaveLength(1);
    const sig = received[0].headers.get("GhostCart-Signature")!;
    const [, t, v1] = sig.match(/^t=(\d+),v1=([0-9a-f]+)$/)!;
    expect(createHmac("sha256", secret).update(`${t}.${received[0].body}`).digest("hex")).toBe(v1);
    expect(signPayload(secret, received[0].body, Number(t))).toBe(sig);
    expect(JSON.parse(received[0].body)).toMatchObject({ event: "order.placed", data: { id: "ord_x" } });
  });

  it("are sent when a widget order is placed, with the delivery address", async () => {
    const s = await siteStore();
    await addWebhookEndpoint(s.id, `https://${s.domain}/hook`);
    const product = await createProduct(s.id, { title: "ZZ Widget Item", price: 1500, stock: 3, sku: `ZZ-W-${n}` });
    let deal = await startShopNegotiation(product.id, `widget-buyer-${n}`);
    deal = await acceptOffer(deal);
    deal = await markPaid(deal, "pinelabs");
    deal = await saveAddress(deal, { name: "ZZ", phone: "+919000001699", line1: `${n} Widget Lane`, city: "Pune", state: "Maharashtra", pincode: "411003" });
    // The seller's endpoint isn't reachable from tests; the delivery is queued for retry, the order isn't affected.
    deal = await placeOrder(deal, "pinelabs");
    expect(deal.checkout?.status).toBe("ordered");
  });
});

describe("/api/v1 with a secret key", async () => {
  const products = await import("@/app/api/v1/products/route");
  const orders = await import("@/app/api/v1/orders/route");
  const widget = await import("@/app/api/v1/widget/product/route");
  const auth = (value: string, body?: unknown) =>
    new Request("http://test/api/v1/x", { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${value}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

  it("upserts the catalogue by SKU and reports bad rows", async () => {
    const s = await siteStore();
    const { value } = await createApiKey(s, "secret", "owner");
    expect((await products.GET(auth("gc_sk_wrong"))).status).toBe(401);
    const first = await (await products.POST(auth(value, { products: [{ sku: "ZZ-A", title: "ZZ Item A", price: 999 }, { title: "No SKU", price: 1 }] }))).json();
    expect(first.results).toEqual([expect.objectContaining({ sku: "ZZ-A", created: true }), expect.objectContaining({ error: "Each product needs a sku." })]);
    const again = await (await products.POST(auth(value, { products: [{ sku: "ZZ-A", title: "ZZ Item A v2", price: 899 }] }))).json();
    expect(again.results[0]).toMatchObject({ created: false, id: first.results[0].id });
    const list = await (await products.GET(auth(value))).json();
    expect(list.products).toEqual([expect.objectContaining({ sku: "ZZ-A", title: "ZZ Item A v2", price: 899 })]);
    expect((await (await orders.GET(auth(value))).json()).orders).toEqual([]);
  });

  it("answers the widget only for the store's own site", async () => {
    const s = await siteStore();
    const { value } = await createApiKey(s, "publishable", "owner");
    await createProduct(s.id, { title: "ZZ Widget Lookup", price: 500, stock: 2, sku: "ZZ-LOOK" });
    const ask = (origin: string) => widget.GET(new Request(`http://test/api/v1/widget/product?key=${value}&ref=ZZ-LOOK`, { headers: { origin } }));
    const ok = await ask(`https://${s.domain}`);
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe(`https://${s.domain}`);
    expect(await ok.json()).toMatchObject({ available: true, haggle: true, price: 500 });
    expect((await ask("https://evil.example")).status).toBe(403);
  });
});
