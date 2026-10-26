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
const { verifyQueryHmac, verifyWebhookHmac } = await import("@ghostcart/channels");
const { shopifyConfig } = await import("@ghostcart/channels");
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
async function installAndConnect(prefix = "zz-shop") {
  const shop = `${prefix}-${++n}.myshopify.com`;
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

  it("issues one code for a whole Privilege cart, with a cart link carrying every item", async () => {
    const { shop, storeId } = await installAndConnect();
    await updateStore(storeId, { status: "live" });
    const { setRecovery } = await import("../privilege/settings");
    const { captureCart, getCart } = await import("../privilege/carts");
    const { startCartNegotiation } = await import("../privilege/negotiation");
    await setRecovery(storeId, { enabled: true, maxDiscountPct: 15, autoApprovePct: 10 });
    const cart = await captureCart({ storeId, source: "widget", items: [{ ref: "shopify-9001", quantity: 1 }, { ref: "shopify-9002", quantity: 2 }] });
    let deal = await startCartNegotiation(cart.id, `shopify-cart-buyer-${n}`);
    deal = await acceptOffer(deal);
    expect(deal.status).toBe("granted");
    expect(deal.grant!.checkoutUrl).toBe(`https://${shop}/cart/7001:1,7002:2?discount=${deal.grant!.code}`);
    const created = (await kv.kvGet<{ customerGets: { items: { products: { productsToAdd: string[] } } } }>(`mockshopify:${shop}:discount:${deal.grant!.code}`))!;
    expect(created.customerGets.items.products.productsToAdd.sort()).toEqual(["gid://shopify/Product/9001", "gid://shopify/Product/9002"]);
    await webhooks.POST(signedWebhook("orders/create", shop, { id: 3, name: "#1003", discount_codes: [{ code: deal.grant!.code }] }));
    expect((await getCart(cart.id))?.status).toBe("recovered");
  });

  it("turns checkouts into carts, keeping contact details only when allowed, and closes them on the order", async () => {
    const { shop, storeId } = await installAndConnect();
    const { cartsForStore, getCart } = await import("../privilege/carts");
    const checkout = (token: string, extra: object = {}) => ({
      token,
      line_items: [{ product_id: 9001, quantity: 1 }, { product_id: 424242, quantity: 1 }],
      email: "zz.checkout@example.com",
      phone: "+919876500001",
      buyer_accepts_marketing: true,
      abandoned_checkout_url: `https://${shop}/checkouts/${token}/recover`,
      ...extra,
    });
    await webhooks.POST(signedWebhook("checkouts/create", shop, checkout("zzck1")));
    const [anon] = (await cartsForStore(storeId)).filter((c) => c.externalRef === "zzck1");
    expect(anon).toMatchObject({ source: "shopify_checkout", email: null, phone: null, consentAt: null, subtotal: 1499 });

    process.env.SHOPIFY_CHECKOUT_CONTACT = "1";
    try {
      await webhooks.POST(signedWebhook("checkouts/update", shop, checkout("zzck2", { buyer_accepts_marketing: false })));
      await webhooks.POST(signedWebhook("checkouts/create", shop, checkout("zzck3")));
    } finally {
      delete process.env.SHOPIFY_CHECKOUT_CONTACT;
    }
    const carts = await cartsForStore(storeId);
    expect(carts.find((c) => c.externalRef === "zzck2")).toMatchObject({ email: null });
    const kept = carts.find((c) => c.externalRef === "zzck3")!;
    expect(kept).toMatchObject({ email: "zz.checkout@example.com", phone: "+919876500001" });

    await webhooks.POST(signedWebhook("orders/create", shop, { id: 9, name: "#1009", checkout_token: "zzck1", discount_codes: [] }));
    expect((await getCart(anon.id))?.status).toBe("completed");

    await webhooks.POST(signedWebhook("customers/redact", shop, { customer: { email: "zz.checkout@example.com", phone: "+919876500001" } }));
    expect(await getCart(kept.id)).toMatchObject({ email: null, phone: null, name: null });
  });

  it("falls back to a draft order when Shopify won't create the code, redeems it, and deletes it once expired", async () => {
    const { shop, storeId } = await installAndConnect("zz-nodiscount");
    await updateStore(storeId, { status: "live" });
    const product = (await getProductByRef(storeId, "shopify-9001"))!;
    let deal = await startShopNegotiation(product.id, `shopify-draft-buyer-${n}`);
    deal = await acceptOffer(deal);
    expect(deal.status).toBe("granted");
    expect(deal.grant).toMatchObject({ platform: "shopify", kind: "draft_order", ref: expect.stringMatching(/^gid:\/\/shopify\/DraftOrder\//) });
    expect(deal.grant!.checkoutUrl).toMatch(new RegExp(`^https://${shop}/invoices/`));
    const draft = (await kv.kvGet<{ lineItems: { variantId: string; appliedDiscount: { value: number } }[]; customAttributes: { key: string; value: string }[] }>(`mockshopify:${shop}:draft:${deal.grant!.ref}`))!;
    expect(draft.lineItems[0]).toMatchObject({ variantId: "gid://shopify/ProductVariant/7001", appliedDiscount: { value: product.price - deal.dealPrice } });
    expect(draft.customAttributes).toEqual([{ key: "ghostcart_code", value: deal.grant!.code }]);

    // Paying the draft's invoice creates an order carrying the code as a note attribute.
    await webhooks.POST(signedWebhook("orders/create", shop, { id: 2, name: "#1002", discount_codes: [], note_attributes: [{ name: "ghostcart_code", value: deal.grant!.code }] }));
    expect((await kv.getDeal(deal.id))!.grant).toMatchObject({ platformOrderRef: "#1002" });

    // A second, unused draft is withdrawn after it expires.
    let unused = await startShopNegotiation(product.id, `shopify-draft-buyer-b-${n}`);
    unused = await acceptOffer(unused);
    const { revokeExpiredGrants } = await import("../grants/service");
    expect(await revokeExpiredGrants(unused.grant!.expiresAt - 1000)).not.toContain(unused.id);
    expect(await revokeExpiredGrants(unused.grant!.expiresAt + 1000)).toContain(unused.id);
    expect(await kv.kvGet(`mockshopify:${shop}:draft:${unused.grant!.ref}`)).toBeUndefined();
    expect((await kv.getDeal(unused.id))!.grant!.revokedAt).toBeDefined();
    expect(await revokeExpiredGrants(unused.grant!.expiresAt + 2000)).not.toContain(unused.id); // once only
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
