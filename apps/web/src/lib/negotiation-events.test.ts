import { describe, expect, it } from "vitest";
import { DealConflictError } from "./errors";
import { acceptOffer, decideApproval, submitOffer } from "./negotiate";
import { eventsFor } from "./negotiation-events";
import { startShopNegotiation } from "./shop/negotiation";
import { createOrg } from "./shop/orgs";
import { setPolicy } from "./shop/policies";
import { createProduct } from "./shop/products";
import { createStore, updateStore } from "./shop/stores";
import { store } from "./store";

let n = 0;
async function product() {
  const org = await createOrg({ name: "ZZ Events", ownerPhone: `+9190000080${String(++n).padStart(2, "0")}`, ownerName: "ZZ" });
  const s = (await updateStore((await createStore({ orgId: org.id, name: "ZZ Events Store", platform: "ghostcart_shop" })).id, { status: "live", tier: "verified" }))!;
  await setPolicy(s.id, "store", null, { maxDiscountPct: 10, autoApprovePct: 5 });
  return createProduct(s.id, { title: "ZZ Events Lamp", price: 5000, stock: 5 });
}

describe("deal versions", () => {
  it("refuse a save from a stale copy, so two people acting at once can't overwrite each other", async () => {
    const p = await product();
    const deal = await startShopNegotiation(p.id, "zz-events-a");
    expect(deal.version).toBe(1);
    const seller = (await store.getDeal(deal.id))!;
    const shopper = (await store.getDeal(deal.id))!;
    await acceptOffer(shopper); // the shopper's action lands first
    await expect(submitOffer(seller, 4800)).rejects.toBeInstanceOf(DealConflictError);
    const stored = (await store.getDeal(deal.id))!;
    expect(stored.status).toBe("pending");
    expect(stored.version).toBe(shopper.version);
  });

  it("keep an append-only event log of each step with the version it produced", async () => {
    const p = await product();
    let deal = await startShopNegotiation(p.id, "zz-events-b");
    for (let i = 0; i < 4 && deal.status === "negotiating"; i++) deal = await submitOffer(deal, 4600);
    deal = await decideApproval(deal, "rejected", "ZZ Owner", "seller");
    const events = await eventsFor(deal.id);
    expect(events[0]).toMatchObject({ type: "started", actor: "agent", version: 1, status: "negotiating" });
    expect(events.map((e) => e.type)).toContain("escalated");
    expect(events.at(-1)).toMatchObject({ type: "rejected", actor: "seller", status: "negotiating", version: deal.version });
    const versions = events.map((e) => e.version);
    expect([...versions].sort((a, b) => a - b)).toEqual(versions); // never goes backwards
    expect(await eventsFor(deal.id, events.at(-2)!.id)).toHaveLength(1);
  });
});
