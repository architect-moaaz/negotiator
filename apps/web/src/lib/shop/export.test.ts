import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { placeOrder, saveAddress } from "../checkout";
import { acceptOffer, markPaid } from "../negotiate";
import { orderForDeal } from "../orders/service";
import { markShipped, confirmReceivedByBuyer } from "../orders/fulfilment";
import { saveDisclosure } from "./disclosure";
import { exportOrgData, toCsv } from "./export";
import { startShopNegotiation } from "./negotiation";
import { createOrg } from "./orgs";
import { createProduct } from "./products";
import { createStore, updateStore } from "./stores";

describe("csv", () => {
  it("quotes commas and quotes, and defuses spreadsheet formulas", () => {
    const csv = toCsv([{ a: 'He said "hi", then left', b: "=HYPERLINK(\"x\")", c: null, d: new Date("2026-10-26T00:00:00Z") }]);
    expect(csv).toBe('a,b,c,d\r\n"He said ""hi"", then left","\'=HYPERLINK(""x"")",,2026-10-26T00:00:00.000Z\r\n');
  });
});

describe("org export", () => {
  it("covers the org's stores and orders without secrets, handover codes or addresses it no longer needs", async () => {
    const org = await createOrg({ name: "ZZ Export Co", ownerPhone: "+919000004001", ownerName: "ZZ Owner" });
    const s = (await updateStore((await createStore({ orgId: org.id, name: "ZZ Export Store", platform: "ghostcart_shop" })).id, { status: "live", tier: "verified" }))!;
    await saveDisclosure(s.id, { address: "1 ZZ Road", city: "Pune", state: "Maharashtra", pincode: "411001", supportPhone: "9000004002", returnDays: 7, returnPolicy: "Returns within 7 days of delivery, refunds in 5 days." });
    const p = await createProduct(s.id, { title: "ZZ Export Lamp", price: 1200, stock: 4 });

    const order = async (street: string) => {
      let deal = await startShopNegotiation(p.id, `zz-export-buyer-${street}`);
      deal = await acceptOffer(deal);
      deal = await markPaid(deal, "pinelabs");
      deal = await saveAddress(deal, { name: "ZZ Buyer", phone: "+919000004099", line1: `${street} ${Math.random().toString(36).slice(2, 7)}`, city: "Pune", state: "Maharashtra", pincode: "411001" });
      deal = await placeOrder(deal, "pinelabs");
      return (await orderForDeal(deal.id))!;
    };
    const toShip = await order("Open Street");
    const done = await order("Done Street");
    await markShipped(done.id, { courier: "Delhivery", awb: "ZZEXP0001" }, "seller");
    await confirmReceivedByBuyer(done.id);

    const out = (await exportOrgData(org.id))!;
    const files = unzipSync(out.zip);
    expect(Object.keys(files)).toContain("ghostcart-export/ledger.csv");
    const read = (n: string) => strFromU8(files[`ghostcart-export/${n}`]);

    expect(read("products.csv")).toContain("ZZ Export Lamp");
    expect(read("stores.csv")).toContain("buyer_returnPolicy");
    expect(read("stores.csv")).not.toContain("verificationToken");
    const orders = read("orders.csv");
    expect(orders).toContain(toShip.id);
    expect(orders).toContain("Open Street");
    expect(orders).not.toContain("Done Street"); // delivered: the seller no longer needs the street
    expect(orders).not.toContain("user_id");
    expect(read("shipments.csv")).not.toMatch(/handover/i);
    expect(read("ledger.csv").split("\r\n").length).toBeGreaterThan(3);
    for (const [name, data] of Object.entries(files)) expect(strFromU8(data), name).not.toMatch(/Encrypted|keyHash|identityHash/);
  });
});
