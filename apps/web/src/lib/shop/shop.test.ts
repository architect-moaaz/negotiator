import { describe, expect, it } from "vitest";
import { createOrg, memberRole, orgsForPhone, roleCan } from "./orgs";
import { setPolicy, PolicyError, policyForProduct, termsForProduct } from "./policies";
import { createProduct, importProductsCsv, listCategories, listProducts, parseCsv, ProductError, updateProduct } from "./products";
import { createStore, getStoreBySlug } from "./stores";

let n = 0;
const phone = () => `+9190000006${String(++n).padStart(2, "0")}`;

async function shop(name = "ZZ Sharma Electronics") {
  const owner = phone();
  const org = await createOrg({ name, ownerPhone: owner, ownerName: "ZZ Owner" });
  const store = await createStore({ orgId: org.id, name, platform: "ghostcart_shop" });
  return { org, owner, store };
}

describe("orgs and members", () => {
  it("makes the first member the owner and finds their orgs by phone", async () => {
    const { org, owner } = await shop();
    expect(await memberRole(org.id, owner)).toBe("owner");
    expect((await orgsForPhone(owner)).map((o) => o.id)).toEqual([org.id]);
    expect(roleCan("approver", "approve")).toBe(true);
    expect(roleCan("approver", "catalogue")).toBe(false);
  });
});

describe("stores", () => {
  it("give every shop its own URL name", async () => {
    const a = await shop("ZZ Gupta Mobiles & Co.");
    const b = await shop("ZZ Gupta Mobiles & Co.");
    expect(a.store.slug).toBe("zz-gupta-mobiles-co");
    expect(b.store.slug).toBe("zz-gupta-mobiles-co-2");
    expect((await getStoreBySlug(b.store.slug))?.id).toBe(b.store.id);
    expect(a.store).toMatchObject({ status: "draft", tier: "new" });
  });
});

describe("products", () => {
  it("are created with a category on first use, and validated in plain words", async () => {
    const { store } = await shop();
    const p = await createProduct(store.id, { title: "boAt Airdopes 141", price: 1299, mrp: 4490, stock: 12, category: "Audio" });
    expect(p).toMatchObject({ price: 1299, stock: 12, status: "active" });
    expect((await listCategories(store.id)).map((c) => c.name)).toEqual(["Audio"]);
    await expect(createProduct(store.id, { title: "x", price: 100 })).rejects.toThrow("Add a product name.");
    await expect(createProduct(store.id, { title: "Cable", price: 500, mrp: 400 })).rejects.toThrow(ProductError);
    const updated = await updateProduct(store.id, p.id, { title: "boAt Airdopes 141 (Black)", price: 1199, category: "Audio" });
    expect(updated?.price).toBe(1199);
  });

  it("import from CSV, keeping good rows and naming the bad ones", async () => {
    const { store } = await shop();
    const csv = [
      "Title,Price,MRP,Stock,Category,SKU",
      '"Redmi 13C, 4GB",7999,9999,5,Phones,RD13',
      "Phone cover,₹299,,40,Accessories,",
      "Broken row,abc,,1,Phones,",
      '"Charger ""fast""",1,499,3,Accessories,',
    ].join("\r\n");
    const result = await importProductsCsv(store.id, csv);
    expect(result.created).toBe(3);
    expect(result.errors).toEqual(["Line 4: Add a price."]);
    const titles = (await listProducts(store.id)).map((p) => p.title).sort();
    expect(titles).toEqual(['Charger "fast"', "Phone cover", "Redmi 13C, 4GB"]);
    expect(parseCsv('a,"b\nc",d')).toEqual([["a", "b\nc", "d"]]);
  });
});

describe("discount policies", () => {
  it("cascade store → category → product into the agent's limits", async () => {
    const { store } = await shop();
    const phoneP = await createProduct(store.id, { title: "Redmi 13C", price: 10000, category: "Phones" });
    const caseP = await createProduct(store.id, { title: "Phone case", price: 1000, category: "Accessories" });
    const [phones] = (await listCategories(store.id)).filter((c) => c.name === "Phones");

    await setPolicy(store.id, "store", null, { maxDiscountPct: 20, autoApprovePct: 10 });
    await setPolicy(store.id, "category", phones.id, { maxDiscountPct: 5, autoApprovePct: 2 });
    await setPolicy(store.id, "product", caseP.id, { floorPrice: 900 });

    expect(await termsForProduct(phoneP, store)).toMatchObject({ benchmark: 10000, floor: 9500, autoLimit: 9800, sellerId: store.id, category: "Phones" });
    expect(await termsForProduct(caseP, store)).toMatchObject({ floor: 900, autoLimit: 900 });
    expect((await policyForProduct(phoneP)).source.maxDiscountPct).toBe("category");

    await setPolicy(store.id, "category", phones.id, {}); // clear the override
    expect((await termsForProduct(phoneP, store))?.floor).toBe(8000);
  });

  it("refuse rules that don't make sense", async () => {
    const { store } = await shop();
    await expect(setPolicy(store.id, "store", null, { maxDiscountPct: 5, autoApprovePct: 9 })).rejects.toBeInstanceOf(PolicyError);
    await expect(setPolicy(store.id, "store", null, { floorPrice: 100 })).rejects.toThrow("A price floor can only be set on a product.");
  });

  it("can turn haggling off for one product", async () => {
    const { store } = await shop();
    const p = await createProduct(store.id, { title: "Fixed price item", price: 500 });
    await setPolicy(store.id, "product", p.id, { enabled: false });
    expect(await termsForProduct(p, store)).toBeNull();
  });
});
