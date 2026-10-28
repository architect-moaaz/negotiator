import { afterEach, describe, expect, it, vi } from "vitest";
import { submitOffer } from "../negotiate";
import { applyAutoPct, setAwayRule } from "./automation";
import { startShopNegotiation } from "./negotiation";
import { createOrg } from "./orgs";
import { policyForProduct, setPolicy, storePolicies } from "./policies";
import { createProduct } from "./products";
import { createStore, updateStore } from "./stores";

afterEach(() => {
  vi.useRealTimers();
});

let n = 0;
async function shop() {
  n++;
  const org = await createOrg({ name: "ZZ Away", ownerPhone: `+9190000035${String(n).padStart(2, "0")}`, ownerName: "ZZ" });
  const s = (await updateStore((await createStore({ orgId: org.id, name: "ZZ Away Store", platform: "ghostcart_shop" })).id, { status: "live", tier: "verified" }))!;
  await setPolicy(s.id, "store", null, { maxDiscountPct: 15, autoApprovePct: 5 });
  const p = await createProduct(s.id, { title: "ZZ Away Lamp", price: 10_000, stock: 5 });
  return { store: s, product: p };
}

// Monday 2 Nov 2026, 22:00 IST.
const NIGHT = new Date(Date.UTC(2026, 10, 2, 22, 0) - 330 * 60_000);

describe("away rule", () => {
  it("approves an offer at night that would have gone to the seller, without calling them", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NIGHT);
    const { store, product } = await shop();
    await setAwayRule(store.id, { enabled: true, maxPctOff: 10, days: [1], startHour: 21, endHour: 9 });
    let deal = await startShopNegotiation(product.id, `away-buyer-${n}`);
    for (let i = 0; i < 6 && deal.status === "negotiating"; i++) deal = await submitOffer(deal, 9_100);
    expect(deal.negotiation!.approval).toMatchObject({ decision: "approved", decidedBy: "ZZ Away Store's away rule" });
    expect(deal.status).toBe("pending");
  });

  it("leaves offers beyond its discount for the seller", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NIGHT);
    const { store, product } = await shop();
    await setAwayRule(store.id, { enabled: true, maxPctOff: 6, days: [1], startHour: 21, endHour: 9 });
    let deal = await startShopNegotiation(product.id, `away-buyer-b-${n}`);
    for (let i = 0; i < 6 && deal.status === "negotiating"; i++) deal = await submitOffer(deal, 9_100);
    expect(deal.status).toBe("awaiting_approval");
    expect(deal.negotiation!.approval?.decision).toBeUndefined();
  });

  it("rejects nonsense settings", async () => {
    const { store } = await shop();
    await expect(setAwayRule(store.id, { days: [] })).rejects.toThrow("day");
  });
});

describe("playbook apply", () => {
  it("raises only the agent-alone limit, keeping the product's other rules", async () => {
    const { store, product } = await shop();
    await setPolicy(store.id, "product", product.id, { maxDiscountPct: 12, maxRounds: 4 });
    await applyAutoPct(store.id, product.id, 9);
    expect((await storePolicies(store.id)).products.get(product.id)).toMatchObject({ maxDiscountPct: 12, maxRounds: 4, autoApprovePct: 9 });
    expect((await policyForProduct(product)).autoApprovePct).toBe(9);
  });
});
