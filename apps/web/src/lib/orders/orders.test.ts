import { describe, expect, it } from "vitest";
import { placeOrder, saveAddress } from "../checkout";
import { getDb } from "../db";
import { acceptOffer, markPaid } from "../negotiate";
import { startShopNegotiation } from "../shop/negotiation";
import { createOrg } from "../shop/orgs";
import { setPolicy } from "../shop/policies";
import { createProduct } from "../shop/products";
import { createStore, updateStore } from "../shop/stores";
import { trialBalance } from "./ledger";
import { getOrder, heldFor, markDelivered, orderForDeal, refundOrder, releaseOrder, runOrderJobs, storeMoney } from "./service";
import { settlementGateway } from "./settlement";

let n = 0;
async function paidShopOrder(price = 10000, tier: "new" | "verified" = "new") {
  const org = await createOrg({ name: "ZZ Money", ownerPhone: `+9190000012${String(++n).padStart(2, "0")}`, ownerName: "ZZ" });
  const s = (await updateStore((await createStore({ orgId: org.id, name: "ZZ Money Store", platform: "ghostcart_shop" })).id, { status: "live", tier }))!;
  await setPolicy(s.id, "store", null, { maxDiscountPct: 10, autoApprovePct: 5 });
  const product = await createProduct(s.id, { title: "ZZ Money Item", price, stock: 5 });
  let deal = await startShopNegotiation(product.id, `buyer-${n}`);
  deal = await acceptOffer(deal);
  deal = await markPaid(deal, "pinelabs");
  deal = await saveAddress(deal, { name: "ZZ Buyer", phone: "+919000001299", line1: `${Math.random().toString(36).slice(2, 8)} Test Street`, city: "Bengaluru", state: "Karnataka", pincode: "560038" });
  deal = await placeOrder(deal, "pinelabs");
  return { store: s, deal, order: (await orderForDeal(deal.id))! };
}

describe("orders and the ledger", () => {
  it("record the split on hold when a shop deal is paid, and the ledger balances", async () => {
    const { store, deal, order } = await paidShopOrder();
    expect(order).toMatchObject({ status: "placed", storeId: store.id, total: deal.dealPrice * 100 });
    expect(order.fee + order.gst + order.sellerShare).toBe(order.total);
    expect(await heldFor(order)).toEqual({ sellerShare: order.sellerShare, fee: order.fee, gst: order.gst });
    expect((await storeMoney(store.id)).held).toBe(order.sellerShare);
    expect(await settlementGateway()!.settlements(order.id)).toMatchObject({ held: order.sellerShare });
    const tb = await trialBalance(await getDb());
    expect(tb.total).toBe(0);
    expect(tb.unbalanced).toEqual([]);
  });

  it("don't double-record a deal paid twice", async () => {
    const { deal, order } = await paidShopOrder();
    const again = await placeOrder(deal, "pinelabs-webhook");
    expect((await orderForDeal(again.id))?.id).toBe(order.id);
  });

  it("release the payout only after delivery and the tier's hold days, once", async () => {
    const { store, order } = await paidShopOrder(10000, "verified");
    await expect(releaseOrder(order.id)).rejects.toThrow("only after delivery");
    const deliveredAt = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000); // verified tier holds 3 days
    await markDelivered(order.id, "courier tracking", deliveredAt);
    const { released } = await runOrderJobs();
    expect(released).toContain(order.id);
    expect((await getOrder(order.id))?.status).toBe("completed");
    expect(await storeMoney(store.id)).toMatchObject({ held: 0, released: order.sellerShare });
    await expect(releaseOrder(order.id)).rejects.toThrow("released");
    expect((await trialBalance(await getDb())).total).toBe(0);
  });

  it("keep the payout held during the dispute window", async () => {
    const { order } = await paidShopOrder();
    await markDelivered(order.id, "buyer tapped received"); // new tier: 7 days
    expect((await runOrderJobs()).released).not.toContain(order.id);
  });

  it("refund partly from the seller's share, then fully, and stay balanced", async () => {
    const { store, order } = await paidShopOrder();
    await refundOrder(order.id, 100_000, "item arrived damaged (partial)", "ZZ Staff");
    expect((await heldFor(order)).sellerShare).toBe(order.sellerShare - 100_000);
    const rest = await heldFor(order);
    const done = await refundOrder(order.id, rest.sellerShare + rest.fee + rest.gst, "returned", "ZZ Staff");
    expect(done?.status).toBe("refunded");
    expect((await storeMoney(store.id)).held).toBe(0);
    await expect(refundOrder(order.id, 100, "again", "ZZ Staff")).rejects.toThrow("already refunded");
    expect((await trialBalance(await getDb())).unbalanced).toEqual([]);
  });

  it("cancel and refund an order the seller didn't ship in time", async () => {
    const { order } = await paidShopOrder();
    const { cancelled } = await runOrderJobs(new Date(order.shipBy.getTime() + 60_000));
    expect(cancelled).toContain(order.id);
    expect((await getOrder(order.id))?.status).toBe("cancelled");
    expect(await settlementGateway()!.settlements(order.id)).toMatchObject({ refunded: order.total });
  });
});
