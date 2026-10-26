import { beforeEach, describe, expect, it, vi } from "vitest";

let jar = new Map<string, string>();
let hdrs = new Headers();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => hdrs,
}));

const { POST: register } = await import("@/app/api/push/route");
const { GET: sentLog } = await import("@/app/api/mock-expo-push/route");
const { issueSessionToken, currentSubject, sessionTokenFromRequest } = await import("./session");
const { notifyBuyer, registerPushToken } = await import("./push");
const { decideApproval, submitOffer } = await import("./negotiate");
const { startShopNegotiation } = await import("./shop/negotiation");
const { createOrg } = await import("./shop/orgs");
const { setPolicy } = await import("./shop/policies");
const { createProduct } = await import("./shop/products");
const { createStore, updateStore } = await import("./shop/stores");
const { signUp } = await import("./users");
const { recordConsent } = await import("./privacy/consent");
const { getDb } = await import("./db");
const { schema } = await import("@ghostcart/db");

const sent = async () => (await (await sentLog()).json()) as { to: string; title: string; body: string; data: { type: string; dealId: string } }[];
let n = 0;
const token = (tag = "") => `ExponentPushToken[zz${tag}${++n}${Math.random().toString(36).slice(2, 8)}]`;

beforeEach(() => {
  jar = new Map();
  hdrs = new Headers();
});

describe("app sessions", () => {
  it("accept the token in the x-gc-<kind> header, but only for that kind", async () => {
    const t = await issueSessionToken("buyer", "zz-app-user");
    hdrs = new Headers({ "x-gc-buyer": t });
    expect(await currentSubject("buyer")).toBe("zz-app-user");
    expect(await currentSubject("member")).toBeUndefined();
    expect(sessionTokenFromRequest("member", new Request("http://x", { headers: { "x-gc-member": "abc" } }))).toBe("abc");
  });
});

describe("push", () => {
  it("registers only Expo tokens for a signed-in account", async () => {
    const req = (body: unknown) => new Request("http://x/api/push", { method: "POST", body: JSON.stringify(body) });
    expect((await register(req({ token: token(), platform: "ios" }))).status).toBe(401);
    hdrs = new Headers({ "x-gc-member": await issueSessionToken("member", "+919000007001") });
    expect((await register(req({ token: "not-a-token", platform: "ios" }))).status).toBe(400);
    const ok = await register(req({ token: token(), platform: "android" }));
    expect(await ok.json()).toEqual({ ok: true, as: ["member"] });
    // Signed in as a seller and a shopper on the same phone: both roles get notifications.
    hdrs.set("x-gc-buyer", await issueSessionToken("buyer", "zz-both-user"));
    const both = await register(req({ token: token(), platform: "ios" }));
    expect(await both.json()).toEqual({ ok: true, as: ["member", "buyer"] });
  });

  it("tells the store's approvers about an offer, and the shopper about the decision (if they allow contact)", async () => {
    const owner = "+919000007002";
    const org = await createOrg({ name: "ZZ Push", ownerPhone: owner, ownerName: "ZZ Owner" });
    const s = (await updateStore((await createStore({ orgId: org.id, name: "ZZ Push Store", platform: "ghostcart_shop" })).id, { status: "live", tier: "verified" }))!;
    await setPolicy(s.id, "store", null, { maxDiscountPct: 10, autoApprovePct: 5 });
    const p = await createProduct(s.id, { title: "ZZ Push Speaker", price: 5000, stock: 3 });
    const shopper = await signUp({ name: "ZZ Push Shopper", phone: "+919000007003", channel: "web", consent: true });
    const ownerPhone = token("owner");
    const shopperPhone = token("shopper");
    await registerPushToken("member", owner, ownerPhone, "ios");
    await registerPushToken("buyer", shopper.id, shopperPhone, "android");

    let deal = await startShopNegotiation(p.id, shopper.id);
    for (let i = 0; i < 4 && deal.status === "negotiating"; i++) deal = await submitOffer(deal, 4600);
    expect(deal.status).toBe("awaiting_approval");
    const toOwner = (await sent()).filter((m) => m.to === ownerPhone);
    expect(toOwner.at(-1)).toMatchObject({ title: "Offer: ₹4,600", data: { type: "approval", dealId: deal.id, storeId: s.id } });

    deal = await decideApproval(deal, "rejected", "ZZ Owner", "seller");
    expect((await sent()).filter((m) => m.to === shopperPhone).at(-1)).toMatchObject({ data: { type: "deal", dealId: deal.id } });

    await recordConsent(shopper.id, "deal_contact", "withdrawn", "Withdrew", "test");
    expect(await notifyBuyer(shopper.id, { title: "x", body: "y", data: { type: "deal", dealId: deal.id } })).toBe(0);
  });

  it("forgets tokens Expo says are dead", async () => {
    const dead = token("dead");
    await registerPushToken("buyer", "zz-dead-user", dead, "ios");
    await recordConsent("zz-dead-user", "deal_contact", "granted", "ok", "test");
    const { store } = await import("./store");
    await store.upsertUser({ id: "zz-dead-user", name: "ZZ Dead", phone: "+919000007004", channel: "web", createdAt: Date.now(), consentAt: Date.now() });
    expect(await notifyBuyer("zz-dead-user", { title: "x", body: "y", data: { type: "deal", dealId: "d" } })).toBe(0);
    const db = await getDb();
    expect(await db.select().from(schema.pushTokens).where((await import("drizzle-orm")).eq(schema.pushTokens.token, dead))).toEqual([]);
  });
});
