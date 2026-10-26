import { describe, expect, it } from "vitest";
import { placeOrder, saveAddress } from "./checkout";
import { financialYear, invoicesForStore, issueMonthlyInvoices, monthBounds, previousMonth, splitGst } from "./invoices";
import { acceptOffer, markPaid } from "./negotiate";
import { confirmReceivedByBuyer, markShipped } from "./orders/fulfilment";
import { orderForDeal, releaseOrder } from "./orders/service";
import { saveDisclosure } from "./shop/disclosure";
import { startShopNegotiation } from "./shop/negotiation";
import { createOrg } from "./shop/orgs";
import { createProduct } from "./shop/products";
import { createStore, updateStore } from "./shop/stores";

describe("invoice dates and tax", () => {
  it("knows Indian financial years, IST months and the GST split", () => {
    expect(financialYear(new Date("2026-03-31T18:00:00Z"))).toBe("2025-26"); // 31 Mar 23:30 IST
    expect(financialYear(new Date("2026-03-31T18:30:00Z"))).toBe("2026-27"); // 1 Apr 00:00 IST
    expect(monthBounds("2026-10").start.toISOString()).toBe("2026-09-30T18:30:00.000Z");
    expect(monthBounds("2026-12").end.toISOString()).toBe("2026-12-31T18:30:00.000Z");
    expect(previousMonth(Date.parse("2026-01-05T00:00:00Z"))).toBe("2025-12");
    expect(splitGst(1801, "29", "29")).toEqual({ cgst: 900, sgst: 901, igst: 0 });
    expect(splitGst(1801, "27", "29")).toEqual({ cgst: 0, sgst: 0, igst: 1801 });
    expect(splitGst(1801, null, "29")).toEqual({ cgst: 0, sgst: 0, igst: 1801 });
  });
});

let n = 0;
async function storeIn(state: string) {
  const org = await createOrg({ name: `ZZ Invoice ${++n}`, ownerPhone: `+9190000099${String(n).padStart(2, "0")}`, ownerName: "ZZ" });
  const s = (await updateStore((await createStore({ orgId: org.id, name: `ZZ Invoice Store ${n}`, platform: "ghostcart_shop" })).id, { status: "live", tier: "trusted" }))!;
  await saveDisclosure(s.id, { address: "1 ZZ Road", city: "Somewhere", state, pincode: "560001", supportPhone: "9000009998", returnDays: 7, returnPolicy: "Returns within 7 days of delivery, refunds within 5 days." });
  return s;
}
async function deliveredAndReleased(storeId: string, price: number) {
  const p = await createProduct(storeId, { title: `ZZ Invoice Item ${price}`, price, stock: 3 });
  let deal = await startShopNegotiation(p.id, `zz-invoice-buyer-${storeId}-${price}`);
  deal = await acceptOffer(deal);
  deal = await markPaid(deal, "pinelabs");
  deal = await saveAddress(deal, { name: "ZZ Buyer", phone: "+919000009997", line1: `${Math.random().toString(36).slice(2, 8)} Invoice Lane`, city: "Pune", state: "Maharashtra", pincode: "411001" });
  deal = await placeOrder(deal, "pinelabs");
  const order = (await orderForDeal(deal.id))!;
  await markShipped(order.id, { courier: "Delhivery", awb: `ZZINV${n}${price}` }, "seller");
  await confirmReceivedByBuyer(order.id);
  await releaseOrder(order.id);
  return order;
}

describe("monthly fee invoices", () => {
  it("bill exactly the fees released in the month, split CGST/SGST in-state and IGST across states, once", async () => {
    const period = new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 7); // this IST month
    const karnataka = await storeIn("Karnataka");
    const maharashtra = await storeIn("Maharashtra");
    const a1 = await deliveredAndReleased(karnataka.id, 2000);
    const a2 = await deliveredAndReleased(karnataka.id, 3000);
    const b1 = await deliveredAndReleased(maharashtra.id, 1500);

    const issued = await issueMonthlyInvoices(period);
    const ka = issued.find((i) => i.storeId === karnataka.id)!;
    const mh = issued.find((i) => i.storeId === maharashtra.id)!;
    expect(ka.taxable).toBe(a1.fee + a2.fee);
    expect(ka.cgst + ka.sgst).toBe(a1.gst + a2.gst);
    expect(ka).toMatchObject({ igst: 0, placeOfSupply: "29", total: a1.fee + a1.gst + a2.fee + a2.gst });
    expect(ka.lines.map((l) => l.ref).sort()).toEqual([a1.id, a2.id].sort());
    expect(mh).toMatchObject({ placeOfSupply: "27", cgst: 0, sgst: 0, igst: b1.gst, taxable: b1.fee });
    expect(ka.number).toMatch(/^GC\/\d{4}-\d{2}\/\d{6}$/);
    expect(Math.abs(ka.serial - mh.serial)).toBe(1);

    const again = await issueMonthlyInvoices(period); // idempotent
    expect(again.find((i) => i.storeId === karnataka.id)!.number).toBe(ka.number);
    expect(await invoicesForStore(karnataka.id)).toHaveLength(1);
  });
});
