import { describe, expect, it } from "vitest";
import { placeOrder, saveAddress } from "../checkout";
import { getDb } from "../db";
import { acceptOffer, markPaid } from "../negotiate";
import { saveDisclosure } from "../shop/disclosure";
import { startShopNegotiation } from "../shop/negotiation";
import { createOrg } from "../shop/orgs";
import { createProduct } from "../shop/products";
import { createStore, updateStore } from "../shop/stores";
import { canDispute, confirmReceivedByBuyer, disputeFor, markShipped } from "./fulfilment";
import { trialBalance } from "./ledger";
import { acceptReturn, declineReturn, escalateUnansweredReturns, requestReturn, returnFor, returnReceived, returnWindowEnd } from "./returns";
import { getOrder, orderForDeal, runOrderJobs } from "./service";

let n = 0;
async function delivered(returnDays: number) {
  n++;
  const org = await createOrg({ name: "ZZ Returns", ownerPhone: `+9190000032${String(n).padStart(2, "0")}`, ownerName: "ZZ" });
  const s = (await updateStore((await createStore({ orgId: org.id, name: "ZZ Returns Store", platform: "ghostcart_shop" })).id, { status: "live", tier: "trusted" }))!;
  await saveDisclosure(s.id, { address: "1 ZZ Test Road", city: "Pune", state: "Maharashtra", pincode: "411001", supportPhone: "9000003299", returnDays, returnPolicy: "Unused items in original packaging can be returned for a full refund." });
  const p = await createProduct(s.id, { title: "ZZ Return Lamp", price: 2000, stock: 5 });
  let deal = await startShopNegotiation(p.id, `ret-buyer-${n}`);
  deal = await acceptOffer(deal);
  deal = await markPaid(deal, "pinelabs");
  deal = await saveAddress(deal, { name: "ZZ Buyer", phone: "+919000003298", line1: `${n} Return Street`, city: "Pune", state: "Maharashtra", pincode: "411001" });
  deal = await placeOrder(deal, "pinelabs");
  const o = (await orderForDeal(deal.id))!;
  await markShipped(o.id, { courier: "Delhivery", awb: `ZZRET${n}0000` }, "seller");
  await confirmReceivedByBuyer(o.id);
  return (await getOrder(o.id))!;
}

describe("returns", () => {
  it("hold the payout through the return window, then refund in full once the item is back", async () => {
    const o = await delivered(7);
    // Trusted sellers are normally paid a day after delivery; the 7-day return window keeps the money held.
    expect((await runOrderJobs(new Date(Date.now() + 2 * 86_400_000))).released).not.toContain(o.id);
    expect(await returnWindowEnd(o)).toBeInstanceOf(Date);
    await requestReturn(o.id, { reason: "changed_mind", details: "Too big for my desk" });
    expect((await getOrder(o.id))?.status).toBe("return_requested");
    await expect(requestReturn(o.id, { reason: "changed_mind", details: "again please" })).rejects.toThrow();
    await acceptReturn(o.id, "Our courier collects it on Friday between 10 and 1.");
    expect((await getOrder(o.id))?.status).toBe("return_accepted");
    await returnReceived(o.id, "seller:zz");
    expect((await getOrder(o.id))?.status).toBe("refunded");
    expect((await returnFor(o.id))?.status).toBe("received");
    expect((await trialBalance(await getDb())).unbalanced).toEqual([]);
  });

  it("refuse when the shop takes no returns", async () => {
    const o = await delivered(0);
    await expect(requestReturn(o.id, { reason: "changed_mind", details: "Not for me" })).rejects.toThrow("doesn't take returns");
  });

  it("after a decline, leave the buyer two days to report a problem, then pay the seller", async () => {
    const o = await delivered(5);
    await requestReturn(o.id, { reason: "not_as_described", details: "Colour is different" });
    await expect(declineReturn(o.id, "no")).rejects.toThrow("Explain");
    await declineReturn(o.id, "The colour matches the photos; this was a change of mind.");
    const after = (await getOrder(o.id))!;
    expect(after.status).toBe("delivered");
    expect(await canDispute(after)).toBe(true);
    expect(await returnWindowEnd(after)).toBeNull(); // one return request per order
    expect((await runOrderJobs(new Date(Date.now() + 3 * 86_400_000))).released).toContain(o.id);
  });

  it("send unanswered returns to staff as a dispute", async () => {
    const o = await delivered(5);
    await requestReturn(o.id, { reason: "damaged", details: "Cracked base" });
    expect(await escalateUnansweredReturns(new Date(Date.now() + 71 * 3600_000))).not.toContain(o.id);
    expect(await escalateUnansweredReturns(new Date(Date.now() + 73 * 3600_000))).toContain(o.id);
    expect((await getOrder(o.id))?.status).toBe("disputed");
    expect((await disputeFor(o.id))?.reason).toBe("damaged");
  });
});
