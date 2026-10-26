import { chromium, type Browser, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptSecret } from "../crypto";
import { getDb } from "../db";
import { createApiKey } from "../integrations/keys";
import { acceptOffer } from "../negotiate";
import { ledgerGate } from "../orders/ledger-gate";
import { startShopNegotiation } from "../shop/negotiation";
import { createOrg } from "../shop/orgs";
import { setPolicy } from "../shop/policies";
import { getProductByRef } from "../shop/products";
import { createStore, getStore, updateStore } from "../shop/stores";
import { store as kv } from "../store";
import { verificationChecklist } from "../verification/service";
import { signWoo, wooConnectionForStore } from "./client";

/**
 * The real PHP plugin on a real WordPress + WooCommerce (Docker: plugins/woocommerce/e2e/setup.sh),
 * talking to GhostCart's real route handlers, which this test serves on GC_PORT. A browser does what
 * the seller and the shopper do: connect in wp-admin, see the button, check out with the negotiated
 * coupon. Skipped unless WOO_E2E_URL is set (`pnpm --filter @ghostcart/web test:woo`).
 */
const WP = process.env.WOO_E2E_URL;
const PORT = Number(process.env.GC_PORT ?? 3999);
/** GhostCart as WordPress (in Docker) and the browser both reach it. */
const GC = `http://host.docker.internal:${PORT}`;
const COMPOSE_DIR = fileURLToPath(new URL("../../../../../plugins/woocommerce/e2e", import.meta.url));
const WIDGET = fileURLToPath(new URL("../../../public/widget/v1.js", import.meta.url));

type Handler = (req: Request, ctx?: unknown) => Promise<Response> | Response;
/** The GhostCart routes the plugin and the widget use, served as-is. */
async function routes(): Promise<Record<string, Partial<Record<string, Handler>>>> {
  return {
    "/api/v1/woocommerce/connect": await import("@/app/api/v1/woocommerce/connect/route"),
    "/api/v1/woocommerce/verify": await import("@/app/api/v1/woocommerce/verify/route"),
    "/api/v1/woocommerce/orders": await import("@/app/api/v1/woocommerce/orders/route"),
    "/api/v1/products": await import("@/app/api/v1/products/route"),
    "/api/v1/widget/product": await import("@/app/api/v1/widget/product/route"),
  };
}

async function serveGhostCart(): Promise<Server> {
  const table = await routes();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", GC);
    if (url.pathname === "/widget/v1.js") {
      res.writeHead(200, { "Content-Type": "text/javascript" }).end(readFileSync(WIDGET));
      return;
    }
    const handler = table[url.pathname]?.[req.method ?? "GET"];
    if (!handler) {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const body = chunks.length && req.method !== "GET" ? Buffer.concat(chunks) : undefined;
    const out = await handler(new Request(url, { method: req.method, headers, body }));
    res.writeHead(out.status, Object.fromEntries(out.headers)).end(Buffer.from(await out.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(PORT, "0.0.0.0", resolve));
  return server;
}

/** WP-CLI inside the compose project. */
const wp = (...args: string[]) => execFileSync("docker", ["compose", "run", "--rm", "-T", "cli", "wp", ...args], { cwd: COMPOSE_DIR, encoding: "utf8" }).trim();

type StoreProduct = { id: number; name: string; permalink: string };
async function wooProducts() {
  return (await (await fetch(`${WP}/wp-json/wc/store/v1/products?per_page=50`)).json()) as StoreProduct[];
}

describe.skipIf(!WP)("WooCommerce plugin on a real WordPress", () => {
  let server: Server;
  let browser: Browser;
  let admin: Page;
  let kettle: StoreProduct;
  let lamp: StoreProduct;
  const ctx: { storeId: string; sk: string; pk: string } = { storeId: "", sk: "", pk: "" };

  beforeAll(async () => {
    execFileSync("pnpm", ["--filter", "@ghostcart/widget", "run", "build"], { stdio: "ignore" });
    server = await serveGhostCart();
    const org = await createOrg({ name: "ZZ Woo Docker", ownerPhone: "+919000019901", ownerName: "ZZ" });
    const store = await createStore({ orgId: org.id, name: "ZZ Woo Docker Store", platform: "woocommerce", domain: "localhost" });
    await setPolicy(store.id, "store", null, { maxDiscountPct: 10, autoApprovePct: 5 });
    await updateStore(store.id, { status: "live" });
    ctx.storeId = store.id;
    ctx.sk = (await createApiKey(store, "secret", "owner")).value;
    ctx.pk = (await createApiKey(store, "publishable", "owner", [WP!])).value;
    const products = await wooProducts();
    kettle = products.find((p) => p.name === "ZZ Woo Kettle")!;
    lamp = products.find((p) => p.name === "ZZ Woo Lamp")!;
    // GhostCart starts empty each run but WordPress keeps its state: disconnect the plugin and put the
    // products back as setup.sh made them, so every run starts from a fresh install.
    wp("eval", "foreach (['url','publishable_key','secret_key','signing_secret','verified'] as $o) delete_option('ghostcart_' . $o);");
    wp("wc", "product", "update", String(kettle.id), "--user=admin", "--regular_price=2000", "--stock_quantity=5");
    wp("wc", "product", "update", String(lamp.id), "--user=admin", "--regular_price=900", "--stock_quantity=3");
    // The browser reaches GhostCart the way the container does.
    browser = await chromium.launch({ args: [`--host-resolver-rules=MAP host.docker.internal 127.0.0.1`] });
    admin = await browser.newPage();
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await new Promise((r) => server?.close(r));
  });

  it("connects from wp-admin: keys saved, site ownership verified, catalogue sent", async () => {
    expect(kettle && lamp).toBeTruthy();
    await admin.goto(`${WP}/wp-login.php`);
    await admin.fill("#user_login", "admin");
    await admin.fill("#user_pass", "zz-admin-pass");
    await admin.click("#wp-submit");
    await admin.waitForURL(/wp-admin/);

    await admin.goto(`${WP}/wp-admin/admin.php?page=ghostcart`);
    await admin.fill("#ghostcart_url", GC);
    await admin.fill("#ghostcart_pk", ctx.pk);
    await admin.fill("#ghostcart_sk", ctx.sk);
    await admin.getByRole("button", { name: "Save keys" }).click();
    await expect.poll(() => admin.locator(".wrap").innerText()).toContain("Keys saved");
    await admin.getByRole("button", { name: "Connect to GhostCart" }).click();
    await expect.poll(() => admin.locator(".wrap").innerText(), { timeout: 30_000 }).toContain("Connected to ZZ Woo Docker Store. 2 products sent to GhostCart.");
    await expect.poll(() => admin.locator(".wrap").textContent()).toContain("Connected and verified");

    expect((await verificationChecklist((await getStore(ctx.storeId))!)).steps.ownership).toBe("done");
    expect(await getProductByRef(ctx.storeId, `woo-${kettle.id}`)).toMatchObject({ title: "ZZ Woo Kettle", price: 2000, stock: 5, status: "active" });
    expect(await getProductByRef(ctx.storeId, `woo-${lamp.id}`)).toMatchObject({ title: "ZZ Woo Lamp", price: 900 });
  }, 90_000);

  it("shows the haggle button on the product page", async () => {
    const page = await browser.newPage();
    await page.goto(kettle.permalink);
    await expect.poll(() => page.locator(`[data-ghostcart-product="woo-${kettle.id}"]`).getByRole("button", { name: "Make an offer" }).count(), { timeout: 15_000 }).toBe(1);
    await page.close();
  }, 60_000);

  let code = "";
  it("turns an agreed price into a coupon, the shopper checks out with it, and the order comes back to GhostCart", async () => {
    const product = (await getProductByRef(ctx.storeId, `woo-${kettle.id}`))!;
    let deal = await startShopNegotiation(product.id, "zz-woo-docker-buyer");
    deal = await acceptOffer(deal);
    expect(deal.status).toBe("granted");
    code = deal.grant!.code;
    expect(deal.grant!.checkoutUrl).toContain(`add-to-cart=${kettle.id}`);

    // The coupon the plugin made in WooCommerce: single use, this product only, the agreed discount.
    const coupon = JSON.parse(wp("wc", "shop_coupon", "list", "--user=admin", `--code=${code}`, "--format=json"))[0];
    expect(coupon.code.toUpperCase()).toBe(code);
    expect(coupon).toMatchObject({ discount_type: "fixed_product", usage_limit: 1, product_ids: [kettle.id], individual_use: true });
    expect(Number(coupon.amount)).toBeCloseTo(2000 - deal.dealPrice, 2);

    const shopper = await browser.newContext();
    const page = await shopper.newPage();
    await page.goto(deal.grant!.checkoutUrl!);
    await expect.poll(() => page.locator("body").textContent(), { timeout: 15_000 }).toMatch(new RegExp(code, "i"));
    await page.goto(`${WP}/checkout/`);
    await page.getByLabel("Email address").fill("zz-woo-shopper@example.test");
    await page.getByLabel("First name").fill("ZZ");
    await page.getByLabel("Last name").fill("Shopper");
    await page.getByLabel("Address", { exact: true }).fill("12 ZZ Residency, Indiranagar");
    await page.getByLabel("City").fill("Bengaluru");
    await page.getByLabel("PIN Code").fill("560038");
    await page.getByLabel("Phone (optional)").or(page.getByLabel("Phone")).fill("9000019902");
    await page.getByText("Cash on delivery").first().click();
    await page.getByRole("button", { name: /place order/i }).click();
    await page.waitForURL(/order-received/, { timeout: 30_000 });
    await expect.poll(() => page.locator("body").textContent()).toMatch(/order has been received|thank you/i);
    const orderNumber = new URL(page.url()).pathname.match(/order-received\/(\d+)/)![1];
    await shopper.close();

    // COD orders go to "processing", and the plugin reports the coupon order to GhostCart.
    await expect.poll(async () => (await kv.getDeal(deal.id))?.grant?.platformOrderRef, { timeout: 15_000 }).toBe(`#${orderNumber}`);
    const gate = await ledgerGate(await getDb(), { graceMs: 0 });
    expect(gate.problems.filter((p) => !p.orderId)).toEqual([]);
  }, 120_000);

  it("refuses the coupon a second time, and on another product", async () => {
    const cart = async () => {
      const r = await fetch(`${WP}/wp-json/wc/store/v1/cart`);
      return r.headers.get("cart-token")!;
    };
    const call = (token: string, path: string, body: unknown) =>
      fetch(`${WP}/wp-json/wc/store/v1/cart/${path}`, { method: "POST", headers: { "Content-Type": "application/json", "Cart-Token": token }, body: JSON.stringify(body) });

    const again = await cart();
    expect((await call(again, "add-item", { id: kettle.id, quantity: 1 })).status).toBe(201);
    const reused = await call(again, "apply-coupon", { code });
    expect(reused.status).toBe(400);

    const other = await cart();
    expect((await call(other, "add-item", { id: lamp.id, quantity: 1 })).status).toBe(201);
    expect((await call(other, "apply-coupon", { code })).status).toBe(400);
  }, 60_000);

  it("rejects coupon requests that aren't signed with the site's secret, or are stale, or overpay", async () => {
    const conn = (await wooConnectionForStore(ctx.storeId))!;
    const secret = decryptSecret(conn.accessTokenEncrypted);
    const body = JSON.stringify({ code: "GC-ZZABCDEF", productId: lamp.id, amount: "50.00", expiresAt: new Date(Date.now() + 3600_000).toISOString() });
    const post = (headers: Record<string, string>, b = body) => fetch(`${WP}/wp-json/ghostcart/v1/coupons`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: b });

    expect((await post({})).status).toBe(401);
    expect((await post({ "X-GhostCart-Signature": signWoo("wcsec_wrong", body) })).status).toBe(401);
    expect((await post({ "X-GhostCart-Signature": signWoo(secret, body, Math.floor(Date.now() / 1000) - 600) })).status).toBe(401);
    const overpay = JSON.stringify({ ...JSON.parse(body), amount: "900.00" });
    expect((await post({ "X-GhostCart-Signature": signWoo(secret, overpay) }, overpay)).status).toBe(400);
    expect((await post({ "X-GhostCart-Signature": signWoo(secret, body) })).status).toBe(200);
  }, 60_000);

  it("sends WooCommerce price changes to GhostCart", async () => {
    wp("wc", "product", "update", String(lamp.id), "--user=admin", "--regular_price=850");
    await expect.poll(async () => (await getProductByRef(ctx.storeId, `woo-${lamp.id}`))?.price, { timeout: 15_000 }).toBe(850);
  }, 90_000);
});
