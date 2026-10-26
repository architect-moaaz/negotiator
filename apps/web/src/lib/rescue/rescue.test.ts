import { describe, expect, it } from "vitest";
import { createApiKey } from "../integrations/keys";
import { startFromInvite } from "../privilege/actions";
import { resolveInvite } from "../privilege/invites";
import { createOrg } from "../shop/orgs";
import { setPolicy } from "../shop/policies";
import { createProduct, getProduct, ProductError } from "../shop/products";
import { createStore, updateStore } from "../shop/stores";
import { buildRescueCarts } from "./cart";
import { itemsFromText, titleFromUrl } from "./links";
import { findOffers } from "./match";

describe("pasted links", () => {
  it("take product words from the address only", () => {
    expect(titleFromUrl("https://www.amazon.in/Milton-Thermosteel-Flip-Bottle-Silver/dp/B01M0YQ6Z1?tag=x&ref=y")).toEqual({ title: "Milton Thermosteel Flip Bottle Silver", source: "amazon.in" });
    expect(titleFromUrl("https://www.flipkart.com/milton-thermosteel-flip-lid-1000-ml-bottle/p/itm6ad0e1c1c7e8b?pid=BOTF")).toEqual({
      title: "milton thermosteel flip lid 1000 ml bottle",
      source: "flipkart.com",
    });
    expect(titleFromUrl("https://www.myntra.com/kurtas/zz-brand/zz-brand-women-cotton-kurta/12345/buy")?.title).toBe("zz brand women cotton kurta");
    expect(titleFromUrl("https://amzn.in/d/abc123")).toBeNull(); // short links carry no product words
    expect(titleFromUrl("javascript:alert(1)")).toBeNull();
  });

  it("read one item per line, with quantities", () => {
    expect(itemsFromText("2 x Cotton kurta, blue\nhttps://www.amazon.in/Steel-Water-Bottle-1L/dp/B0ABC12345\n\nok")).toEqual([
      { title: "Cotton kurta, blue", quantity: 2 },
      { title: "Steel Water Bottle 1L", source: "amazon.in", quantity: 1 },
    ]);
  });
});

let n = 0;
async function shop(name: string, opts: { live?: boolean; haggle?: boolean; platform?: string } = {}) {
  n++;
  const org = await createOrg({ name: `ZZ Rescue ${name}`, ownerPhone: `+9190000025${String(n).padStart(2, "0")}`, ownerName: "ZZ" });
  const s = await createStore({ orgId: org.id, name: `ZZ Rescue ${name}`, platform: opts.platform ?? "ghostcart_shop" });
  if (opts.live !== false) await updateStore(s.id, { status: "live" });
  await setPolicy(s.id, "store", null, { maxDiscountPct: 10, autoApprovePct: 5, enabled: opts.haggle !== false });
  return s;
}

describe("finding GhostCart sellers for a cart item", () => {
  it("show the same barcode or model first, one per store, cheapest first, and only from live stores that haggle", async () => {
    const tag = `Zzq${Date.now().toString(36)}`;
    const a = await shop("A");
    const b = await shop("B");
    const c = await shop("C");
    const off = await shop("Offline", { live: false });
    const fixed = await shop("Fixed", { haggle: false });
    const sameA = await createProduct(a.id, { title: `${tag} Steel Bottle 1L`, brand: tag, gtin: "8901030865275", price: 900, stock: 3 });
    const blueA = await createProduct(a.id, { title: `${tag} Steel Bottle 1L Blue`, brand: tag, price: 850, stock: 3 });
    const sameB = await createProduct(b.id, { title: "Flask", brand: tag, modelNumber: "FL-1000", price: 800, stock: 3 });
    const similarC = await createProduct(c.id, { title: `${tag} Steel Bottle 1L Silver`, price: 600, stock: 3 });
    await createProduct(off.id, { title: `${tag} Steel Bottle 1L`, gtin: "8901030865275", price: 500, stock: 3 });
    await createProduct(fixed.id, { title: `${tag} Steel Bottle 1L`, gtin: "8901030865275", price: 400, stock: 3 });
    await createProduct(c.id, { title: `${tag} Steel Bottle 2L`, price: 300, stock: 3 });

    const offers = await findOffers({ title: `${tag} FL1000 Steel Bottle 1L`, brand: tag });
    // B has the same model; C and A only similar ones (A's cheaper blue one stands for A); the 2L bottle isn't a match.
    expect(offers.map((o) => o.productId)).toEqual([sameB.id, similarC.id, blueA.id]);
    expect(offers[0].match.kind).toBe("same_model");
    const byBarcode = await findOffers({ title: "bottle", gtin: "8901030865275" });
    expect(byBarcode.map((o) => o.productId)).toEqual([sameA.id]);
    expect(offers.every((o) => ![off.id, fixed.id].includes(o.storeId))).toBe(true);
    expect(new Set(offers.map((o) => o.storeId)).size).toBe(offers.length);
  });
});

describe("rescue carts", () => {
  it("make one cart and offer link per store, haggled on the store's normal rules", async () => {
    const a = await shop("Cart A");
    const b = await shop("Cart B");
    const pa = await createProduct(a.id, { title: "ZZ Rescue Lamp", price: 2000, stock: 4 });
    const pb = await createProduct(b.id, { title: "ZZ Rescue Mug", price: 400, stock: 9 });
    const carts = await buildRescueCarts([
      { productId: pa.id, quantity: 1 },
      { productId: pb.id, quantity: 2 },
      { productId: "prd_missing", quantity: 1 },
    ]);
    expect(carts.map((c) => [c.storeName, c.items])).toEqual([
      ["ZZ Rescue Cart A", 1],
      ["ZZ Rescue Cart B", 2],
    ]);
    const token = carts[0].url.split("/p/")[1];
    expect((await resolveInvite(token))?.cart.source).toBe("rescue");
    // No cart recovery settings at all: the store's own 10% / 5% rules apply.
    const deal = await startFromInvite(token, "rescue-buyer-1");
    expect(deal.negotiation!.terms).toMatchObject({ benchmark: 2000, floor: 1800, autoLimit: 1900 });
  });
});

describe("product identity", () => {
  it("refuse a mistyped barcode from the seller, but keep syncing the product without it", async () => {
    const s = await shop("Identity", { platform: "woocommerce" });
    await expect(createProduct(s.id, { title: "ZZ Bad Barcode", price: 500, gtin: "8901030865279" })).rejects.toThrow(ProductError);
    const p = await createProduct(s.id, { title: "ZZ Good Barcode", price: 500, gtin: "890 1030 865275", brand: "Milton", modelNumber: "FL1000" });
    expect(p).toMatchObject({ gtin: "08901030865275", brand: "Milton", modelNumber: "FL1000" });

    const { value } = await createApiKey(s, "secret", "owner");
    const products = await import("@/app/api/v1/products/route");
    const res = await products.POST(
      new Request("http://test/api/v1/products", {
        method: "POST",
        headers: { Authorization: `Bearer ${value}`, "Content-Type": "application/json" },
        body: JSON.stringify({ products: [{ sku: "woo-77", title: "ZZ Woo Kettle", price: 1500, gtin: "123", brand: "Prestige" }] }),
      }),
    );
    const [saved] = (await res.json()).results;
    expect(await getProduct(saved.id)).toMatchObject({ brand: "Prestige", gtin: null });
  });
});
