import { describe, expect, it } from "vitest";
import { placeOrder, saveAddress } from "./checkout";
import { acceptOffer, markPaid } from "./negotiate";
import { confirmReceivedByBuyer, markShipped } from "./orders/fulfilment";
import { orderForDeal } from "./orders/service";
import { addReview, canReview, replyToReview, reviewSummary, setReviewHidden, shortName } from "./reviews";
import { startShopNegotiation } from "./shop/negotiation";
import { createOrg } from "./shop/orgs";
import { createProduct } from "./shop/products";
import { createStore, updateStore } from "./shop/stores";
import { signUp } from "./users";

let n = 0;
async function order(deliver = true) {
  n++;
  const user = await signUp({ name: "ZZ Asha Kumar", phone: `+9190000033${String(n).padStart(2, "0")}`, channel: "web", consent: true });
  const org = await createOrg({ name: "ZZ Reviews", ownerPhone: `+9190000034${String(n).padStart(2, "0")}`, ownerName: "ZZ" });
  const s = (await updateStore((await createStore({ orgId: org.id, name: "ZZ Reviews Store", platform: "ghostcart_shop" })).id, { status: "live", tier: "verified" }))!;
  const p = await createProduct(s.id, { title: "ZZ Review Lamp", price: 2000, stock: 5 });
  let deal = await startShopNegotiation(p.id, user.id);
  deal = await acceptOffer(deal);
  deal = await markPaid(deal, "pinelabs");
  deal = await saveAddress(deal, { name: "ZZ Buyer", phone: user.phone, line1: `${n} Review Street`, city: "Pune", state: "Maharashtra", pincode: "411001" });
  deal = await placeOrder(deal, "pinelabs");
  const o = (await orderForDeal(deal.id))!;
  if (deliver) {
    await markShipped(o.id, { courier: "Delhivery", awb: `ZZREV${n}0000` }, "seller");
    await confirmReceivedByBuyer(o.id);
  }
  return { user, store: s, product: p, order: o };
}

describe("verified-buyer reviews", () => {
  it("only the buyer of a delivered order, once, with no links", async () => {
    const undelivered = await order(false);
    await expect(addReview(undelivered.order.id, undelivered.user.id, { rating: 5 })).rejects.toThrow("delivered");
    const { user, order: o, product } = await order();
    await expect(addReview(o.id, "someone-else", { rating: 5 })).rejects.toThrow("not found");
    await expect(addReview(o.id, user.id, { rating: 6 })).rejects.toThrow("1 to 5");
    await expect(addReview(o.id, user.id, { rating: 4, body: "see www.spam.example" })).rejects.toThrow("links");
    await addReview(o.id, user.id, { rating: 4, body: "Bright and well packed." });
    await expect(addReview(o.id, user.id, { rating: 1 })).rejects.toThrow("already");
    expect(await canReview(o)).toBe(false);
    const summary = await reviewSummary({ productId: product.id });
    expect(summary).toMatchObject({ count: 1, average: 4 });
    expect(summary.latest[0].authorName).toBe("ZZ K.");
  });

  it("let the seller reply once and staff hide without changing the rating", async () => {
    const { user, order: o, store, product } = await order();
    const r = await addReview(o.id, user.id, { rating: 1, body: "Rude courier" });
    await expect(replyToReview("st_other", r.id, "Sorry")).rejects.toThrow();
    await replyToReview(store.id, r.id, "Sorry about that, we've changed courier.");
    await expect(replyToReview(store.id, r.id, "Again")).rejects.toThrow("already");
    await expect(setReviewHidden(r.id, true, "", "ZZ Staff")).rejects.toThrow("why");
    await setReviewHidden(r.id, true, "Personal details of the courier", "ZZ Staff");
    expect((await reviewSummary({ productId: product.id })).count).toBe(0);
    expect((await reviewSummary({ storeId: store.id })).count).toBe(0);
  });

  it("shorten names to first name and initial", () => {
    expect(shortName("Asha Kumar")).toBe("Asha K.");
    expect(shortName("Ravi")).toBe("Ravi");
  });
});
