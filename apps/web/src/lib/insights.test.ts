import { describe, expect, it } from "vitest";
import { userInsights } from "./insights";
import type { Activity, Deal, User } from "./types";

const user = (id: string, name: string): User => ({ id, name, phone: "+919845012345", channel: "web", createdAt: 1 });
const deal = (id: string, userId: string, extra: Partial<Deal>): Deal =>
  ({ id, userId, status: "expired", lockFee: 9, dealPrice: 5049, saved: 450, ...extra }) as Deal;

describe("userInsights", () => {
  it("counts logins from signup events and purchases from deals", () => {
    const now = Date.now();
    const activity: Activity[] = [
      { at: now - 1000, type: "signup", actor: "user", userId: "a", detail: "Asha signed back in via web" },
      { at: now - 5000, type: "signup", actor: "user", userId: "a", detail: "Asha signed up via web" },
      { at: now - 9000, type: "signup", actor: "user", userId: "b", detail: "Ravi signed up via web" },
    ];
    const deals = [
      deal("d1", "a", { status: "paid", checkout: { status: "ordered", openedAt: 0, dueAt: 0, amount: 5040, tracking: [{ stage: "delivered", at: now }] } }),
      deal("d2", "b", { status: "paid", checkout: { status: "lapsed", openedAt: 0, dueAt: 0, amount: 5040 } }),
      deal("d3", "b", {}),
    ];
    const r = userInsights([user("a", "Asha"), user("b", "Ravi")], deals, activity, now);

    expect(r.totals).toMatchObject({ users: 2, logins: 3, loggedInToday: 2, negotiated: 2, locked: 2, bought: 1, delivered: 1, lockFees: 18, orderValue: 5049, saved: 450 });
    const asha = r.users.find((u) => u.id === "a")!;
    expect(asha).toMatchObject({ logins: 2, bought: 1, spent: 5049, phone: "+91 98xxxxx345" });
    expect(r.recentLogins[0]).toMatchObject({ name: "Asha", returning: true });
  });
});
