import { afterEach, describe, expect, it } from "vitest";
import { placeOrder, saveAddress } from "./checkout";
import { experimentResults, openingFor } from "./experiments";
import { acceptOffer, markPaid } from "./negotiate";
import { evidencePack } from "./orders/evidence";
import { confirmReceivedByBuyer, markShipped, openDispute } from "./orders/fulfilment";
import { orderForDeal } from "./orders/service";
import { fileGrievance } from "./privacy/grievances";
import { startShopNegotiation } from "./shop/negotiation";
import { createOrg } from "./shop/orgs";
import { createProduct } from "./shop/products";
import { createStore, updateStore } from "./shop/stores";
import { assignSupport, supportQueue } from "./support";
import { signUp } from "./users";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

let n = 0;
async function shop() {
  n++;
  const org = await createOrg({ name: "ZZ Ops", ownerPhone: `+9190000037${String(n).padStart(2, "0")}`, ownerName: "ZZ" });
  const s = (await updateStore((await createStore({ orgId: org.id, name: "ZZ Ops Store", platform: "ghostcart_shop" })).id, { status: "live", tier: "verified" }))!;
  return { store: s, product: await createProduct(s.id, { title: "ZZ Ops Lamp", price: 4000, stock: 9 }) };
}

describe("evidence pack", () => {
  it("collects payment, address, tracking, delivery confirmation, haggle and consent for one order", async () => {
    const { product } = await shop();
    const user = await signUp({ name: "ZZ Evidence Buyer", phone: "+919000003801", channel: "web", consent: true });
    let deal = await startShopNegotiation(product.id, user.id);
    deal = await acceptOffer(deal);
    deal = await markPaid(deal, "pinelabs");
    deal = await saveAddress(deal, { name: "ZZ Buyer", phone: user.phone, line1: "1 Evidence Lane", city: "Pune", state: "Maharashtra", pincode: "411001" });
    deal = await placeOrder(deal, "pinelabs");
    const o = (await orderForDeal(deal.id))!;
    await markShipped(o.id, { courier: "Delhivery", awb: "ZZEVID00001" }, "seller");
    await confirmReceivedByBuyer(o.id);
    const pack = (await evidencePack(o.id))!;
    expect(pack.order).toMatchObject({ id: o.id, totalInr: o.total / 100 });
    expect(pack.buyer).toMatchObject({ name: "ZZ Evidence Buyer", phone: user.phone });
    expect(pack.shipment).toMatchObject({ courier: "Delhivery", awb: "ZZEVID00001" });
    expect(pack.deliveryConfirmedBy).toBe("buyer confirmed receipt");
    expect(pack.haggle.length).toBeGreaterThan(0);
    expect(pack.consents.map((c) => c.purpose)).toContain("deal_contact");
    expect(await evidencePack("ord_missing")).toBeNull();
  });
});

describe("support inbox", () => {
  it("lists complaints and disputes by due time, with who's on each", async () => {
    const g = await fileGrievance({ name: "ZZ Complainer", contact: "9000003802", category: "order", message: "My parcel came open and a part is missing." });
    const { product } = await shop();
    let deal = await startShopNegotiation(product.id, `ops-buyer-${n}`);
    deal = await acceptOffer(deal);
    deal = await markPaid(deal, "pinelabs");
    deal = await saveAddress(deal, { name: "ZZ Buyer", phone: "+919000003803", line1: "2 Dispute Lane", city: "Pune", state: "Maharashtra", pincode: "411001" });
    deal = await placeOrder(deal, "pinelabs");
    const o = (await orderForDeal(deal.id))!;
    await markShipped(o.id, { courier: "Delhivery", awb: "ZZOPS000001" }, "seller");
    await confirmReceivedByBuyer(o.id);
    const d = await openDispute(o.id, { reason: "damaged", details: "Cracked glass on arrival" });
    await assignSupport("dispute", d.id, "ZZ Staff");
    const queue = await supportQueue();
    const gi = queue.find((i) => i.kind === "grievance" && i.id === g.id)!;
    expect(gi).toMatchObject({ due: "acknowledge", overdue: false });
    expect(queue.find((i) => i.id === d.id)).toMatchObject({ kind: "dispute", due: "decide", assignee: "ZZ Staff", orderId: o.id });
    expect(queue.indexOf(gi)).toBeLessThan(queue.findIndex((i) => i.id === d.id)); // 48h acknowledge comes before a week to decide
    expect((await supportQueue(new Date(Date.now() + 3 * 86_400_000))).find((i) => i.id === g.id)?.overdue).toBe(true);
  });
});

describe("experiments", () => {
  it("only run when switched on, and never open below the agent's alone-limit", async () => {
    const terms = { benchmark: 10_000, autoLimit: 9_000, opening: 9_750 } as Parameters<typeof openingFor>[0];
    expect(openingFor(terms, "u1")).toEqual({ opening: 9_750, variant: undefined });
    process.env.EXPERIMENTS = "opening_position";
    const seen = new Set<number>();
    for (let i = 0; i < 40; i++) {
      const r = openingFor(terms, `u${i}`);
      expect(r.opening).toBeGreaterThanOrEqual(9_000);
      seen.add(r.opening);
    }
    expect([...seen].sort()).toEqual([9_500, 9_750]);

    const { product } = await shop();
    const deal = await startShopNegotiation(product.id, "ops-exp-buyer");
    expect(deal.experiments?.opening_position).toMatch(/^(control|closer)$/);
    expect((await experimentResults("opening_position")).some((r) => r.haggles > 0)).toBe(true);
  });
});
