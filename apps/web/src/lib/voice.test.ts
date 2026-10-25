import { describe, expect, it } from "vitest";
import { interpretByKeywords, parseSpokenPrice, shortTitle } from "./voice-agent";

describe("parseSpokenPrice", () => {
  it("reads digits, k, and spoken numbers", () => {
    expect(parseSpokenPrice("make it 19,000")).toBe(19000);
    expect(parseSpokenPrice("19k")).toBe(19000);
    expect(parseSpokenPrice("tell them nineteen thousand five hundred")).toBe(19500);
    expect(parseSpokenPrice("19 thousand 200 rupees")).toBe(19200);
    expect(parseSpokenPrice("₹18800")).toBe(18800);
    expect(parseSpokenPrice("yes approve it")).toBeUndefined();
  });
});

describe("interpretByKeywords", () => {
  it("maps common replies, including Hinglish", () => {
    expect(interpretByKeywords("yes go ahead", false)).toEqual({ intent: "approve" });
    expect(interpretByKeywords("haan theek hai", false)).toEqual({ intent: "approve" });
    expect(interpretByKeywords("no, reject it", false)).toEqual({ intent: "reject" });
    expect(interpretByKeywords("nahi", false)).toEqual({ intent: "reject" });
    expect(interpretByKeywords("offer them 19000", false)).toEqual({ intent: "counter", price: 19000 });
    expect(interpretByKeywords("yes confirm", true)).toEqual({ intent: "confirm" });
    expect(interpretByKeywords("what was that", false)).toEqual({ intent: "unclear" });
  });
});

describe("shortTitle", () => {
  it("keeps the first few words for TTS", () => {
    expect(shortTitle("Sony WH-1000XM5 Best Active Noise Cancelling Wireless Bluetooth Over Ear Headphones, Black")).toBe("Sony WH-1000XM5 Best Active Noise Cancelling");
    expect(shortTitle("Apple iPhone 15 (128 GB) - Black")).toBe("Apple iPhone 15");
  });
});

describe("voice callback signing", () => {
  it("accepts its own signature and rejects others", async () => {
    process.env.VOBIZ_WEBHOOK_SECRET = "test-secret";
    const { signDeal, verifyDealSignature } = await import("./vobiz");
    expect(verifyDealSignature("abc123", signDeal("abc123"))).toBe(true);
    expect(verifyDealSignature("abc124", signDeal("abc123"))).toBe(false);
    expect(verifyDealSignature("abc123", "forged")).toBe(false);
  });
});
