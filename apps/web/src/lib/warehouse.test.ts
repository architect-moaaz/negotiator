import { describe, expect, it } from "vitest";
import { placeOrder, saveAddress } from "./checkout";
import { acceptOffer, decideApproval, markPaid, submitOffer } from "./negotiate";
import { startShopNegotiation } from "./shop/negotiation";
import { createOrg } from "./shop/orgs";
import { setPolicy } from "./shop/policies";
import { createProduct } from "./shop/products";
import { createStore, updateStore } from "./shop/stores";
import { istDay, istDayBounds, metricsFor, rollupDay, summarise } from "./warehouse";

describe("IST days", () => {
  it("cut over at midnight India time, not UTC", () => {
    expect(istDay(Date.parse("2026-10-25T18:29:59Z"))).toBe("2026-10-25");
    expect(istDay(Date.parse("2026-10-25T18:30:00Z"))).toBe("2026-10-26");
    const { start, end } = istDayBounds("2026-10-26");
    expect(start.toISOString()).toBe("2026-10-25T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-10-26T18:30:00.000Z");
    expect(() => istDayBounds("26/10/2026")).toThrow();
  });
});

describe("daily rollup", () => {
  it("counts haggles, agreements, escalations and orders per store, and re-runs cleanly", async () => {
    const org = await createOrg({ name: "ZZ Metrics", ownerPhone: "+919000005001", ownerName: "ZZ Owner" });
    const s = (await updateStore((await createStore({ orgId: org.id, name: "ZZ Metrics Store", platform: "ghostcart_shop" })).id, { status: "live", tier: "verified" }))!;
    await setPolicy(s.id, "store", null, { maxDiscountPct: 10, autoApprovePct: 5 });
    const p = await createProduct(s.id, { title: "ZZ Metrics Fan", price: 2000, stock: 10 });

    // 1: the agent's opening offer accepted, and ordered.
    let a = await startShopNegotiation(p.id, "zz-metrics-a");
    a = await acceptOffer(a);
    a = await markPaid(a, "pinelabs");
    a = await saveAddress(a, { name: "ZZ Buyer", phone: "+919000005099", line1: `${Math.random().toString(36).slice(2, 8)} Metrics Lane`, city: "Pune", state: "Maharashtra", pincode: "411001" });
    a = await placeOrder(a, "pinelabs");
    // 2: lowball past the auto-approve limit, escalated, the seller rejects.
    let b = await startShopNegotiation(p.id, "zz-metrics-b");
    for (let i = 0; i < 4 && b.status === "negotiating"; i++) b = await submitOffer(b, 1840);
    expect(b.status).toBe("awaiting_approval");
    b = await decideApproval(b, "rejected", "ZZ Owner", "seller");
    // 3: started and left.
    await startShopNegotiation(p.id, "zz-metrics-c");

    const today = istDay(Date.now());
    await rollupDay(today);
    await rollupDay(today); // idempotent
    const rows = await metricsFor({ storeId: s.id }, today, today);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ orgId: org.id, negotiations: 3, agreed: 1, escalated: 1, humanRejected: 1, humanApproved: 0, orders: 1, gmv: a.dealPrice * 100, listValue: 200_000, agreedValue: a.dealPrice * 100 });
    expect(a.dealPrice).toBeLessThan(2000);

    const sum = summarise(rows);
    expect(sum.agreeRate).toBeCloseTo(1 / 3);
    expect(sum.escalationRate).toBeCloseTo(1 / 3);
    expect(sum.averageDiscount).toBeCloseTo(1 - a.dealPrice / 2000);
    expect(await metricsFor({ orgId: org.id }, "2020-01-01", "2020-01-31")).toEqual([]);
  });
});
