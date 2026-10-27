import { describe, expect, it } from "vitest";
import type { DailyMetrics } from "../warehouse";
import { sellerResults } from "./results";

const day = (over: Partial<DailyMetrics>): DailyMetrics => ({
  day: "2026-10-20",
  storeId: "st_zz",
  orgId: "org_zz",
  negotiations: 0,
  agreed: 0,
  escalated: 0,
  humanApproved: 0,
  humanRejected: 0,
  listValue: 0,
  agreedValue: 0,
  totalRounds: 0,
  orders: 0,
  gmv: 0,
  fees: 0,
  refunds: 0,
  disputes: 0,
  computedAt: new Date(),
  ...over,
});

describe("seller results", () => {
  it("add up sales, the discounts that bought them, fees with GST, and what the seller kept", () => {
    const r = sellerResults([
      day({ negotiations: 10, agreed: 4, escalated: 2, humanApproved: 1, listValue: 1_000_000, agreedValue: 920_000, orders: 3, gmv: 690_000, fees: 13_800 }),
      day({ day: "2026-10-21", negotiations: 5, agreed: 1, listValue: 200_000, agreedValue: 190_000, refunds: 50_000 }),
    ]);
    expect(r).toMatchObject({ haggles: 15, deals: 5, closedByAgent: 4, cameToYou: 2, sales: 11_100, discounts: 900, paidOnGhostCart: 6_900, fees: 163, refunds: 500 });
    expect(r.keptFromGhostCartOrders).toBe(6_900 - 500 - 163);
    expect(r.averageDiscount).toBeCloseTo(900 / 12_000);
  });
  it("is all zeros with no activity", () => {
    expect(sellerResults([])).toMatchObject({ haggles: 0, sales: 0, agreeRate: 0, keptFromGhostCartOrders: 0 });
  });
});
