import { describe, expect, it } from "vitest";
import { pickLang, t } from "./i18n";

describe("shopper languages", () => {
  it("fill in values in either language", () => {
    expect(t("en", "privilege.offerAll", { n: 3 })).toBe("Make an offer on all 3 items");
    expect(t("hi", "privilege.offerAll", { n: 3 })).toBe("सभी 3 सामान के लिए दाम बताएँ");
  });
  it("use the cookie, then the browser's first language, then English", () => {
    expect(pickLang("hi", "en-IN")).toBe("hi");
    expect(pickLang(undefined, "hi-IN,en;q=0.8")).toBe("hi");
    expect(pickLang(undefined, "en-IN,hi;q=0.8")).toBe("en");
    expect(pickLang("fr", undefined)).toBe("en");
  });
});
