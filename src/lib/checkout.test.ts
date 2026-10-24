import { describe, expect, it } from "vitest";
import { advanceOrder, CHECKOUT_WINDOW_MS, parseAddress, placeOrder, saveAddress, syncCheckout } from "./checkout";
import { markPaid, toPublic } from "./negotiate";
import { store } from "./store";
import type { Deal, Product } from "./types";

const product: Product = { title: "Nike Air Force 1 '07", seller: "Amazon", price: 5499, inStock: true };
const address = { name: "Asha Rao", phone: "98450 12345", line1: "12 MG Road, Flat 4B", city: "Bengaluru", state: "Karnataka", pincode: "560001" };

async function invoicedDeal(id: string): Promise<Deal> {
  const deal: Deal = {
    id,
    product,
    alternatives: [],
    originalPrice: 5499,
    dealPrice: 5049,
    saved: 450,
    perk: "Free instant shipping",
    bestSeller: "Amazon",
    haggle: "",
    lockFee: 9,
    simulate: true,
    createdAt: Date.now(),
    expiresAt: Date.now() + 180_000,
    status: "pending",
    channel: "web",
  };
  return store.saveDeal(deal, true);
}

describe("checkout after the deal is locked", () => {
  it("opens a 30-minute window for the balance once the lock fee is paid", async () => {
    const deal = await markPaid(await invoicedDeal("co-open"), "simulated");
    expect(deal.checkout).toMatchObject({ status: "awaiting", amount: 5040 });
    expect(deal.checkout!.dueAt - deal.checkout!.openedAt).toBe(CHECKOUT_WINDOW_MS);
  });

  it("rejects bad addresses with a shopper-facing message", () => {
    expect(() => parseAddress({ ...address, pincode: "012345" })).toThrow(/pincode/);
    expect(() => parseAddress({ ...address, phone: "12345" })).toThrow(/mobile/);
    expect(parseAddress(address).phone).toBe("+919845012345");
  });

  it("takes the address, issues the balance payment, places the order and tracks it to delivery", async () => {
    const deal = await markPaid(await invoicedDeal("co-flow"), "simulated");
    await saveAddress(deal, parseAddress(address));
    const pub = toPublic(deal);
    expect(pub.checkout?.deliverTo).toEqual({ name: "Asha Rao", area: "Bengaluru 560001" });
    expect(JSON.stringify(pub)).not.toContain("MG Road"); // full address never reaches the browser

    await placeOrder(deal, "simulated");
    expect(deal.checkout).toMatchObject({ status: "ordered", orderRef: "GC-CO-FLO" });
    expect(deal.checkout!.tracking!.map((t) => t.stage)).toEqual(["placed"]);

    await advanceOrder(deal, { by: "test" });
    await advanceOrder(deal, { by: "test", courier: "Delhivery", awb: "DL123" });
    expect(deal.checkout!.tracking!.at(-1)).toMatchObject({ stage: "shipped", note: "Delhivery · AWB DL123" });
    await advanceOrder(deal, { by: "test" });
    await advanceOrder(deal, { by: "test" });
    expect(deal.checkout!.tracking!.at(-1)!.stage).toBe("delivered");
    await expect(advanceOrder(deal, { by: "test" })).rejects.toThrow(/already delivered/);
  });

  it("releases the lock when the window runs out", async () => {
    const deal = await markPaid(await invoicedDeal("co-lapse"), "simulated");
    deal.checkout!.dueAt = Date.now() - 60_000;
    expect(await syncCheckout(deal)).toBe(true);
    expect(deal.checkout!.status).toBe("lapsed");
    await expect(saveAddress(deal, parseAddress(address))).rejects.toThrow(/ran out/);
  });
});
