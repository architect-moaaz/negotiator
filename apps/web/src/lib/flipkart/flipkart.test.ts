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

const connect = await import("@/app/api/flipkart/connect/route");
const callback = await import("@/app/api/flipkart/callback/route");
const sync = await import("@/app/api/flipkart/sync/route");
const mock = await import("@/app/api/mock-flipkart/[...path]/route");
const { startSession } = await import("../session");
const { createOrg } = await import("../shop/orgs");
const { createStore, getStore } = await import("../shop/stores");
const { getProductByRef, importProductsCsv } = await import("../shop/products");
const { verificationChecklist } = await import("../verification/service");

const cookie = () => [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
beforeEach(() => {
  jar = new Map();
});

describe("Flipkart Seller Hub", () => {
  it("connects with OAuth (proving ownership), then syncs price, MRP, stock and status by SKU", async () => {
    const phone = "+919000009701";
    const org = await createOrg({ name: "ZZ Flipkart Seller", ownerPhone: phone, ownerName: "ZZ" });
    const store = await createStore({ orgId: org.id, name: "ZZ Flipkart Store", platform: "flipkart" });
    await startSession("member", phone);

    const start = await connect.GET(new Request(`http://test/api/flipkart/connect?storeId=${store.id}`, { headers: { cookie: cookie() } }));
    expect(start.status).toBe(302);
    const authorize = new URL(start.headers.get("location")!);
    expect(authorize.searchParams.get("scope")).toBe("Seller_Api");
    const consent = await mock.GET(new Request(authorize), { params: Promise.resolve({ path: authorize.pathname.replace("/api/mock-flipkart/", "").split("/") }) });
    const back = new URL(consent.headers.get("location")!);
    const done = await callback.GET(new Request(`http://test${back.pathname}${back.search}`));
    expect(done.headers.get("location")).toContain(`connected=flipkart`);
    expect((await verificationChecklist((await getStore(store.id))!)).steps.ownership).toBe("done");

    // The seller imports their listings file (titles), then syncs live numbers from Flipkart.
    await importProductsCsv(store.id, "Seller SKU Id,Product Title,Your Selling Price,MRP,System Stock\nFK-ZZ-1,ZZ Cotton Kurta,1800,1999,2\nFK-ZZ-3,ZZ Wool Shawl,2600,2999,1\nFK-ZZ-9,ZZ Not On Flipkart,500,,3\n");
    const res = await sync.POST(new Request("http://test/api/flipkart/sync", { method: "POST", headers: { cookie: cookie(), "Content-Type": "application/json" }, body: JSON.stringify({ storeId: store.id }) }));
    expect(await res.json()).toEqual({ updated: 2, missing: ["FK-ZZ-9"] });
    expect(await getProductByRef(store.id, "FK-ZZ-1")).toMatchObject({ title: "ZZ Cotton Kurta", price: 1649, mrp: 1999, stock: 14, status: "active" });
    expect(await getProductByRef(store.id, "FK-ZZ-3")).toMatchObject({ price: 2499, stock: 0, status: "draft" });
    expect(await getProductByRef(store.id, "FK-ZZ-9")).toMatchObject({ price: 500, stock: 3 });
  });

  it("refuses an expired or forged callback and a store that isn't a Flipkart store", async () => {
    expect((await callback.GET(new Request("http://test/api/flipkart/callback?state=never&code=x"))).status).toBe(400);
    const phone = "+919000009702";
    const org = await createOrg({ name: "ZZ Not Flipkart", ownerPhone: phone, ownerName: "ZZ" });
    const store = await createStore({ orgId: org.id, name: "ZZ Shop", platform: "ghostcart_shop" });
    await startSession("member", phone);
    expect((await connect.GET(new Request(`http://test/api/flipkart/connect?storeId=${store.id}`, { headers: { cookie: cookie() } }))).status).toBe(409);
  });
});
