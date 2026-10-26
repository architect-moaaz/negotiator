import { gstinCheckChar } from "@ghostcart/core";
import { describe, expect, it } from "vitest";
import { saveBusinessDetails } from "../verification/service";
import { saveDisclosure, sellerDetails } from "./disclosure";
import { createOrg } from "./orgs";
import { createProduct, getProduct, updateProduct, upsertProductBySku } from "./products";
import { createStore, getStore } from "./stores";

let n = 0;
async function store() {
  const org = await createOrg({ name: `ZZ Disclose ${++n}`, ownerPhone: `+9190000030${String(n).padStart(2, "0")}`, ownerName: "ZZ Owner" });
  return createStore({ orgId: org.id, name: `ZZ Disclose Store ${n}`, platform: "ghostcart_shop" });
}
const details = { address: "12 ZZ Test Road", city: "Pune", state: "Maharashtra", pincode: "411001", supportPhone: "90000 01099", returnDays: 7, returnPolicy: "Unused items can be returned within 7 days; refunds within 5 working days." };

describe("seller disclosures", () => {
  it("validates what buyers will see and normalises the care number", async () => {
    const s = await store();
    await expect(saveDisclosure(s.id, { ...details, pincode: "41100" })).rejects.toThrow("6 digits");
    await expect(saveDisclosure(s.id, { ...details, returnPolicy: "No." })).rejects.toThrow("sentence");
    await expect(saveDisclosure(s.id, { ...details, returnDays: 45 })).rejects.toThrow("30 days");
    await expect(saveDisclosure(s.id, { ...details, supportPhone: "12345 67890" })).rejects.toThrow("mobile number");
    const saved = await saveDisclosure(s.id, details);
    expect(saved?.supportPhone).toBe("+919000001099");
  });

  it("shows the legal name, address, returns, and the GSTIN only once verified", async () => {
    const s = await store();
    const before = await sellerDetails(s);
    expect(before).toMatchObject({ tradeName: s.name, legalName: null, address: null, returnPolicy: null, gstin: null });

    const pan = "ABCCD4321K";
    const gstin = `27${pan}1Z${gstinCheckChar(`27${pan}1Z`)}`;
    await saveBusinessDetails(s.orgId, { legalName: "ZZ Disclose Traders Pvt Ltd", businessType: "company", pan, gstin });
    await saveDisclosure(s.id, details);
    const after = await sellerDetails((await getStore(s.id))!);
    expect(after).toMatchObject({ legalName: "ZZ Disclose Traders Pvt Ltd", address: "12 ZZ Test Road, Pune, Maharashtra 411001", returnDays: 7, supportPhone: "+919000001099" });
    // The sandbox KYC provider passes well-formed GSTINs.
    expect(after.gstin).toBe(gstin);
  });
});

describe("country of origin", () => {
  it("is saved with the product and survives a catalogue sync that doesn't know it", async () => {
    const s = await store();
    const p = await createProduct(s.id, { title: "ZZ Origin Kettle", price: 900, stock: 2, sku: "ZZ-ORIGIN", countryOfOrigin: "India" });
    expect(p.countryOfOrigin).toBe("India");
    await upsertProductBySku(s.id, { title: "ZZ Origin Kettle v2", price: 950, stock: 3, sku: "ZZ-ORIGIN" });
    expect((await getProduct(p.id))?.countryOfOrigin).toBe("India");
    await updateProduct(s.id, p.id, { title: "ZZ Origin Kettle v2", price: 950, countryOfOrigin: "" });
    expect((await getProduct(p.id))?.countryOfOrigin).toBeNull();
  });
});
