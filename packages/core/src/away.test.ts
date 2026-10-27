import { describe, expect, it } from "vitest";
import { awayRuleActive, awayRuleApproves, validateAwayRule, type AwayRule } from "./away";

const rule: AwayRule = { enabled: true, maxPctOff: 12, days: [1, 2, 3, 4, 5], startHour: 21, endHour: 9 };
// Monday 2026-11-02. IST = UTC+5:30.
const ist = (dayOfMonth: number, h: number, m = 0) => new Date(Date.UTC(2026, 10, dayOfMonth, h, m) - 330 * 60_000);

describe("away approval rule", () => {
  it("runs overnight from the chosen days, including the small hours after them", () => {
    expect(awayRuleActive(rule, ist(2, 22))).toBe(true); // Monday 10pm
    expect(awayRuleActive(rule, ist(3, 8, 59))).toBe(true); // Tuesday 8:59am, Monday night's window
    expect(awayRuleActive(rule, ist(3, 9))).toBe(false);
    expect(awayRuleActive(rule, ist(2, 3))).toBe(false); // Monday 3am belongs to Sunday night, not chosen
    expect(awayRuleActive({ ...rule, enabled: false }, ist(2, 22))).toBe(false);
  });
  it("approves only down to its discount, and never below the floor", () => {
    const terms = { benchmark: 10_000, floor: 9_000 };
    expect(awayRuleApproves(rule, ist(2, 22), 8_800, terms)).toBe(false); // 12% off but under the floor
    expect(awayRuleApproves(rule, ist(2, 22), 9_000, terms)).toBe(true);
    expect(awayRuleApproves({ ...rule, maxPctOff: 5 }, ist(2, 22), 9_400, terms)).toBe(false);
    expect(awayRuleApproves(rule, ist(2, 12), 9_500, terms)).toBe(false); // daytime: the seller decides
  });
  it("check what sellers enter", () => {
    expect(validateAwayRule({ ...rule, maxPctOff: 95 })).toHaveLength(1);
    expect(validateAwayRule({ ...rule, days: [] })).toHaveLength(1);
    expect(validateAwayRule({ ...rule, startHour: 9, endHour: 9 })).toHaveLength(1);
    expect(validateAwayRule(rule)).toEqual([]);
  });
});
