import { describe, expect, it } from "vitest";
import { matchProduct, normalizeGtin, normalizeModel, rankMatches, titleTokens } from "./matching";

describe("GTINs", () => {
  it("accept valid EAN-13, UPC-A, EAN-8 and GTIN-14, padded to 14 digits", () => {
    expect(normalizeGtin("8901030865275")).toBe("08901030865275");
    expect(normalizeGtin("036000291452")).toBe("00036000291452");
    expect(normalizeGtin("96385074")).toBe("00000096385074");
    expect(normalizeGtin("8 901030 865275")).toBe("08901030865275");
  });
  it("reject bad check digits, wrong lengths and zeros", () => {
    expect(normalizeGtin("8901030865279")).toBeNull();
    expect(normalizeGtin("12345")).toBeNull();
    expect(normalizeGtin("0000000000000")).toBeNull();
    expect(normalizeGtin("")).toBeNull();
    expect(normalizeGtin(null)).toBeNull();
  });
});

describe("titles and models", () => {
  it("keep units with their numbers and drop filler words", () => {
    expect(titleTokens("Milton Thermosteel Flip Lid Bottle, 1 L, Silver (Pack of 1)")).toEqual(["milton", "thermosteel", "flip", "lid", "bottle", "1l", "silver"]);
  });
  it("compare model numbers on letters and digits", () => {
    expect(normalizeModel("SM-A156E/DS")).toBe("SMA156EDS");
    expect(normalizeModel("Pro")).toBeNull();
  });
});

describe("matching a shopper's item to a seller's product", () => {
  const bottle = { title: "Thermosteel Flip Lid Bottle 1L", brand: "Milton", gtin: "8901030865275", modelNumber: "FL1000" };

  it("same barcode is the same item; a different barcode is not, whatever the title", () => {
    expect(matchProduct({ title: "anything", gtin: "8901030865275" }, bottle)).toMatchObject({ kind: "same_gtin", score: 1 });
    expect(matchProduct({ title: "Milton Thermosteel Flip Lid Bottle 1L", gtin: "036000291452" }, bottle)).toBeNull();
  });

  it("same brand and model is the same item, including a model number inside the title", () => {
    expect(matchProduct({ title: "Bottle", brand: "MILTON", model: "fl-1000" }, bottle)).toMatchObject({ kind: "same_model" });
    expect(matchProduct({ title: "Milton FL1000 Thermosteel 1 L" }, bottle)).toMatchObject({ kind: "same_model" });
  });

  it("calls mostly matching titles similar, but never across brands or sizes", () => {
    expect(matchProduct({ title: "Milton Thermosteel Flip Lid Bottle, 1 L, Silver" }, { ...bottle, gtin: null, modelNumber: null })).toMatchObject({ kind: "similar" });
    expect(matchProduct({ title: "Thermosteel Flip Lid Bottle 1L", brand: "Cello" }, bottle)).toBeNull();
    expect(matchProduct({ title: "Milton Thermosteel Flip Lid Bottle 2 L" }, { ...bottle, gtin: null, modelNumber: null })).toBeNull();
    expect(matchProduct({ title: "Samsung Galaxy A15 5G" }, bottle)).toBeNull();
    expect(matchProduct({ title: "bottle" }, { ...bottle, gtin: null, modelNumber: null })).toBeNull();
  });

  it("rank the same item first, then the better match, then the cheaper one", () => {
    const ranked = rankMatches([
      { id: "similar-cheap", price: 500, match: { kind: "similar" as const, score: 0.9, why: "" } },
      { id: "same-dear", price: 900, match: { kind: "same_gtin" as const, score: 1, why: "" } },
      { id: "same-cheap", price: 800, match: { kind: "same_model" as const, score: 1, why: "" } },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["same-cheap", "same-dear", "similar-cheap"]);
  });
});
