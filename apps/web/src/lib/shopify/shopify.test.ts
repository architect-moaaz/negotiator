import { accounts } from "@ghostcart/core";
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

let jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

const install = await import("@/app/api/shopify/install/route");
const callback = await import("@/app/api/shopify/callback/route");
const webhooks = await import("@/app/api/shopify/webhooks/route");
const connect = await import("@/app/api/seller/connect/shopify/route");
const mock = await import("@/app/api/mock-shopify/[...path]/route");
const { verifyQueryHmac, verifyWebhookHmac } = await import("./auth");
const { shopifyConfig } = await import("./config");
const { startSession } = await import("../session");
const { getProductByRef } = await import("../shop/products");
const { getStore, updateStore } = await import("../shop/stores");
const { startShopNegotiation } = await import("../shop/negotiation");
const { acceptOffer } = await import("../negotiate");
const { store: kv } = await import("../store");
const { getDb } = await import("../db");
const { balance } = await import("../orders/ledger");
const { verificationChecklist } = await import("../verification/service");

const secret = () => shopifyConfig().apiSecret;
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
const signedWebhook = (topic: string, shop: string, payload: unknown, sig?: string) => {
  const body = JSON.stringify(payload);
  return new Request("http://test/api/shopify/webhooks", {
    method: "POST",
    headers: { "X-Shopify-Topic": topic, "X-Shopify-Shop-Domain": shop, "X-Shopify-Hmac-Sha256": sig ?? createHmac("sha256", secret()).update(body).digest("base64") },
    body,
  });
};

let n = 0;
/** Install (via the mock's instant consent) and connect a fresh shop; returns the GhostCart store. */
async function installAndConnect() {
  const shop = `zz-shop-${++n}.myshopify.com`;
  const start = await install.GET(new Request(`http://test/api/shopify/install?shop=${shop}`));
  expect(start.status).toBe(302);
  const authorize = new URL(start.headers.get("location")!);
  const consent = await mock.GET(new Request(authorize), { params: Promise.resolve({ path: authorize.pathname.replace("/api/mock-shopify/", "").split("/") }) });
  const back = new URL(consent.headers.get("location")!);
  const done = await callback.GET(new Request(`http://test${back.pathname}${back.search}`));
  expect(done.headers.get("location")).toContain(`/seller/connect/shopify?shop=${shop}`);

  jar = new Map();
  await startSession("member", `+9190000018${String(n).padStart(2, "0")}`);
  const res = await connect.POST(new Request("http://test/api/seller/connect/shopify", { method: "POST", headers: { cookie: cookieHeader(), "Content-Type": "application/json" }, body: JSON.stringify({ shop, businessName: "ZZ Shopify Biz", ownerName: "ZZ Owner" }) }));
  const body = await res.json();
  expect(res.status).toBe(200);
  return { shop, storeId: body.storeId as string, imported: body.imported as number };
}

beforeEach(() => {
  jar = new Map();
});

describe("Shopify signatures", () => {
  it("accept only correctly signed OAuth redirects and webhooks", () => {
    const params = new URLSearchParams({ code: "abc", shop: "zz.myshopify.com", state: "s", timestamp: "1" });
    const message = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&");
    params.set("hmac", createHmac("sha256", secret()).update(message).digest("hex"));
    expect(verifyQueryHmac(params)).toBe(true);
    params.set("shop", "evil.myshopify.com");
    expect(verifyQueryHmac(params)).toBe(false);
    const body = '{"id":1}';
    expect(verifyWebhookHmac(body, createHmac("sha256", secret()).update(body).digest("base64"))).toBe(true);
    expect(verifyWebhookHmac(body, "bad")).toBe(false);
  });

  it("refuse an install callback with a reused or wrong state", async () => {
    const params = new URLSearchParams({ code: "abc", shop: "zz-replay.myshopify.com", state: "never-issued", timestamp: "1" });
    const message = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&");
    params.set("hmac", createHmac("sha256", secret()).update(message).digest("hex"));
    expect((await callback.GET(new Request(`http://test/api/shopify/callback?${params}`))).status).toBe(400);
  });
});

describe("Shopify install → haggle → code → order", () => {
  it("connects the shop, proves ownership, imports products and hands the theme its key", async () => {
    const { shop, storeId, imported } = await installAndConnect();
    expect(imported).toBe(2);
    const store = (await getStore(storeId))!;
    expect(store).toMatchObject({ platform: "shopify", domain: shop });
    expect((await verificationChecklist(store)).steps.ownership).toBe("done");
    const kurta = await getProductByRef(storeId, "shopify-9001");
    expect(kurta).toMatchObject({ title: "ZZ Mock Kurta, Cotton", price: 1499, mrp: 1999, stock: 12, source: "shopify:9001:7001" });
    const metafields = (await kv.kvGet<{ key: string; value: string }[]>(`mockshopify:${shop}:metafields`))!;
    expect(metafields[0]).toMatchObject({ key: "publishable_key", value: expect.stringMatching(/^gc_pk_/) });
  });

  it("issues a single-use, product-locked Shopify code and redeems it from the order webhook", async () => {
    const { shop, storeId } = await installAndConnect();
    await updateStore(storeId, { status: "live" });
    const product = (await getProductByRef(storeId, "shopify-9001"))!;
    let deal = await startShopNegotiation(product.id, `shopify-buyer-${n}`);
    deal = await acceptOffer(deal);
    expect(deal.status).toBe("granted");
    expect(deal.grant).toMatchObject({ platform: "shopify", checkoutUrl: `https://${shop}/cart/7001:1?discount=${deal.grant!.code}` });
    const created = (await kv.kvGet<Record<string, unknown>>(`mockshopify:${shop}:discount:${deal.grant!.code}`))!;
    expect(created).toMatchObject({ usageLimit: 1, appliesOncePerCustomer: true, customerGets: { items: { products: { productsToAdd: ["gid://shopify/Product/9001"] } } } });

    expect((await webhooks.POST(signedWebhook("orders/create", shop, { id: 1, name: "#1001", discount_codes: [{ code: deal.grant!.code }] }, "forged"))).status).toBe(401);
    expect((await webhooks.POST(signedWebhook("orders/create", shop, { id: 1, name: "#1001", discount_codes: [{ code: deal.grant!.code }] }))).status).toBe(200);
    const after = (await kv.getDeal(deal.id))!;
    expect(after.grant).toMatchObject({ platformOrderRef: "#1001" });
    expect(await balance(await getDb(), accounts.sellerFeesDue(storeId))).toBeGreaterThan(0);
  });

  it("keeps products in sync and closes the store when the app is uninstalled", async () => {
    const { shop, storeId } = await installAndConnect();
    await webhooks.POST(signedWebhook("products/update", shop, { id: 9002, title: "ZZ Mock Steel Bottle 1L (new)", status: "active", variants: [{ id: 7002, price: "649.00", inventory_quantity: 33 }] }));
    expect(await getProductByRef(storeId, "shopify-9002")).toMatchObject({ title: "ZZ Mock Steel Bottle 1L (new)", price: 649, stock: 33 });
    await webhooks.POST(signedWebhook("products/delete", shop, { id: 9002 }));
    expect((await getProductByRef(storeId, "shopify-9002"))?.status).toBe("archived");
    await updateStore(storeId, { status: "live" });
    await webhooks.POST(signedWebhook("app/uninstalled", shop, {}));
    expect((await getStore(storeId))?.status).toBe("draft");
  });

  it("answers the mandatory privacy webhooks", async () => {
    const { shop } = await installAndConnect();
    for (const topic of ["customers/data_request", "customers/redact", "shop/redact"]) {
      expect((await webhooks.POST(signedWebhook(topic, shop, { shop_domain: shop }))).status).toBe(200);
    }
  });
});
