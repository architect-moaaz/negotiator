import { describe, expect, it } from "vitest";
import { inr, shortTitle, timeAgo } from "./format";

describe("format", () => {
  it("formats rupees with Indian grouping", () => {
    expect(inr(1234567)).toBe("₹12,34,567");
  });

  it("shortens marketplace titles without a dangling connector", () => {
    expect(shortTitle("Sony WH-1000XM5 Best Active Noise Cancelling with Mic (Black)")).toBe("Sony WH-1000XM5 Best Active Noise Cancelling");
    expect(shortTitle("Boat Airdopes 141, 42H Playtime")).toBe("Boat Airdopes 141");
  });

  it("describes elapsed time", () => {
    expect(timeAgo(0, 30_000)).toBe("30s ago");
    expect(timeAgo(0, 5 * 60_000)).toBe("5m ago");
    expect(timeAgo(0, 2 * 3600_000)).toBe("2h ago");
  });
});
