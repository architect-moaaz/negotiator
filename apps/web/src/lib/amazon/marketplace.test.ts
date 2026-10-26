import { beforeEach, describe, expect, it, vi } from "vitest";

let jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

const connectRoute = await import("@/app/api/amazon/connect/route");
const callbackRoute = await import("@/app/api/amazon/callback/route");
const mock = await import("@/app/api/mock-amazon/[...path]/route");
const { startSession } = await import("../session");
const { createOrg } = await import("../shop/orgs");
const { createStore, getStore } = await import("../shop/stores");
const { getProductByRef, importProductsCsv, listProducts } = await import("../shop/products");
const { pollAmazonImports } = await import("./connect");
const { listingsTsvToCsv } = await import("./spapi");
const { verificationChecklist } = await import("../verification/service");
const { getDb } = await import("../db");
const { schema } = await import("@ghostcart/db");

let n = 0;
async function store(platform: "amazon" | "flipkart") {
  const owner = `+9190000020${String(++n).padStart(2, "0")}`;
  const org = await createOrg({ name: "ZZ Marketplace Seller", ownerPhone: owner, ownerName: "ZZ" });
  return { owner, store: await createStore({ orgId: org.id, name: "ZZ Marketplace Store", platform }) };
}

beforeEach(() => {
  jar = new Map();
});

describe("Flipkart and Amazon listing files", () => {
  it("import Flipkart's own columns, and re-importing updates by SKU instead of duplicating", async () => {
    const { store: s } = await store("flipkart");
    const csv = ["Seller SKU Id,Product Title,Your Selling Price,MRP,System Stock", "ZZ-FK-1,ZZ Flipkart Kurti,799,1299,15", "ZZ-FK-2,ZZ Flipkart Mug,249,,0"].join("\n");
    expect(await importProductsCsv(s.id, csv)).toEqual({ created: 2, errors: [] });
    expect(await getProductByRef(s.id, "ZZ-FK-1")).toMatchObject({ title: "ZZ Flipkart Kurti", price: 799, mrp: 1299, stock: 15 });
    await importProductsCsv(s.id, ["Seller SKU Id,Product Title,Your Selling Price,MRP,System Stock", "ZZ-FK-1,ZZ Flipkart Kurti,749,1299,12"].join("\n"));
    expect((await listProducts(s.id)).length).toBe(2);
    expect(await getProductByRef(s.id, "ZZ-FK-1")).toMatchObject({ price: 749, stock: 12 });
  });

  it("turn Amazon's tab-separated report into rows the importer reads", () => {
    expect(listingsTsvToCsv("item-name\tseller-sku\tprice\nKettle, 1.5L\tK1\t899")).toBe('item-name,seller-sku,price\n"Kettle, 1.5L",K1,899');
  });
});

describe("Amazon Seller Central connection", () => {
  it("authorises via SP-API, proves account ownership, and imports listings once Amazon's report is ready", async () => {
    const { owner, store: s } = await store("amazon");
    await startSession("member", owner);
    const cookie = [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
    const start = await connectRoute.GET(new Request(`http://test/api/amazon/connect?storeId=${s.id}`, { headers: { cookie } }));
    expect(start.status).toBe(302);
    const consent = new URL(start.headers.get("location")!);
    expect(consent.searchParams.get("version")).toBe("beta");
    const approved = await mock.GET(new Request(consent), { params: Promise.resolve({ path: consent.pathname.replace("/api/mock-amazon/", "").split("/") }) });
    const back = new URL(approved.headers.get("location")!);
    const done = await callbackRoute.GET(new Request(`http://test${back.pathname}${back.search}`));
    expect(done.headers.get("location")).toContain(`/seller?store=${s.id}&connected=amazon`);
    expect((await verificationChecklist((await getStore(s.id))!)).steps.ownership).toBe("done");

    expect((await pollAmazonImports()).find((d) => d.storeId === s.id)).toBeUndefined(); // still being built
    const [conn] = (await (await getDb()).select().from(schema.platformConnections)).filter((c) => c.storeId === s.id);
    await mock.POST(new Request(`http://amazon.test/api/mock-amazon/finish/${conn.meta.reportId}`, { method: "POST" }), { params: Promise.resolve({ path: ["finish", String(conn.meta.reportId)] }) });
    const imported = (await pollAmazonImports()).find((d) => d.storeId === s.id);
    expect(imported).toEqual({ storeId: s.id, imported: 2, errors: 1 });
    expect(await getProductByRef(s.id, "ZZ-AMZ-BOAT141")).toMatchObject({ title: "ZZ Amazon Boat Airdopes 141", price: 1299, stock: 25 });
    expect((await pollAmazonImports()).find((d) => d.storeId === s.id)).toBeUndefined(); // imported once
  });

  it("refuse a callback with an unknown state, and connecting another seller's store", async () => {
    const res = await callbackRoute.GET(new Request("http://test/api/amazon/callback?state=nope&spapi_oauth_code=x&selling_partner_id=y"));
    expect(res.status).toBe(400);
    const { store: s } = await store("amazon");
    const other = await store("amazon");
    await startSession("member", other.owner);
    const cookie = [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
    expect((await connectRoute.GET(new Request(`http://test/api/amazon/connect?storeId=${s.id}`, { headers: { cookie } }))).status).toBe(404);
  });
});
