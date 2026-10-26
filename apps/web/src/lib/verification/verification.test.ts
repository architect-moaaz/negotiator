import { gstinCheckChar } from "@ghostcart/core";
import { describe, expect, it } from "vitest";
import { startShopNegotiation } from "../shop/negotiation";
import { createOrg } from "../shop/orgs";
import { createProduct } from "../shop/products";
import { saveDisclosure } from "../shop/disclosure";
import { createStore, getStore, updateStore } from "../shop/stores";
import { namesMatch } from "./kyc-provider";
import { checkMetaTag } from "./ownership";
import { addOwnershipPhoto, checkDomainOwnership, decideReview, ownershipToken, pendingReviews, saveBankAccount, saveBusinessDetails, submitForReview, verificationChecklist } from "./service";

let n = 0;
async function draft(platform: "ghostcart_shop" | "website" = "ghostcart_shop", domain?: string) {
  const org = await createOrg({ name: `ZZ Verify ${++n}`, ownerPhone: `+9190000010${String(n).padStart(2, "0")}`, ownerName: "ZZ Owner" });
  return createStore({ orgId: org.id, name: `ZZ Verify Store ${n}`, platform, domain });
}
const details = { address: "12 ZZ Test Road", city: "Pune", state: "Maharashtra", pincode: "411001", supportPhone: "9000001099", returnDays: 7, returnPolicy: "Unused items can be returned within 7 days; refunds within 5 working days." };
const gstinFor = (pan: string, state = "29") => `${state}${pan}1Z${gstinCheckChar(`${state}${pan}1Z`)}`;

describe("names", () => {
  it("match despite case, suffixes and initials", () => {
    expect(namesMatch("RAVI KUMAR SHARMA", "Ravi Kumar Sharma")).toBe(true);
    expect(namesMatch("R K Sharma", "Ravi Kumar Sharma")).toBe(true);
    expect(namesMatch("Sharma Electronics Pvt Ltd", "SHARMA ELECTRONICS PRIVATE LIMITED")).toBe(true);
    expect(namesMatch("Someone Else", "Ravi Kumar Sharma")).toBe(false);
  });
});

describe("business and bank checks", () => {
  it("never store the raw PAN or account number", async () => {
    const s = await draft();
    const [pan] = await saveBusinessDetails(s.orgId, { legalName: "ZZ Ravi Sharma", businessType: "individual", pan: "ABCPS1234K" });
    expect(pan).toMatchObject({ type: "pan", status: "passed", masked: "ABC•••••4K" });
    expect(JSON.stringify(pan)).not.toContain("ABCPS1234K");
    const bank = await saveBankAccount(s.orgId, { holderName: "ZZ Ravi Sharma", account: "123456789012", ifsc: "HDFC0001234" });
    expect(bank).toMatchObject({ status: "passed", masked: "••••••••9012 · HDFC0001234" });
    expect(JSON.stringify(bank)).not.toContain("123456789012");
  });

  it("explain bad input and require a GSTIN that carries the same PAN for companies", async () => {
    const s = await draft();
    await expect(saveBusinessDetails(s.orgId, { legalName: "ZZ Co", businessType: "company", pan: "ABCCS1234K" })).rejects.toThrow("need a GSTIN");
    await expect(saveBusinessDetails(s.orgId, { legalName: "ZZ Co", businessType: "company", pan: "ABCCS1234K", gstin: gstinFor("ZYXCS9876K") })).rejects.toThrow("doesn't match");
    await expect(saveBusinessDetails(s.orgId, { legalName: "ZZ Co", businessType: "company", pan: "BAD" })).rejects.toThrow("doesn't look right");
    const checks = await saveBusinessDetails(s.orgId, { legalName: "ZZ Co", businessType: "company", pan: "ABCCS1234K", gstin: gstinFor("ABCCS1234K") });
    expect(checks.map((c) => `${c.type}:${c.status}`)).toEqual(["pan:passed", "gstin:passed"]);
  });

  it("send a reused PAN or a mismatched bank name to a reviewer", async () => {
    const first = await draft();
    await saveBusinessDetails(first.orgId, { legalName: "ZZ Shared Owner", businessType: "individual", pan: "ABCPD5555K" });
    const second = await draft();
    const [pan] = await saveBusinessDetails(second.orgId, { legalName: "ZZ Shared Owner", businessType: "individual", pan: "ABCPD5555K" });
    expect(pan.status).toBe("manual_review");
    expect(pan.details.duplicateOf).toBe(first.orgId);
    const bank = await saveBankAccount(second.orgId, { holderName: "ZZ Shared Owner", account: "998877660000", ifsc: "ICIC0004321" }); // sandbox returns another name
    expect(bank.status).toBe("manual_review");
    expect(bank.details.nameMatches).toBe(false);
  });
});

describe("ownership", () => {
  it("finds the meta tag only on the seller's own domain", async () => {
    const token = "abc123";
    const page = (url: string, html: string) => (async () => ({ ok: true, url, text: async () => html })) as unknown as typeof fetch;
    expect(await checkMetaTag("zzshop.in", token, page("https://zzshop.in/", `<head><meta name="ghostcart-verification" content="abc123"></head>`))).toBe(true);
    expect(await checkMetaTag("zzshop.in", token, page("https://evil.example/", `<meta name="ghostcart-verification" content="abc123">`))).toBe(false);
    expect(await checkMetaTag("zzshop.in", token, page("https://zzshop.in/", `<meta name="ghostcart-verification" content="wrong">`))).toBe(false);
    expect(await checkMetaTag("localhost", token, page("https://localhost/", ""))).toBe(false);
  });

  it("records a failed DNS check with a reason the seller can act on", async () => {
    const s = await draft("website", "zz-no-such-domain-for-ghostcart.invalid");
    await ownershipToken(s);
    const check = await checkDomainOwnership((await getStore(s.id))!, "dns");
    expect(check.status).toBe("failed");
    expect(String(check.details.reason)).toContain("TXT record");
  });
});

describe("review", () => {
  it("goes draft → pending review → live, and caps orders by tier", async () => {
    const s = await draft();
    expect((await verificationChecklist(s)).canSubmit).toBe(false);
    await expect(submitForReview(s)).rejects.toThrow("Finish the steps");

    await saveBusinessDetails(s.orgId, { legalName: "ZZ Live Seller", businessType: "individual", pan: "ABCPL7777K" });
    await saveBankAccount(s.orgId, { holderName: "ZZ Live Seller", account: "111122223333", ifsc: "SBIN0001111" });
    await addOwnershipPhoto(s, "stock", "/uploads/zz.jpg");
    expect((await verificationChecklist(s)).steps.details).toBe("missing");
    expect((await verificationChecklist(s)).canSubmit).toBe(false); // buyers must see who they're buying from
    await saveDisclosure(s.id, details);
    const withDetails = (await getStore(s.id))!;
    const list = await verificationChecklist(withDetails);
    expect(list.steps).toEqual({ business: "done", gstin: "done", bank: "done", ownership: "in_review", details: "done" });
    await submitForReview(withDetails);
    expect((await pendingReviews()).some((r) => r.store.id === s.id)).toBe(true);

    await decideReview(s.id, { approve: true, tier: "new" }, "ZZ Reviewer");
    const live = (await getStore(s.id))!;
    expect(live).toMatchObject({ status: "live", tier: "new" });

    const cheap = await createProduct(s.id, { title: "Under cap", price: 9000, stock: 2 });
    const pricey = await createProduct(s.id, { title: "Over cap", price: 15000, stock: 2 });
    await expect(startShopNegotiation(pricey.id, "u")).rejects.toThrow("up to ₹10,000");
    await expect(startShopNegotiation(cheap.id, "u")).resolves.toMatchObject({ status: "negotiating" });
    await updateStore(s.id, { tier: "verified" });
    await expect(startShopNegotiation(pricey.id, "u")).resolves.toMatchObject({ status: "negotiating" });
  });

  it("sends a store back with a note the seller sees", async () => {
    const s = await draft();
    await saveBusinessDetails(s.orgId, { legalName: "ZZ Back Seller", businessType: "individual", pan: "ABCPB8888K" });
    await saveBankAccount(s.orgId, { holderName: "ZZ Back Seller", account: "444455556666", ifsc: "SBIN0002222" });
    await addOwnershipPhoto(s, "stock", "/uploads/zz2.jpg");
    await saveDisclosure(s.id, details);
    await submitForReview((await getStore(s.id))!);
    await expect(decideReview(s.id, { approve: false, note: " " }, "ZZ Reviewer")).rejects.toThrow("what to fix");
    await decideReview(s.id, { approve: false, note: "Photo is blurry, please retake." }, "ZZ Reviewer");
    expect(await getStore(s.id)).toMatchObject({ status: "draft", reviewNote: "Photo is blurry, please retake." });
  });
});
