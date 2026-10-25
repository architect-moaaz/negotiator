import { accounts } from "@ghostcart/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../db";
import { acceptOffer } from "../negotiate";
import { balance, trialBalance } from "../orders/ledger";
import { startShopNegotiation } from "../shop/negotiation";
import { createOrg } from "../shop/orgs";
import { setPolicy } from "../shop/policies";
import { createProduct } from "../shop/products";
import { createStore, updateStore } from "../shop/stores";
import { store as kv } from "../store";
import { grantCode } from "./adapters";
import { redeemGrant } from "./service";

let n = 0;
async function shopifyStore() {
  const org = await createOrg({ name: "ZZ Shopify Seller", ownerPhone: `+9190000017${String(++n).padStart(2, "0")}`, ownerName: "ZZ" });
  const s = (await updateStore((await createStore({ orgId: org.id, name: "ZZ Shopify Store", platform: "shopify", domain: `zz-shopify-${n}.myshopify.com` })).id, { status: "live" }))!;
  await setPolicy(s.id, "store", null, { maxDiscountPct: 10, autoApprovePct: 5 });
  const p = await createProduct(s.id, { title: "ZZ Shopify Item", price: 2000, stock: 5, sku: `ZZ-SH-${n}` });
  return { store: s, product: p };
}

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe("price grants", () => {
  it("issue a one-time code instead of the ₹9 lock on Shopify stores", async () => {
    const { store, product } = await shopifyStore();
    let deal = await startShopNegotiation(product.id, "grant-buyer-1");
    deal = await acceptOffer(deal);
    expect(deal.status).toBe("granted");
    expect(deal.grant).toMatchObject({ platform: "mock", code: expect.stringMatching(/^GC-[2-9A-HJ-NP-Z]{8}$/) });
    expect(deal.grant!.checkoutUrl).toContain(store.domain);
    expect(deal.pinelabsOrderId).toBeUndefined();
    expect((await kv.getDeal(deal.id))?.status).toBe("granted");
  });

  it("charge the seller GhostCart's fee once when the store reports the order", async () => {
    const { store, product } = await shopifyStore();
    let deal = await startShopNegotiation(product.id, "grant-buyer-2");
    deal = await acceptOffer(deal);
    const redeemed = await redeemGrant({ storeId: store.id, code: deal.grant!.code, platformOrderRef: "#1001" });
    expect(redeemed?.grant?.redeemedAt).toBeTruthy();
    await redeemGrant({ storeId: store.id, code: deal.grant!.code, platformOrderRef: "#1001" }); // webhook retried
    const db = await getDb();
    const due = await balance(db, accounts.sellerFeesDue(store.id));
    const fee = Math.round(deal.dealPrice * 100 * 0.02);
    expect(due).toBe(fee + Math.round(fee * 0.18));
    expect((await trialBalance(db)).unbalanced).toEqual([]);
  });

  it("ignore codes from another store", async () => {
    const a = await shopifyStore();
    const b = await shopifyStore();
    let deal = await startShopNegotiation(a.product.id, "grant-buyer-3");
    deal = await acceptOffer(deal);
    expect(await redeemGrant({ storeId: b.store.id, code: deal.grant!.code, platformOrderRef: "#9" })).toBeNull();
  });

  it("refuse to start when the store's platform isn't connected in production", async () => {
    const { product } = await shopifyStore();
    vi.resetModules();
    process.env.VERCEL_ENV = "production";
    const { startShopNegotiation: start } = await import("../shop/negotiation");
    await expect(start(product.id, "grant-buyer-4")).rejects.toThrow("isn't connected");
  });

  it("make readable, unambiguous codes", () => {
    const codes = new Set(Array.from({ length: 200 }, grantCode));
    expect(codes.size).toBe(200);
    for (const c of codes) expect(c).not.toMatch(/[01IO]/);
  });
});
