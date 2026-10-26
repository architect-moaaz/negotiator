import { describe, expect, it } from "vitest";
import { registerGrantAdapter, type GrantLine } from "../grants/adapters";
import { acceptOffer } from "../negotiate";
import { createOrg } from "../shop/orgs";
import { setPolicy } from "../shop/policies";
import { createProduct } from "../shop/products";
import { createStore, updateStore } from "../shop/stores";

// A fake platform adapter that records the lines it was asked to discount (Shopify/Woo have their own tests).
await import("../grants/registry");
const issued: { code: string; discountInr: number; lines?: GrantLine[] }[] = [];
registerGrantAdapter("shopify", {
  platform: "test",
  async ready() {
    return true;
  },
  async createGrant({ store, code, discountInr, lines }) {
    issued.push({ code, discountInr, lines });
    return { checkoutUrl: `https://${store.domain}/cart?discount=${code}` };
  },
});
const { redeemGrant } = await import("../grants/service");
const { captureCart, completeCart, getCart, markAbandoned } = await import("./carts");
const { createInvite, resolveInvite } = await import("./invites");
const { startCartNegotiation } = await import("./negotiation");
const { getRecovery, setRecovery } = await import("./settings");

let n = 0;
async function storeWithCart(opts: { recovery?: boolean } = {}) {
  n++;
  const org = await createOrg({ name: "ZZ Privilege Seller", ownerPhone: `+9190000019${String(n).padStart(2, "0")}`, ownerName: "ZZ" });
  const s = (await updateStore((await createStore({ orgId: org.id, name: "ZZ Privilege Store", platform: "shopify", domain: `zz-priv-${n}.myshopify.com` })).id, { status: "live" }))!;
  await setPolicy(s.id, "store", null, { maxDiscountPct: 10, autoApprovePct: 5 });
  if (opts.recovery !== false) await setRecovery(s.id, { enabled: true, maxDiscountPct: 20, autoApprovePct: 10 });
  const a = await createProduct(s.id, { title: "ZZ Kettle", price: 2000, stock: 5, sku: `shopify-${n}01` });
  const b = await createProduct(s.id, { title: "ZZ Mugs", price: 500, stock: 20, sku: `shopify-${n}02` });
  return { store: s, a, b };
}

describe("GhostCart Privilege carts", () => {
  it("price carts from the catalogue and drop items GhostCart doesn't know", async () => {
    const { store, a, b } = await storeWithCart();
    const cart = await captureCart({
      storeId: store.id,
      source: "widget",
      items: [
        { ref: a.sku!, quantity: 1 },
        { ref: b.id, quantity: 3 },
        { ref: "shopify-nope", quantity: 1 },
      ],
    });
    expect(cart.lines.map((l) => [l.productId, l.quantity, l.unitPrice])).toEqual([
      [a.id, 1, 2000],
      [b.id, 3, 500],
    ]);
    expect(cart.subtotal).toBe(3500);
    expect(cart.status).toBe("open");
  });

  it("keep contact details only when the shopper agreed to a recovery offer", async () => {
    const { store, a } = await storeWithCart();
    const contact = { email: " ZZ.Shopper@Example.com ", phone: "098765 43210", name: "ZZ Shopper" };
    const without = await captureCart({ storeId: store.id, source: "woo_checkout", externalRef: "w1", items: [{ ref: a.sku!, quantity: 1 }], contact });
    expect([without.email, without.phone, without.consentAt]).toEqual([null, null, null]);
    const withConsent = await captureCart({ storeId: store.id, source: "woo_checkout", externalRef: "w2", items: [{ ref: a.sku!, quantity: 1 }], contact, consent: true });
    expect(withConsent).toMatchObject({ email: "zz.shopper@example.com", phone: "+919876543210", name: "ZZ Shopper" });
    expect(withConsent.consentAt).toBeTruthy();
  });

  it("update one cart per checkout and never reopen a finished one", async () => {
    const { store, a, b } = await storeWithCart();
    const first = await captureCart({ storeId: store.id, source: "woo_checkout", externalRef: "o-7", items: [{ ref: a.sku!, quantity: 1 }] });
    const again = await captureCart({ storeId: store.id, source: "woo_checkout", externalRef: "o-7", items: [{ ref: a.sku!, quantity: 1 }, { ref: b.sku!, quantity: 1 }] });
    expect(again.id).toBe(first.id);
    expect(again.lines).toHaveLength(2);
    await completeCart(store.id, "woo_checkout", "o-7");
    const after = await captureCart({ storeId: store.id, source: "woo_checkout", externalRef: "o-7", items: [{ ref: a.sku!, quantity: 2 }] });
    expect(after.status).toBe("completed");
    expect(after.lines).toHaveLength(2);
  });

  it("mark carts abandoned only after the seller's delay", async () => {
    const { store, a } = await storeWithCart();
    const cart = await captureCart({ storeId: store.id, source: "widget", items: [{ ref: a.sku!, quantity: 1 }] });
    expect(await markAbandoned(store.id, 60, new Date(Date.now() + 30 * 60_000))).toHaveLength(0);
    const marked = await markAbandoned(store.id, 60, new Date(Date.now() + 61 * 60_000));
    expect(marked.map((c) => c.id)).toEqual([cart.id]);
  });
});

describe("GhostCart Privilege invites", () => {
  it("open with the token only, and close once the cart is done or the invite expires", async () => {
    const { store, a } = await storeWithCart();
    const cart = await captureCart({ storeId: store.id, source: "widget", items: [{ ref: a.sku!, quantity: 1 }] });
    const { token, url } = await createInvite(cart.id, "email");
    expect(url).toContain(`/p/${token}`);
    expect(await resolveInvite("x".repeat(32))).toBeUndefined();
    const ok = await resolveInvite(token);
    expect(ok?.cart.id).toBe(cart.id);
    expect(ok?.closed).toBeUndefined();
    expect((await resolveInvite(token))?.invite.openedAt).toBeTruthy();
    expect((await resolveInvite(token, Date.now() + 49 * 3600_000))?.closed).toMatch(/expired/);
    const { updateCart } = await import("./carts");
    await updateCart(cart.id, { status: "opted_out" });
    expect((await resolveInvite(token))?.closed).toMatch(/stopped/);
  });
});

describe("GhostCart Privilege bundle haggles", () => {
  it("haggle on the whole cart within the summed recovery limits", async () => {
    const { store, a, b } = await storeWithCart();
    const cart = await captureCart({ storeId: store.id, source: "widget", items: [{ ref: a.sku!, quantity: 1 }, { ref: b.sku!, quantity: 2 }] });
    const deal = await startCartNegotiation(cart.id, "priv-buyer-1");
    const terms = deal.negotiation!.terms;
    expect(terms.benchmark).toBe(3000);
    // Recovery limits (20% max, 10% alone) replace the store's normal 10% / 5%.
    expect(terms.floor).toBe(2400);
    expect(terms.autoLimit).toBe(2700);
    expect(terms.opening).toBeLessThan(3000);
    expect(terms.opening).toBeGreaterThanOrEqual(terms.autoLimit);
    expect(deal.cart?.lines.map((l) => l.quantity)).toEqual([1, 2]);
    expect(deal.product.title).toBe("Your cart: 3 items from ZZ Privilege Store");
    expect((await getCart(cart.id))).toMatchObject({ status: "negotiating", dealId: deal.id, userId: "priv-buyer-1" });
    // Starting again returns the same live deal.
    expect((await startCartNegotiation(cart.id, "priv-buyer-1")).id).toBe(deal.id);
  });

  it("issue one code for every line, split so the discounts add up, and recover the cart on the order", async () => {
    const { store, a, b } = await storeWithCart();
    const cart = await captureCart({ storeId: store.id, source: "widget", items: [{ ref: a.sku!, quantity: 1 }, { ref: b.sku!, quantity: 2 }] });
    let deal = await startCartNegotiation(cart.id, "priv-buyer-2");
    deal = await acceptOffer(deal);
    expect(deal.status).toBe("granted");
    const grant = issued.find((g) => g.code === deal.grant!.code)!;
    expect(grant.lines?.map((l) => [l.product.id, l.quantity])).toEqual([
      [a.id, 1],
      [b.id, 2],
    ]);
    const total = grant.lines!.reduce((s, l) => s + l.discountInr, 0);
    expect(total).toBe(3000 - deal.dealPrice);
    expect(grant.discountInr).toBe(total);
    await redeemGrant({ storeId: store.id, code: deal.grant!.code, platformOrderRef: "#2001" });
    expect((await getCart(cart.id))?.status).toBe("recovered");
  });

  it("refuse when the seller hasn't turned on cart recovery", async () => {
    const { store, a } = await storeWithCart({ recovery: false });
    expect((await getRecovery(store.id)).enabled).toBe(false);
    const cart = await captureCart({ storeId: store.id, source: "widget", items: [{ ref: a.sku!, quantity: 1 }] });
    await expect(startCartNegotiation(cart.id, "priv-buyer-3")).rejects.toThrow("isn't making private offers");
  });

  it("refuse items that sold out since the cart was saved", async () => {
    const { store, a } = await storeWithCart();
    const cart = await captureCart({ storeId: store.id, source: "widget", items: [{ ref: a.sku!, quantity: 6 }] });
    await expect(startCartNegotiation(cart.id, "priv-buyer-4")).rejects.toThrow("Only 5");
  });
});
