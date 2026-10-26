import { createHmac, timingSafeEqual } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptOffer } from "../negotiate";
import { createApiKey } from "../integrations/keys";
import { startShopNegotiation } from "../shop/negotiation";
import { createOrg } from "../shop/orgs";
import { createProduct, getProductByRef } from "../shop/products";
import { createStore, getStore, updateStore } from "../shop/stores";
import { store as kv } from "../store";
import { verificationChecklist } from "../verification/service";

const connect = await import("@/app/api/v1/woocommerce/connect/route");
const verify = await import("@/app/api/v1/woocommerce/verify/route");
const orders = await import("@/app/api/v1/woocommerce/orders/route");
const products = await import("@/app/api/v1/products/route");

/**
 * A stand-in for the PHP plugin's REST routes, following the same protocol as ghostcart.php:
 * X-GhostCart-Signature "t=…,v1=hmac(t.body)" within 5 minutes; verify signs the nonce; coupons create
 * a single-use coupon and return an add-to-cart link.
 */
const sites = new Map<string, { secret: string | null; coupons: Record<string, unknown>[]; tamper?: boolean }>();
const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const site = sites.get(url.origin);
    if (!site) return realFetch(input, init);
    const body = String(init?.body ?? "");
    const m = String(new Headers(init?.headers).get("x-ghostcart-signature")).match(/^t=(\d+),v1=([0-9a-f]{64})$/);
    const expected = m && site.secret ? createHmac("sha256", site.secret).update(`${m[1]}.${body}`).digest("hex") : "";
    if (!m || Math.abs(Date.now() / 1000 - Number(m[1])) > 300 || !timingSafeEqual(Buffer.from(expected.padEnd(64)), Buffer.from(m[2]))) return new Response("{}", { status: 401 });
    const data = JSON.parse(body);
    if (url.pathname.endsWith("/verify")) return Response.json({ signature: site.tamper ? "0".repeat(64) : createHmac("sha256", site.secret!).update(data.nonce).digest("hex") });
    if (url.pathname.endsWith("/coupons")) {
      site.coupons.push(data);
      return Response.json({ checkoutUrl: `${url.origin}/cart/?add-to-cart=${data.productId}&ghostcart_coupon=${data.code}` });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

let n = 0;
async function wooStore() {
  const domain = `zzwoo${++n}.test`;
  const org = await createOrg({ name: "ZZ Woo", ownerPhone: `+9190000019${String(n).padStart(2, "0")}`, ownerName: "ZZ" });
  const s = await createStore({ orgId: org.id, name: "ZZ Woo Store", platform: "woocommerce", domain });
  const { value } = await createApiKey(s, "secret", "owner");
  sites.set(`https://${domain}`, { secret: null, coupons: [] });
  return { store: s, sk: value, site: `https://${domain}` };
}
const call = (handler: (r: Request) => Promise<Response>, sk: string, body: unknown) =>
  handler(new Request("http://test/x", { method: "POST", headers: { Authorization: `Bearer ${sk}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }));

/** What the plugin's "Connect" button does: register, save the signing secret, ask GhostCart to verify. */
async function pluginConnect(w: Awaited<ReturnType<typeof wooStore>>) {
  const res = await call(connect.POST, w.sk, { siteUrl: w.site });
  const { signingSecret } = await res.json();
  sites.get(w.site)!.secret = signingSecret;
  return call(verify.POST, w.sk, {});
}

describe("WooCommerce plugin connection", () => {
  it("verifies the site when the plugin signs GhostCart's nonce, proving ownership", async () => {
    const w = await wooStore();
    const res = await pluginConnect(w);
    expect(await res.json()).toEqual({ verified: true });
    expect((await verificationChecklist((await getStore(w.store.id))!)).steps.ownership).toBe("done");
  });

  it("refuses a plugin that can't sign, and a site for another domain", async () => {
    const w = await wooStore();
    sites.get(w.site)!.tamper = true;
    expect((await pluginConnect(w)).status).toBe(409);
    const other = await call(connect.POST, w.sk, { siteUrl: "https://someone-else.test" });
    expect(other.status).toBe(409);
    expect((await call(connect.POST, "gc_sk_bad", { siteUrl: w.site })).status).toBe(401);
  });
});

describe("WooCommerce price grants", () => {
  it("syncs the catalogue, creates a single-use coupon at agreement, and redeems the order", async () => {
    const w = await wooStore();
    await pluginConnect(w);
    await call(products.POST, w.sk, { products: [{ sku: "woo-42", title: "ZZ Woo Saree", price: 3000, stock: 4 }] });
    await updateStore(w.store.id, { status: "live" });
    const product = (await getProductByRef(w.store.id, "woo-42"))!;
    let deal = await startShopNegotiation(product.id, `woo-buyer-${n}`);
    deal = await acceptOffer(deal);
    expect(deal.status).toBe("granted");
    expect(deal.grant!.checkoutUrl).toBe(`${w.site}/cart/?add-to-cart=42&ghostcart_coupon=${deal.grant!.code}`);
    expect(sites.get(w.site)!.coupons[0]).toMatchObject({ code: deal.grant!.code, productId: 42, amount: (3000 - deal.dealPrice).toFixed(2) });

    const res = await call(orders.POST, w.sk, { code: deal.grant!.code, orderNumber: "5521" });
    expect(await res.json()).toEqual({ redeemed: true });
    expect((await kv.getDeal(deal.id))?.grant?.platformOrderRef).toBe("#5521");
  });

  it("won't start haggles on a Woo store that never connected the plugin", async () => {
    const w = await wooStore();
    await updateStore(w.store.id, { status: "live" });
    const product = await createProduct(w.store.id, { title: "ZZ Unconnected", price: 900, stock: 2, sku: "woo-9" });
    await expect(startShopNegotiation(product.id, "woo-buyer-x")).rejects.toThrow("isn't connected");
  });
});

describe("plugin download", () => {
  it("serves the plugin as a zip with the main file inside", async () => {
    const { GET } = await import("@/app/api/plugins/woocommerce/route");
    const res = await GET();
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    const { unzipSync, strFromU8 } = await import("fflate");
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(["ghostcart/ghostcart.php", "ghostcart/readme.txt", "ghostcart/uninstall.php"]);
    expect(strFromU8(files["ghostcart/ghostcart.php"])).toContain("Plugin Name:       GhostCart for WooCommerce");
  });
});
