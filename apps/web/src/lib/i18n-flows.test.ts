import { describe, expect, it } from "vitest";
import { t } from "./i18n";
import { consentHistory, DEAL_CONTACT_WORDING } from "./privacy/consent";
import { startShopNegotiation } from "./shop/negotiation";
import { createOrg } from "./shop/orgs";
import { createProduct } from "./shop/products";
import { createStore, updateStore } from "./shop/stores";
import { signUp } from "./users";

describe("Hindi for shoppers", () => {
  it("opens the haggle in Hindi and keeps the language on the deal for the agent", async () => {
    const org = await createOrg({ name: "ZZ Hindi", ownerPhone: "+919000003101", ownerName: "ZZ" });
    const s = (await updateStore((await createStore({ orgId: org.id, name: "ZZ Hindi Store", platform: "ghostcart_shop" })).id, { status: "live" }))!;
    const p = await createProduct(s.id, { title: "ZZ Kurta", price: 1500, stock: 3 });
    const deal = await startShopNegotiation(p.id, "zz-hindi-buyer", { language: "hi" });
    expect(deal.language).toBe("hi");
    expect(deal.negotiation!.messages[0].text).toMatch(/^ZZ Kurta का दाम ₹1,500 है।/);
  });

  it("records the consent sentence the shopper actually read", async () => {
    const hi = await signUp({ name: "ZZ Hindi Buyer", phone: "+919000003102", channel: "web", consent: true, consentWording: t("hi", "signup.consent") });
    expect((await consentHistory(hi.id))[0].wording).toBe("GhostCart और यह विक्रेता इस डील के बारे में मुझसे इस नंबर पर संपर्क कर सकते हैं। कोई मार्केटिंग नहीं।");
    expect(t("en", "signup.consent")).toBe(DEAL_CONTACT_WORDING);
  });
});
