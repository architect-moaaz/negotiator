import { describe, expect, it } from "vitest";
import { placeOrder, saveAddress } from "../checkout";
import { acceptOffer, markPaid, submitOffer } from "../negotiate";
import { store as kv } from "../store";
import { uploadImage, UploadError } from "../uploads";
import { startShopNegotiation, ShopError } from "./negotiation";
import { createOrg } from "./orgs";
import { setPolicy } from "./policies";
import { createProduct, getProduct } from "./products";
import { createStore, updateStore } from "./stores";

let n = 0;
async function liveShop(stock = 3) {
  const org = await createOrg({ name: "ZZ Flow Traders", ownerPhone: `+9190000009${String(++n).padStart(2, "0")}`, ownerName: "ZZ" });
  const store = await createStore({ orgId: org.id, name: "ZZ Flow Mobiles", platform: "ghostcart_shop" });
  await setPolicy(store.id, "store", null, { maxDiscountPct: 10, autoApprovePct: 5, expiryMinutes: 30 });
  const product = await createProduct(store.id, { title: "ZZ Redmi 13C", price: 10000, mrp: 11999, stock });
  return { store: (await updateStore(store.id, { status: "live" }))!, product };
}

describe("shop negotiations", () => {
  it("start from the seller's list price and rules", async () => {
    const { store, product } = await liveShop();
    const deal = await startShopNegotiation(product.id, "shopper-1");
    expect(deal.shop).toMatchObject({ storeId: store.id, productId: product.id, storeName: "ZZ Flow Mobiles" });
    expect(deal.negotiation?.terms).toMatchObject({ fundedBy: "seller", benchmark: 10000, floor: 9000, autoLimit: 9500, sellerId: store.id });
    expect(deal.expiresAt - deal.createdAt).toBe(30 * 60 * 1000);
    expect(deal.perk).toBe("Ships from ZZ Flow Mobiles");
  });

  it("refuse draft shops, sold-out and fixed-price products", async () => {
    const { store, product } = await liveShop(0);
    await expect(startShopNegotiation(product.id, "s")).rejects.toThrow("Out of stock right now.");
    const fixed = await createProduct(store.id, { title: "Fixed", price: 500, stock: 5 });
    await setPolicy(store.id, "product", fixed.id, { enabled: false });
    await expect(startShopNegotiation(fixed.id, "s")).rejects.toThrow("fixed price");
    await updateStore(store.id, { status: "draft" });
    const other = await createProduct(store.id, { title: "Other", price: 500, stock: 5 });
    await expect(startShopNegotiation(other.id, "s")).rejects.toBeInstanceOf(ShopError);
  });

  it("run through haggle, lock, address and order, taking one unit of stock", async () => {
    const { product } = await liveShop(2);
    let deal = await startShopNegotiation(product.id, "shopper-2");
    deal = await submitOffer(deal, 9600); // within the agent's own limit
    if (deal.status === "negotiating") deal = await acceptOffer(deal);
    expect(deal.status).toBe("pending");
    expect(deal.dealPrice).toBeGreaterThanOrEqual(9500);

    deal = await markPaid(deal, "pinelabs");
    deal = await saveAddress(deal, { name: "ZZ Shopper", phone: "+919000000999", line1: `${Math.random().toString(36).slice(2, 8)} Test Street`, city: "Bengaluru", state: "Karnataka", pincode: "560038" });
    deal = await placeOrder(deal, "pinelabs");
    expect(deal.checkout?.status).toBe("ordered");
    expect((await getProduct(product.id))?.stock).toBe(1);
    expect((await kv.getDeal(deal.id))?.shop?.productId).toBe(product.id);
  });

  it("escalate offers below the agent's limit to a human", async () => {
    const { product } = await liveShop();
    let deal = await startShopNegotiation(product.id, "shopper-3");
    for (let i = 0; i < 4 && deal.status === "negotiating"; i++) deal = await submitOffer(deal, 9200);
    expect(deal.status).toBe("awaiting_approval");
    expect(deal.negotiation?.approval?.price).toBe(9200);
  });
});

describe("photo uploads", () => {
  it("accept only images up to 5 MB", async () => {
    await expect(uploadImage(new File(["x"], "a.pdf", { type: "application/pdf" }), "t")).rejects.toThrow("JPG, PNG or WebP");
    await expect(uploadImage(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "a.jpg", { type: "image/jpeg" }), "t")).rejects.toBeInstanceOf(UploadError);
  });
});
