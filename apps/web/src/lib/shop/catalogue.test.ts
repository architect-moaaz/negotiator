import { describe, expect, it } from "vitest";
import { searchCatalogue } from "./catalogue";
import { createOrg } from "./orgs";
import { createProduct } from "./products";
import { createStore, updateStore } from "./stores";

let n = 0;
async function shop(live: boolean) {
  const org = await createOrg({ name: "ZZ Catalogue", ownerPhone: `+9190000023${String(++n).padStart(2, "0")}`, ownerName: "ZZ" });
  const s = await createStore({ orgId: org.id, name: `ZZ Catalogue Store ${n}`, platform: "ghostcart_shop" });
  if (live) await updateStore(s.id, { status: "live" });
  return s;
}

describe("consumer catalogue", () => {
  it("shows only in-stock, active products from live shops, matching every word", async () => {
    const live = await shop(true);
    const draft = await shop(false);
    const word = `zzcat${Date.now()}`;
    await createProduct(live.id, { title: `${word} Cotton Kurta Blue`, price: 999, stock: 3, category: "Ethnic wear" });
    await createProduct(live.id, { title: `${word} Cotton Kurta Sold Out`, price: 999, stock: 0 });
    await createProduct(live.id, { title: `${word} Cotton Kurta Hidden`, price: 999, stock: 3, status: "draft" });
    await createProduct(draft.id, { title: `${word} Cotton Kurta Draft Shop`, price: 999, stock: 3 });
    const found = await searchCatalogue(`${word} kurta`);
    expect(found.map((p) => p.title)).toEqual([`${word} Cotton Kurta Blue`]);
    expect(found[0]).toMatchObject({ storeSlug: live.slug, category: "Ethnic wear" });
    expect(await searchCatalogue(`${word} ethnic`)).toHaveLength(1); // category words match too
    expect(await searchCatalogue(`${word} saree`)).toHaveLength(0);
  });
});
