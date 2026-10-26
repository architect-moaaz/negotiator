import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The "Make an offer" widget on three kinds of seller page: plain HTML, a strict-CSP page, and a
 * Shopify-like theme (deferred app-embed script, hostile global CSS, sections re-rendered by AJAX,
 * the snippet pasted twice). Sellers' pages live on https://shop.test; GhostCart on https://ghostcart.test.
 */
const GC = "https://ghostcart.test";
const SHOP = "https://shop.test";
const KEY = "gc_pk_zz_widget";
// The file that ships: `test:browser` runs the package build first.
const built = readFileSync(fileURLToPath(new URL("../../../apps/web/public/widget/v1.js", import.meta.url)), "utf8");

/** What GhostCart's widget API says about each SKU. */
const PRODUCTS: Record<string, { available: boolean; haggle?: boolean }> = {
  "ZZ-KETTLE": { available: true, haggle: true },
  "ZZ-KETTLE-RED": { available: true, haggle: true },
  "ZZ-LAMP": { available: true, haggle: true },
  "ZZ-SOLDOUT": { available: false },
  "ZZ-NOHAGGLE": { available: true, haggle: false },
};

type Host = { html: string; headers?: Record<string, string> };

async function serve(context: BrowserContext, hosts: Record<string, Host>) {
  const lookups: { ref: string; origin: string | null }[] = [];
  await context.route(`${GC}/widget/v1.js`, (r) => r.fulfill({ contentType: "text/javascript", body: built }));
  await context.route(`${GC}/api/v1/widget/product?*`, (r) => {
    const url = new URL(r.request().url());
    const origin = r.request().headers().origin ?? null;
    const ref = url.searchParams.get("ref") ?? "";
    lookups.push({ ref, origin });
    const cors: Record<string, string> = origin === SHOP ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};
    if (url.searchParams.get("key") !== KEY) return r.fulfill({ status: 403, headers: cors, json: { error: "This key doesn't work on this site." } });
    const p = PRODUCTS[ref] ?? { available: false };
    return r.fulfill({ headers: cors, json: { ...p, price: 1999, url: `${GC}/w/${KEY}/${encodeURIComponent(ref)}` } });
  });
  await context.route(`${GC}/w/**`, (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>Haggle</title><h1>GhostCart haggle page</h1>" }));
  for (const [path, host] of Object.entries(hosts)) await context.route(`${SHOP}${path}`, (r) => r.fulfill({ contentType: "text/html", headers: host.headers, body: host.html }));
  return lookups;
}

/** Console errors and CSP violations on the seller's page: the widget must never cause any. */
function watch(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => (m.type() === "error" || /Content Security Policy|Refused to/i.test(m.text())) && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push(e.message));
  return problems;
}

const button = (page: Page, sku: string) => page.locator(`[data-ghostcart-product="${sku}"]`).getByRole("button", { name: /make an offer|haggle/i });
const tag = (attrs = `data-key="${KEY}" async`) => `<script src="${GC}/widget/v1.js" ${attrs}></script>`;

test.describe("plain HTML page", () => {
  test("shows the button, styled, and opens GhostCart in a new tab with a way back", async ({ page, context }) => {
    const lookups = await serve(context, {
      "/kettle": { html: `<!doctype html><meta name="viewport" content="width=device-width"><h1>ZZ Kettle</h1><div data-ghostcart-product="ZZ-KETTLE" data-label="Haggle for it" data-color="#2e7d32"></div>${tag()}` },
    });
    const problems = watch(page);
    await page.goto(`${SHOP}/kettle`);
    const b = button(page, "ZZ-KETTLE");
    await expect(b).toBeVisible();
    await expect(b).toHaveText("Haggle for it");
    await expect(b).toHaveCSS("background-color", "rgb(46, 125, 50)");
    expect(lookups).toEqual([{ ref: "ZZ-KETTLE", origin: SHOP }]);

    const [popup] = await Promise.all([context.waitForEvent("page"), b.click()]);
    const opened = new URL(popup.url());
    expect(`${opened.origin}${opened.pathname}`).toBe(`${GC}/w/${KEY}/ZZ-KETTLE`);
    expect(opened.searchParams.get("return")).toBe(`${SHOP}/kettle`);
    await expect(popup.locator("h1")).toHaveText("GhostCart haggle page");
    // noopener: the haggle page can't reach back into the seller's page.
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    expect(problems).toEqual([]);
  });

  test("shows nothing, quietly, for sold-out or non-haggle products, a bad key, or a page that isn't allowed", async ({ page, context }) => {
    await serve(context, {
      "/mixed": { html: `<!doctype html><div data-ghostcart-product="ZZ-SOLDOUT"></div><div data-ghostcart-product="ZZ-NOHAGGLE"></div><div data-ghostcart-product="ZZ-UNKNOWN"></div>${tag()}` },
      "/badkey": { html: `<!doctype html><div data-ghostcart-product="ZZ-KETTLE"></div>${tag('data-key="gc_pk_wrong" async')}` },
    });
    const problems = watch(page);
    await page.goto(`${SHOP}/mixed`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button")).toHaveCount(0);
    await page.goto(`${SHOP}/badkey`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button")).toHaveCount(0);
    // The 403 for a bad key is the one expected console line; nothing else may appear.
    expect(problems.filter((p) => !/403/.test(p))).toEqual([]);
  });

  test("falls back to a <style> element in browsers without constructed stylesheets", async ({ page, context }) => {
    await serve(context, { "/old": { html: `<!doctype html><div data-ghostcart-product="ZZ-KETTLE" data-color="#2e7d32"></div>${tag()}` } });
    await page.addInitScript(() => {
      delete (ShadowRoot.prototype as { adoptedStyleSheets?: unknown }).adoptedStyleSheets;
    });
    await page.goto(`${SHOP}/old`);
    await expect(button(page, "ZZ-KETTLE")).toHaveCSS("background-color", "rgb(46, 125, 50)");
  });

  test("warns the developer, and does nothing else, when data-key is missing", async ({ page, context }) => {
    await serve(context, { "/nokey": { html: `<!doctype html><div data-ghostcart-product="ZZ-KETTLE"></div>${tag("async")}` } });
    const warnings: string[] = [];
    page.on("console", (m) => m.type() === "warning" && warnings.push(m.text()));
    await page.goto(`${SHOP}/nokey`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button")).toHaveCount(0);
    expect(warnings.join("\n")).toContain('data-key="gc_pk_');
  });
});

test.describe("strict CSP page", () => {
  // What a security-conscious seller runs: nothing inline, only named origins. GhostCart is allowed
  // for scripts and API calls (what our install docs tell sellers to add), and nothing else.
  const csp = [
    "default-src 'none'",
    `script-src 'self' ${GC}`,
    `connect-src 'self' ${GC}`,
    "style-src 'self'",
    "img-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "require-trusted-types-for 'script'",
  ].join("; ");

  test("renders and styles the button without needing 'unsafe-inline' or any CSP exception beyond GhostCart's origin", async ({ page, context }) => {
    await serve(context, { "/strict": { headers: { "Content-Security-Policy": csp }, html: `<!doctype html><h1>ZZ Strict Shop</h1><div data-ghostcart-product="ZZ-LAMP" data-color="#123456"></div>${tag()}` } });
    const problems = watch(page);
    await page.goto(`${SHOP}/strict`);
    const b = button(page, "ZZ-LAMP");
    await expect(b).toBeVisible();
    await expect(b).toHaveCSS("background-color", "rgb(18, 52, 86)");
    await expect(b).toHaveCSS("border-radius", "10px");
    const [popup] = await Promise.all([context.waitForEvent("page"), b.click()]);
    expect(popup.url()).toContain(`${GC}/w/${KEY}/ZZ-LAMP`);
    expect(problems).toEqual([]);
  });
});

test.describe("Shopify-like theme", () => {
  // A theme: hostile global CSS, a fetch wrapper (analytics), the app-embed script deferred in <head>,
  // the same snippet pasted again by hand, a collection grid, and a variant picker that re-renders the
  // product section by AJAX (replacing the widget's element).
  const theme = `<!doctype html><html><head>
    <style>*{box-sizing:border-box;font-family:Georgia,serif}button{display:none!important;background:red!important}[data-ghostcart-product]{min-height:44px}</style>
    <script>const _f=window.fetch;window.fetch=function(){window.__fetches=(window.__fetches||0)+1;return _f.apply(this,arguments)}</script>
    ${tag(`data-key="${KEY}" defer`)}
  </head><body>
    <main id="product-section"><h1>ZZ Kettle</h1><select id="variant"><option>Steel</option><option>Red</option></select>
      <form action="/cart/add"><button type="submit" id="add">Add to cart</button></form>
      <div class="ghostcart-block" data-ghostcart-product="ZZ-KETTLE"></div></main>
    <section class="collection"><div data-ghostcart-product="ZZ-LAMP"></div><div data-ghostcart-product="ZZ-SOLDOUT"></div></section>
    ${tag()}
    <script>
      document.getElementById("variant").addEventListener("change", (e) => {
        const sku = e.target.value === "Red" ? "ZZ-KETTLE-RED" : "ZZ-KETTLE";
        setTimeout(() => { document.querySelector(".ghostcart-block").outerHTML = '<div class="ghostcart-block" data-ghostcart-product="' + sku + '"></div>'; }, 150);
      });
    </script>
  </body></html>`;

  test("isn't hidden by the theme's CSS, mounts once per product despite two script tags, and follows AJAX re-renders", async ({ page, context }) => {
    const lookups = await serve(context, { "/products/zz-kettle": { html: theme } });
    const problems = watch(page);
    await page.goto(`${SHOP}/products/zz-kettle`);
    await expect(button(page, "ZZ-KETTLE")).toBeVisible();
    await expect(button(page, "ZZ-KETTLE")).toHaveCSS("background-color", "rgb(244, 183, 64)"); // the theme's red doesn't leak in
    await expect(button(page, "ZZ-LAMP")).toBeVisible();
    await expect(page.locator('[data-ghostcart-product="ZZ-SOLDOUT"]').getByRole("button")).toHaveCount(0);
    // The theme hides its own buttons (its CSS); the widget's button is the only one showing.
    await expect(page.locator("#add")).toBeHidden();
    await page.waitForLoadState("networkidle");
    // Two script tags, but each product is looked up and mounted once.
    expect(lookups.filter((l) => l.ref === "ZZ-KETTLE")).toHaveLength(1);
    expect(await page.locator("[data-ghostcart-mounted]").count()).toBe(3);

    await page.selectOption("#variant", "Red");
    await expect(button(page, "ZZ-KETTLE-RED")).toBeVisible();
    await expect(page.locator('[data-ghostcart-product="ZZ-KETTLE"]')).toHaveCount(0);
    // The theme's fetch wrapper saw the widget's calls and nothing broke.
    expect(await page.evaluate(() => (window as unknown as { __fetches: number }).__fetches)).toBeGreaterThanOrEqual(3);
    expect(problems).toEqual([]);
  });
});

test.describe("cart page (GhostCart Privilege)", () => {
  async function serveCart(context: BrowserContext, html: string, opts: { available?: boolean; exitPrompt?: boolean } = {}) {
    const posted: { origin: string | null; body: { key: string; cartRef?: string; items: { ref: string; quantity: number }[]; returnUrl: string } }[] = [];
    await serve(context, { "/cart": { html } });
    await context.route(`${SHOP}/cart.js`, (r) => r.fulfill({ json: { token: "zzcarttoken123?key=abc", items: [{ product_id: 9001, quantity: 1 }, { product_id: 9002, quantity: 2 }] } }));
    await context.route(`${SHOP}/wp-json/wc/store/v1/cart`, (r) => r.fulfill({ json: { items: [{ id: 51, quantity: 1 }] } }));
    await context.route(`${GC}/api/v1/widget/cart`, (r) => {
      const origin = r.request().headers().origin ?? null;
      const cors = { "Access-Control-Allow-Origin": SHOP, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type" };
      if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: cors });
      posted.push({ origin, body: r.request().postDataJSON() });
      return r.fulfill({ headers: cors, json: { available: opts.available ?? true, exitPrompt: opts.exitPrompt ?? false, url: `${GC}/api/v1/widget/cart/cart_zz/open?key=${KEY}` } });
    });
    await context.route(`${GC}/api/v1/widget/cart/**`, (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>Privilege</title><h1>Your private offer</h1>" }));
    return posted;
  }
  const cartButton = (page: Page) => page.locator("[data-ghostcart-cart]").getByRole("button", { name: "Make an offer on your cart" });

  test("reads the Shopify cart the store already shows and opens a private offer on all of it", async ({ page, context }) => {
    const posted = await serveCart(context, `<!doctype html><h1>Your cart</h1><div data-ghostcart-cart="shopify"></div>${tag()}`);
    const problems = watch(page);
    await page.goto(`${SHOP}/cart`);
    await expect(cartButton(page)).toBeVisible();
    expect(posted).toEqual([
      { origin: SHOP, body: { key: KEY, cartRef: "zzcarttoken123", items: [{ ref: "shopify-9001", quantity: 1 }, { ref: "shopify-9002", quantity: 2 }], returnUrl: `${SHOP}/cart` } },
    ]);
    const [popup] = await Promise.all([context.waitForEvent("page"), cartButton(page).click()]);
    expect(new URL(popup.url()).pathname).toBe("/api/v1/widget/cart/cart_zz/open");
    expect(new URL(popup.url()).searchParams.get("return")).toBe(`${SHOP}/cart`);
    expect(problems).toEqual([]);
  });

  test("reads a WooCommerce cart from the Store API, keeping one cart id per browser", async ({ page, context }) => {
    const posted = await serveCart(context, `<!doctype html><div data-ghostcart-cart="woocommerce"></div>${tag()}`);
    await page.goto(`${SHOP}/cart`);
    await expect(cartButton(page)).toBeVisible();
    await page.reload();
    await expect(cartButton(page)).toBeVisible();
    expect(posted.map((p) => p.body.items)).toEqual([[{ ref: "woo-51", quantity: 1 }], [{ ref: "woo-51", quantity: 1 }]]);
    expect(posted[0].body.cartRef).toMatch(/^[0-9a-f]{24}$/);
    expect(posted[1].body.cartRef).toBe(posted[0].body.cartRef);
  });

  test("shows nothing when the seller won't haggle on this cart", async ({ page, context }) => {
    const posted = await serveCart(context, `<!doctype html><div data-ghostcart-cart="shopify"></div>${tag()}`, { available: false });
    await page.goto(`${SHOP}/cart`);
    await expect.poll(() => posted.length).toBe(1);
    await expect(cartButton(page)).toHaveCount(0);
  });

  test("offers once when the shopper heads for the tab bar, if the seller turned the prompt on", async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name === "phone", "Exit intent needs a mouse; phones never see the prompt.");
    await serveCart(context, `<!doctype html><div style="height:400px"></div><div data-ghostcart-cart="shopify"></div>${tag()}`, { exitPrompt: true });
    await page.goto(`${SHOP}/cart`);
    await expect(cartButton(page)).toBeVisible();
    await page.mouse.move(300, 200);
    await page.mouse.move(300, -5);
    await page.evaluate(() => document.dispatchEvent(new MouseEvent("mouseout", { clientY: -1, relatedTarget: null, bubbles: true })));
    const dialog = page.getByRole("dialog", { name: "Private offer on your cart" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);
    await page.reload();
    await expect(cartButton(page)).toBeVisible();
    await page.evaluate(() => document.dispatchEvent(new MouseEvent("mouseout", { clientY: -1, relatedTarget: null, bubbles: true })));
    await expect(dialog).toHaveCount(0);
  });
});
