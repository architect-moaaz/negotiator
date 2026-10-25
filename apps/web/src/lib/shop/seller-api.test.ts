import { beforeEach, describe, expect, it, vi } from "vitest";

let jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

const { POST: code } = await import("@/app/api/auth/code/route");
const { POST: verify } = await import("@/app/api/auth/verify/route");
const { GET: account } = await import("@/app/api/seller/account/route");
const { POST: onboard } = await import("@/app/api/seller/onboard/route");
const { GET: storeData } = await import("@/app/api/seller/stores/[id]/route");
const { POST: addProduct } = await import("@/app/api/seller/stores/[id]/products/route");
const { POST: importCsv } = await import("@/app/api/seller/stores/[id]/import/route");
const { PUT: putPolicy } = await import("@/app/api/seller/stores/[id]/policies/route");
const { store } = await import("../store");

let ip = 0;
const req = (path: string, body?: unknown, method = body ? "POST" : "GET") =>
  new Request(`http://test${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-forwarded-for": `10.2.0.${++ip}`, cookie: [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ") },
    body: body ? JSON.stringify(body) : undefined,
  });
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) }) as never;

async function signIn(phone: string) {
  jar = new Map();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  await store.kvDel(`otp-throttle:+91${phone}`);
  await code(req("/api/auth/code", { phone, role: "member" }));
  const sent = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes(`+91${phone}`));
  log.mockRestore();
  expect((await verify(req("/api/auth/verify", { phone, role: "member", code: sent?.match(/(\d{6})$/)?.[1] }))).status).toBe(200);
}

const onboarding = { businessName: "ZZ Kumar Traders", ownerName: "ZZ Kumar", storeName: "ZZ Kumar Mobiles", platform: "ghostcart_shop", maxDiscountPct: 12, autoApprovePct: 6 };

beforeEach(() => {
  jar = new Map();
});

describe("seller onboarding", () => {
  it("needs a verified number", async () => {
    expect((await account(req("/api/seller/account"))).status).toBe(401);
    expect((await onboard(req("/api/seller/onboard", onboarding))).status).toBe(401);
  });

  it("creates the business, store and default discount rules", async () => {
    await signIn("9000000701");
    const res = await onboard(req("/api/seller/onboard", onboarding));
    expect(res.status).toBe(200);
    const { store: s } = await res.json();
    expect(s).toMatchObject({ name: "ZZ Kumar Mobiles", slug: "zz-kumar-mobiles", status: "draft" });
    const acc = await (await account(req("/api/seller/account"))).json();
    expect(acc.orgs[0]).toMatchObject({ name: "ZZ Kumar Traders", role: "owner" });
    const data = await (await storeData(req(`/api/seller/stores/${s.id}`), ctx({ id: s.id }))).json();
    expect(data.policies.store).toMatchObject({ maxDiscountPct: 12, autoApprovePct: 6 });
  });

  it("asks website sellers for a real domain", async () => {
    await signIn("9000000702");
    const res = await onboard(req("/api/seller/onboard", { ...onboarding, platform: "website", domain: "not a domain" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("website address");
  });
});

describe("seller store access", () => {
  it("lets the owner run the catalogue and rules, and keeps other sellers out", async () => {
    await signIn("9000000703");
    const { store: s } = await (await onboard(req("/api/seller/onboard", onboarding))).json();

    const product = await (await addProduct(req(`/api/seller/stores/${s.id}/products`, { title: "Redmi 13C", price: 10000, category: "Phones" }), ctx({ id: s.id }))).json();
    expect(product.price).toBe(10000);
    const imported = await (await importCsv(req(`/api/seller/stores/${s.id}/import`, { csv: "title,price\nCase,500\nBad,\n" }), ctx({ id: s.id }))).json();
    expect(imported).toEqual({ created: 1, errors: ["Line 3: Add a price."] });

    const bad = await putPolicy(req(`/api/seller/stores/${s.id}/policies`, { scope: "product", targetId: product.id, policy: { maxDiscountPct: 5, autoApprovePct: 9 } }, "PUT"), ctx({ id: s.id }));
    expect(bad.status).toBe(400);
    const ok = await putPolicy(req(`/api/seller/stores/${s.id}/policies`, { scope: "product", targetId: product.id, policy: { floorPrice: 9500 } }, "PUT"), ctx({ id: s.id }));
    expect((await ok.json()).products[product.id]).toMatchObject({ floorPrice: 9500 });

    await signIn("9000000704"); // a different seller
    expect((await storeData(req(`/api/seller/stores/${s.id}`), ctx({ id: s.id }))).status).toBe(404);
    expect((await addProduct(req(`/api/seller/stores/${s.id}/products`, { title: "Sneaky", price: 1 }), ctx({ id: s.id }))).status).toBe(404);
    expect((await storeData(req("/api/seller/stores/st_doesnotexist"), ctx({ id: "st_doesnotexist" }))).status).toBe(404);
  });

  it("records seller actions in the activity log", async () => {
    await signIn("9000000705");
    const { store: s } = await (await onboard(req("/api/seller/onboard", onboarding))).json();
    await addProduct(req(`/api/seller/stores/${s.id}/products`, { title: "Logged item", price: 999 }), ctx({ id: s.id }));
    const trail = (await store.listLog(50)).filter((a) => a.type === "seller_action" && a.detail.includes(s.id));
    expect(trail.map((a) => a.detail.split(": ").slice(1).join(": "))).toEqual(expect.arrayContaining(["added Logged item at ₹999"]));
  });
});
