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

const { GET, POST } = await import("@/app/api/seller/stores/[id]/approvals/route");
const { startSession } = await import("../session");
const { submitOffer } = await import("../negotiate");
const { startShopNegotiation } = await import("./negotiation");
const { approverPhones, createOrg } = await import("./orgs");
const { setPolicy } = await import("./policies");
const { createProduct } = await import("./products");
const { createStore, updateStore } = await import("./stores");
const { getDb } = await import("../db");
const { schema } = await import("@ghostcart/db");

let n = 0;
async function escalated() {
  const owner = `+9190000011${String(++n).padStart(2, "0")}`;
  const org = await createOrg({ name: "ZZ Approvals", ownerPhone: owner, ownerName: "ZZ Owner" });
  const store = (await updateStore((await createStore({ orgId: org.id, name: "ZZ Approvals Store", platform: "ghostcart_shop" })).id, { status: "live" }))!;
  await setPolicy(store.id, "store", null, { maxDiscountPct: 10, autoApprovePct: 5 });
  const product = await createProduct(store.id, { title: "ZZ Speaker", price: 5000, stock: 3 });
  let deal = await startShopNegotiation(product.id, "shopper-a");
  for (let i = 0; i < 4 && deal.status === "negotiating"; i++) deal = await submitOffer(deal, 4600);
  return { org, owner, store, deal };
}

const req = (body?: unknown) =>
  new Request("http://test/x", { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", cookie: [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ") }, body: body ? JSON.stringify(body) : undefined });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

beforeEach(() => {
  jar = new Map();
});

describe("seller approvals", () => {
  it("list the store's waiting offers and let the owner approve", async () => {
    const { owner, store, deal } = await escalated();
    expect(deal.status).toBe("awaiting_approval");
    await startSession("member", owner);
    const list = await (await GET(req(), ctx(store.id))).json();
    expect(list.waiting.map((d: { id: string }) => d.id)).toEqual([deal.id]);
    expect(list.waiting[0].terms).toMatchObject({ floor: 4500, autoLimit: 4750 });

    const res = await POST(req({ dealId: deal.id, decision: "approved" }), ctx(store.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "pending", dealPrice: 4600 });
  });

  it("bound counters between the shopper's offer and the list price", async () => {
    const { owner, store, deal } = await escalated();
    await startSession("member", owner);
    expect((await POST(req({ dealId: deal.id, decision: "counter", price: 4000 }), ctx(store.id))).status).toBe(400);
    expect((await POST(req({ dealId: deal.id, decision: "counter", price: 6000 }), ctx(store.id))).status).toBe(400);
    const ok = await POST(req({ dealId: deal.id, decision: "counter", price: 4700 }), ctx(store.id));
    expect(await ok.json()).toMatchObject({ status: "negotiating", dealPrice: 4700 });
  });

  it("keep other sellers and viewers from deciding", async () => {
    const a = await escalated();
    const b = await escalated();
    await startSession("member", b.owner);
    expect((await POST(req({ dealId: a.deal.id, decision: "approved" }), ctx(b.store.id))).status).toBe(404);
    expect((await POST(req({ dealId: a.deal.id, decision: "approved" }), ctx(a.store.id))).status).toBe(404);

    const db = await getDb();
    await db.insert(schema.members).values({ orgId: a.org.id, phone: "+919000001199", name: "ZZ Viewer", role: "viewer" });
    jar = new Map();
    await startSession("member", "+919000001199");
    expect((await GET(req(), ctx(a.store.id))).status).toBe(200);
    expect((await POST(req({ dealId: a.deal.id, decision: "approved" }), ctx(a.store.id))).status).toBe(403);
  });

  it("call the owner first, then admins and approvers", async () => {
    const { org, owner } = await escalated();
    const db = await getDb();
    await db.insert(schema.members).values([
      { orgId: org.id, phone: "+919000001198", name: "ZZ Approver", role: "approver" },
      { orgId: org.id, phone: "+919000001197", name: "ZZ Viewer2", role: "viewer" },
    ]);
    expect((await approverPhones(org.id)).map((p) => p.phone)).toEqual([owner, "+919000001198"]);
  });
});
