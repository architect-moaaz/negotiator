import { describe, expect, it } from "vitest";
import { placeOrder, saveAddress } from "../checkout";
import { getDb } from "../db";
import { acceptOffer, markPaid } from "../negotiate";
import { startShopNegotiation } from "../shop/negotiation";
import { createOrg } from "../shop/orgs";
import { createProduct } from "../shop/products";
import { createStore, updateStore } from "../shop/stores";
import { store as kv } from "../store";
import { canDispute, confirmReceivedByBuyer, confirmWithHandoverCode, markShipped, openDispute, pollTracking, resolveDispute, respondToDispute, shipmentFor } from "./fulfilment";
import { trialBalance } from "./ledger";
import { getOrder, heldFor, orderForDeal, runOrderJobs, storeMoney } from "./service";

let n = 0;
async function order() {
  const org = await createOrg({ name: "ZZ Ship", ownerPhone: `+9190000014${String(++n).padStart(2, "0")}`, ownerName: "ZZ" });
  const s = (await updateStore((await createStore({ orgId: org.id, name: "ZZ Ship Store", platform: "ghostcart_shop" })).id, { status: "live", tier: "verified" }))!;
  const p = await createProduct(s.id, { title: "ZZ Ship Item", price: 2000, stock: 5 });
  let deal = await startShopNegotiation(p.id, `ship-buyer-${n}`);
  deal = await acceptOffer(deal);
  deal = await markPaid(deal, "pinelabs");
  deal = await saveAddress(deal, { name: "ZZ Buyer", phone: "+919000001499", line1: "1 Test Street", city: "Pune", state: "Maharashtra", pincode: "411001" });
  deal = await placeOrder(deal, "pinelabs");
  return { store: s, deal, order: (await orderForDeal(deal.id))! };
}

describe("shipping and delivery", () => {
  it("needs a courier and an AWB, and shows the shopper the shipment", async () => {
    const { order: o, deal } = await order();
    await expect(markShipped(o.id, { courier: "", awb: "ZZ123456" }, "seller")).rejects.toThrow("courier");
    await expect(markShipped(o.id, { courier: "Delhivery", awb: "x" }, "seller")).rejects.toThrow("AWB");
    await markShipped(o.id, { courier: "Delhivery", awb: "zz-123456" }, "seller");
    expect((await getOrder(o.id))?.status).toBe("shipped");
    const updated = await kv.getDeal(deal.id);
    expect(updated?.checkout?.awb).toBe("ZZ-123456");
    expect(updated?.checkout?.tracking?.at(-1)?.stage).toBe("shipped");
  });

  it("confirms delivery from courier tracking", async () => {
    const { order: o } = await order();
    await markShipped(o.id, { courier: "Delhivery", awb: "ZZDLV0001" }, "seller");
    const { delivered } = await pollTracking();
    expect(delivered).toContain(o.id);
    expect((await getOrder(o.id))?.status).toBe("delivered");
  });

  it("confirms delivery with the buyer's handover code, not a wrong one", async () => {
    const { order: o } = await order();
    await markShipped(o.id, { courier: "Blue Dart", awb: "ZZBD123456" }, "seller");
    const code = (await shipmentFor(o.id))!.handoverCode;
    await expect(confirmWithHandoverCode(o.id, code === "0000" ? "1111" : "0000")).rejects.toThrow("doesn't match");
    await confirmWithHandoverCode(o.id, code);
    expect((await getOrder(o.id))?.status).toBe("delivered");
  });

  it("lets the buyer confirm receipt, then releases after the window", async () => {
    const { store, order: o } = await order();
    await markShipped(o.id, { courier: "DTDC", awb: "ZZDT123456" }, "seller");
    await confirmReceivedByBuyer(o.id);
    expect((await runOrderJobs()).released).not.toContain(o.id); // verified tier: 3-day window
    const later = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
    expect((await runOrderJobs(later)).released).toContain(o.id);
    expect((await storeMoney(store.id)).released).toBe(o.sellerShare);
  });
});

describe("disputes", () => {
  it("freeze the payout, then a full refund closes the order", async () => {
    const { store, order: o } = await order();
    await markShipped(o.id, { courier: "Delhivery", awb: "ZZDLV0002" }, "seller");
    await pollTracking();
    expect(await canDispute((await getOrder(o.id))!)).toBe(true);
    await expect(openDispute(o.id, { reason: "damaged", details: "short" })).rejects.toThrow("a little more");
    const d = await openDispute(o.id, { reason: "damaged", details: "Screen cracked on arrival, photos attached." });
    expect((await getOrder(o.id))?.status).toBe("disputed");
    const later = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    expect((await runOrderJobs(later)).released).not.toContain(o.id); // frozen
    await respondToDispute(o.id, "Packed with bubble wrap; courier damage.");
    await expect(resolveDispute(d.id, { outcome: "refunded", note: " " }, "ZZ Staff")).rejects.toThrow("why");
    await resolveDispute(d.id, { outcome: "refunded", note: "Damage confirmed from photos." }, "ZZ Staff");
    expect((await getOrder(o.id))?.status).toBe("refunded");
    expect((await storeMoney(store.id)).held).toBe(0);
    expect((await trialBalance(await getDb())).unbalanced).toEqual([]);
  });

  it("can be settled with a partial refund, and the rest releases to the seller", async () => {
    const { store, order: o } = await order();
    await markShipped(o.id, { courier: "Delhivery", awb: "ZZDLV0003" }, "seller");
    await pollTracking();
    const d = await openDispute(o.id, { reason: "not_as_described", details: "Colour is different from the photo." });
    await resolveDispute(d.id, { outcome: "partial_refund", amount: 20_000, note: "₹200 back for the colour mismatch." }, "ZZ Staff");
    expect((await heldFor(o)).sellerShare).toBe(o.sellerShare - 20_000);
    await runOrderJobs();
    expect((await getOrder(o.id))?.status).toBe("completed");
    expect((await storeMoney(store.id)).released).toBe(o.sellerShare - 20_000);
  });

  it("leave the gateway and the ledger agreeing after a partial refund", async () => {
    const { order: o } = await order();
    const { settlementGateway } = await import("./settlement");
    await markShipped(o.id, { courier: "Delhivery", awb: "ZZDLV0004" }, "seller");
    await pollTracking();
    const d = await openDispute(o.id, { reason: "damaged", details: "Corner dented on arrival, minor." });
    await resolveDispute(d.id, { outcome: "partial_refund", amount: 15_000, note: "₹150 back for the dent." }, "ZZ Staff");
    expect((await settlementGateway()!.settlements(o.id)).held).toBe((await heldFor(o)).sellerShare);
  });

  it("aren't allowed before the delivery window for 'not received', or after the dispute window", async () => {
    const { order: o } = await order();
    await markShipped(o.id, { courier: "Delhivery", awb: "ZZSLOW1234" }, "seller");
    await expect(openDispute(o.id, { reason: "not_received", details: "It hasn't come yet at all." })).rejects.toThrow("delivery window");
  });
});
