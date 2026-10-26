import { describe, expect, it } from "vitest";
import { gstinCheckChar, isValidAccountNumber, isValidGstin, isValidIfsc, isValidPan, maskAccount, maskPan, panFromGstin, panHolderType } from "./identity";

describe("identity formats", () => {
  it("checks PANs and reads the holder type", () => {
    expect(isValidPan("ABCPE1234F")).toBe(true);
    expect(isValidPan("abcce1234f")).toBe(true);
    expect(isValidPan("ABCXE1234F")).toBe(false); // X isn't a holder type
    expect(isValidPan("ABCPE12345")).toBe(false);
    expect(panHolderType("ABCPE1234F")).toBe("individual");
    expect(panHolderType("ABCCE1234F")).toBe("company");
  });

  it("checks GSTINs including the check character", () => {
    const body = "27ABCCE1234F1Z";
    const gstin = body + gstinCheckChar(body);
    expect(isValidGstin(gstin)).toBe(true);
    expect(panFromGstin(gstin)).toBe("ABCCE1234F");
    const wrong = body + (gstinCheckChar(body) === "A" ? "B" : "A");
    expect(isValidGstin(wrong)).toBe(false);
    expect(isValidGstin("00ABCCE1234F1Z5")).toBe(false); // no state 00
  });

  it("matches the published GSTN example", () => {
    // GSTN's public worked example for the check digit algorithm.
    expect(gstinCheckChar("27AAPFU0939F1Z")).toBe("V");
  });

  it("checks IFSC and account numbers, and masks for display", () => {
    expect(isValidIfsc("HDFC0001234")).toBe(true);
    expect(isValidIfsc("HDFC1001234")).toBe(false);
    expect(isValidAccountNumber("123456789012")).toBe(true);
    expect(isValidAccountNumber("12345")).toBe(false);
    expect(maskPan("ABCPE1234F")).toBe("ABC•••••4F");
    expect(maskAccount("123456789012")).toBe("••••••••9012");
  });
});
