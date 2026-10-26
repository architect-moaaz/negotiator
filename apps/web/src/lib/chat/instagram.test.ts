import { createHmac } from "node:crypto";
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

const connectRoute = await import("@/app/api/instagram/connect/route");
const callbackRoute = await import("@/app/api/instagram/callback/route");
const webhook = await import("@/app/api/meta/webhook/route");
const mock = await import("@/app/api/mock-meta/[...path]/route");
const { metaConfig } = await import("../meta/config");
const { startSession } = await import("../session");
const { createOrg } = await import("../shop/orgs");
const { setPolicy } = await import("../shop/policies");
const { createProduct } = await import("../shop/products");
const { createStore, updateStore } = await import("../shop/stores");
const { store: kv } = await import("../store");

let n = 0;
async function connectedShop() {
  const owner = `+9190000022${String(++n).padStart(2, "0")}`;
  const org = await createOrg({ name: "ZZ IG Seller", ownerPhone: owner, ownerName: "ZZ" });
  const s = (await updateStore((await createStore({ orgId: org.id, name: "ZZ IG Store", platform: "ghostcart_shop" })).id, { status: "live", tier: "verified" }))!;
  await setPolicy(s.id, "store", null, { maxDiscountPct: 10, autoApprovePct: 5 });
  await createProduct(s.id, { title: "ZZ IG Earrings", price: 1200, stock: 3 });
  jar = new Map();
  await startSession("member", owner);
  const cookie = [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
  const start = await connectRoute.GET(new Request(`http://test/api/instagram/connect?storeId=${s.id}`, { headers: { cookie } }));
  const dialog = new URL(start.headers.get("location")!);
  expect(dialog.searchParams.get("scope")).toContain("instagram_manage_messages");
  const approved = await mock.GET(new Request(dialog), { params: Promise.resolve({ path: dialog.pathname.replace("/api/mock-meta/", "").split("/") }) });
  const back = new URL(approved.headers.get("location")!);
  const done = await callbackRoute.GET(new Request(`http://test${back.pathname}${back.search}`));
  expect(done.headers.get("location")).toContain(`/seller?store=${s.id}&connected=instagram`);
  return s;
}

async function dm(text: string, opts: { echo?: boolean; mid?: string; sender?: string } = {}) {
  const body = JSON.stringify({ object: "instagram", entry: [{ id: "17841400000000001", messaging: [{ sender: { id: opts.sender ?? "ig-shopper-1" }, recipient: { id: "17841400000000001" }, message: { mid: opts.mid ?? `mid.${Math.random()}`, text, is_echo: opts.echo } }] }] });
  return webhook.POST(new Request("http://test/api/meta/webhook", { method: "POST", headers: { "X-Hub-Signature-256": `sha256=${createHmac("sha256", metaConfig().appSecret).update(body).digest("hex")}` }, body }));
}
const sent = async () => ((await kv.kvGet<{ recipient: { id: string }; message: { text: string } }[]>("mockmeta:sent:3099000000001")) ?? []).map((m) => m.message.text);

beforeEach(() => {
  jar = new Map();
});

describe("haggling in Instagram DMs", () => {
  it("connects through Facebook Login and haggles to a payment link in DMs", async () => {
    await connectedShop();
    const before = (await sent()).length;
    await dm("hey, price?");
    expect((await sent()).at(-1)).toContain("1. ZZ IG Earrings, ₹1,200");
    await dm("1");
    await dm("1150");
    await dm("ok");
    expect((await sent()).at(-1)).toMatch(/Lock it with a ₹9 UPI payment/);
    expect((await sent()).length - before).toBe(4);
  });

  it("ignores echoes of our own replies and retried messages", async () => {
    await connectedShop();
    const before = (await sent()).length;
    await dm("our own reply", { echo: true });
    await dm("hi", { mid: "mid.same", sender: "ig-shopper-2" });
    await dm("hi", { mid: "mid.same", sender: "ig-shopper-2" });
    expect((await sent()).length - before).toBe(1);
  });
});
