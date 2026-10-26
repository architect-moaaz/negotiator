import { schema } from "@ghostcart/db";
import { describe, expect, it } from "vitest";
import { placeOrder, saveAddress } from "../checkout";
import { getDb } from "../db";
import { acceptOffer, markPaid } from "../negotiate";
import { markDelivered, orderForDeal, runOrderJobs, getOrder } from "../orders/service";
import { startShopNegotiation } from "../shop/negotiation";
import { createOrg } from "../shop/orgs";
import { createProduct } from "../shop/products";
import { createStore, getStore, updateStore } from "../shop/stores";
import { store as kv } from "../store";
import { clearOrderFlag, MAX_OPEN_NEGOTIATIONS } from "./checks";
import { linkDevice } from "./signals";

let n = 0;
const phone = () => `+9190000015${String(++n).padStart(2, "0")}`;
async function shop(tier: "new" | "verified" = "verified") {
  const owner = phone();
  const org = await createOrg({ name: "ZZ Fraud", ownerPhone: owner, ownerName: "ZZ" });
  const s = (await updateStore((await createStore({ orgId: org.id, name: "ZZ Fraud Store", platform: "ghostcart_shop" })).id, { status: "live", tier }))!;
  const p = await createProduct(s.id, { title: "ZZ Fraud Item", price: 1000, stock: 100 });
  return { owner, org, store: s, product: p };
}
async function shopper(p = phone()) {
  return (await kv.upsertUser({ id: `u_${p.slice(-6)}_${n}`, name: "ZZ Shopper", phone: p, channel: "web", createdAt: Date.now() })).user;
}
const withVid = (vid: string) => new Request("http://test/", { headers: { cookie: `gc_vid=${vid}` } });
const events = async (kind: string) => (await (await getDb()).select().from(schema.riskEvents)).filter((e) => e.kind === kind);

describe("self-dealing", () => {
  it("blocks a seller buying from their own store by phone", async () => {
    const { owner, product } = await shop();
    const u = await shopper(owner);
    await expect(startShopNegotiation(product.id, u.id)).rejects.toThrow("your own store");
    expect((await events("self_dealing")).some((e) => e.subjectId === u.id)).toBe(true);
  });

  it("blocks a shopper on a device the seller signs in from", async () => {
    const { owner, product } = await shop();
    await linkDevice(withVid("zz-shared-device"), "member", owner);
    const u = await shopper();
    await expect(startShopNegotiation(product.id, u.id, { request: withVid("zz-shared-device") })).rejects.toThrow("signed in to the seller's account");
    await expect(startShopNegotiation(product.id, u.id, { request: withVid("zz-other-device") })).resolves.toMatchObject({ status: "negotiating" });
  });
});

describe("velocity and buyer risk", () => {
  it(`caps a shopper at ${MAX_OPEN_NEGOTIATIONS} open haggles`, async () => {
    const { product } = await shop();
    const u = await shopper();
    for (let i = 0; i < MAX_OPEN_NEGOTIATIONS; i++) await startShopNegotiation(product.id, u.id);
    await expect(startShopNegotiation(product.id, u.id)).rejects.toThrow("deals open");
  });

  it("asks a shopper with a run of problem reports to contact support", async () => {
    const { store, product } = await shop();
    const u = await shopper();
    const db = await getDb();
    for (let i = 0; i < 3; i++) {
      const orderId = `ord_zzrisk_${n}_${i}`;
      await db.insert(schema.orders).values({ id: orderId, dealId: `deal_zzrisk_${n}_${i}`, storeId: store.id, orgId: store.orgId, userId: u.id, title: "x", total: 100, fee: 2, gst: 0, sellerShare: 98, lockFee: 9, shipBy: new Date(), address: {} });
      await db.insert(schema.disputes).values({ id: `dsp_zzrisk_${n}_${i}`, orderId, reason: "other", details: "test dispute details" });
    }
    await expect(startShopNegotiation(product.id, u.id)).rejects.toThrow("Contact GhostCart support");
  });
});

describe("flagged orders", () => {
  it("hold the payout when the delivery phone belongs to the seller, until staff clear it", async () => {
    const { owner, product } = await shop();
    const u = await shopper();
    let deal = await startShopNegotiation(product.id, u.id);
    deal = await acceptOffer(deal);
    deal = await markPaid(deal, "pinelabs");
    deal = await saveAddress(deal, { name: "ZZ", phone: owner, line1: `${Math.random().toString(36).slice(2, 8)} Test Street`, city: "Pune", state: "Maharashtra", pincode: "411001" });
    deal = await placeOrder(deal, "pinelabs");
    const order = (await orderForDeal(deal.id))!;
    expect(order.flagged).toContain("delivery phone belongs to the seller");
    await markDelivered(order.id, "test", new Date(Date.now() - 10 * 24 * 60 * 60 * 1000));
    expect((await runOrderJobs()).released).not.toContain(order.id);
    await clearOrderFlag(order.id, "ZZ Staff");
    expect((await runOrderJobs()).released).toContain(order.id);
    expect((await getOrder(order.id))?.status).toBe("completed");
  });
});

describe("one address, many shoppers", () => {
  it("flags the order when more than three shoppers send orders to the same address in a day", async () => {
    const { product } = await shop();
    const line1 = `zz-drop-${n} Collection Point`;
    const orderIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const u = await shopper();
      let deal = await startShopNegotiation(product.id, u.id);
      deal = await acceptOffer(deal);
      deal = await markPaid(deal, "pinelabs");
      deal = await saveAddress(deal, { name: "ZZ", phone: "+919000001598", line1, city: "Pune", state: "Maharashtra", pincode: "411002" });
      deal = await placeOrder(deal, "pinelabs");
      orderIds.push((await orderForDeal(deal.id))!.id);
    }
    expect((await getOrder(orderIds[2]))?.flagged ?? null).toBeNull();
    expect((await getOrder(orderIds[3]))?.flagged).toContain("4 shoppers ordered to this address today");
  });
});

describe("tier promotion", () => {
  it("moves a verified store with a clean record to trusted", async () => {
    const { store } = await shop("verified");
    const db = await getDb();
    await db.insert(schema.orders).values(
      Array.from({ length: 50 }, (_, i) => ({
        id: `ord_zzpromo_${n}_${i}`,
        dealId: `deal_zzpromo_${n}_${i}`,
        storeId: store.id,
        orgId: store.orgId,
        userId: `buyer_${i % 30}`,
        title: "x",
        total: 100,
        fee: 2,
        gst: 0,
        sellerShare: 98,
        lockFee: 9,
        status: "completed",
        shipBy: new Date(),
        address: {},
      })),
    );
    expect((await runOrderJobs()).promoted).toContain(store.id);
    expect((await getStore(store.id))?.tier).toBe("trusted");
  });
});
