import { createTestDb } from "@ghostcart/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { computeTerms } from "./haggle";
import { createPgStore, type PgStore } from "./pg-store";
import { composeStore, legacyStore } from "./store";
import type { Deal, Product, Seller, User } from "./types";

const product: Product = { title: "Sony WH-1000XM5 Headphones", seller: "Amazon", price: 19989, inStock: true };

function deal(id: string, createdAt = Date.now(), status: Deal["status"] = "negotiating"): Deal {
  const { terms, bestSeller, originalPrice } = computeTerms(product, []);
  return {
    id,
    product,
    alternatives: [],
    originalPrice,
    dealPrice: terms.opening,
    saved: originalPrice - terms.opening,
    perk: "Free instant shipping",
    bestSeller,
    haggle: "",
    negotiation: { terms, currentOffer: terms.opening, rounds: 0, messages: [] },
    lockFee: 9,
    testPayments: true,
    createdAt,
    expiresAt: createdAt + 600_000,
    status,
    channel: "web",
    userId: "u1",
  };
}

const user = (id: string, phone: string): User => ({ id, name: "ZZ Test", phone, channel: "web", createdAt: Date.now(), consentAt: Date.now() });
const seller: Seller = {
  id: "s1",
  storeName: "ZZ Clicktech",
  aliases: ["zz clicktech retail", "zz clicktech"],
  contactName: "ZZ",
  phone: "+919000000002",
  budgetPct: 0.05,
  autoApproveShare: 0.6,
  createdAt: Date.now(),
};

describe("postgres store", () => {
  let pg: PgStore;
  beforeEach(async () => {
    pg = createPgStore(await createTestDb());
  });

  it("round-trips deals, bumps the version on every save and lists newest first", async () => {
    await pg.saveDeal(deal("d-old", Date.now() - 60_000));
    const d = deal("d-new");
    await pg.saveDeal(d);
    d.status = "pending";
    await pg.saveDeal(d);
    expect(await pg.getDeal("d-new")).toEqual(d);
    expect((await pg.listDeals()).map((x) => x.id)).toEqual(["d-new", "d-old"]);
    expect(await pg.getDeal("missing")).toBeUndefined();
  });

  it("keeps one account per phone", async () => {
    const first = await pg.upsertUser(user("u1", "+919000000001"));
    const again = await pg.upsertUser(user("u2", "+919000000001"));
    expect(first.created).toBe(true);
    expect(again).toMatchObject({ created: false, user: { id: "u1" } });
    expect(await pg.userIdForPhone("+919000000001")).toBe("u1");
    expect(await pg.getUser("u1")).toEqual(first.user);
  });

  it("finds sellers by alias, token and phone", async () => {
    await pg.saveSeller(seller, "token-hash");
    expect(await pg.sellerIdForAlias("zz clicktech")).toBe("s1");
    expect(await pg.sellerIdForToken("token-hash")).toBe("s1");
    expect(await pg.sellerIdForPhone(seller.phone)).toBe("s1");
    expect((await pg.getSeller("s1"))?.aliases.sort()).toEqual([...seller.aliases].sort());
    expect(await pg.listSellers()).toHaveLength(1);
  });

  it("accumulates counters and demand", async () => {
    await pg.incrStats({ deals: 1, saved: 500 });
    await pg.incrStats({ deals: 1, saved: 250, paid: 0 });
    expect(await pg.stats()).toEqual({ users: 0, deals: 2, paid: 0, saved: 750 });
    await pg.recordDemand("amazon:a", "Seller A", "Amazon");
    await pg.recordDemand("amazon:b", "Seller B", "Amazon");
    await pg.recordDemand("amazon:b", "Seller B", "Amazon");
    expect(await pg.topDemand()).toEqual([
      { key: "amazon:b", name: "Seller B", marketplace: "Amazon", count: 2 },
      { key: "amazon:a", name: "Seller A", marketplace: "Amazon", count: 1 },
    ]);
  });

  it("returns the activity log and visits newest first", async () => {
    await pg.log({ at: 1000, type: "signup", actor: "user", userId: "u1", detail: "first" });
    await pg.log({ at: 2000, type: "login", actor: "user", userId: "u1", detail: "second" });
    expect((await pg.listLog()).map((a) => a.detail)).toEqual(["second", "first"]);
    await pg.pushVisit({ vid: "v1", path: "/", at: 1000, city: "Bengaluru", device: "mobile" });
    expect(await pg.listVisits()).toEqual([{ vid: "v1", path: "/", at: 1000, city: "Bengaluru", device: "mobile" }]);
  });
});

describe("store modes", () => {
  it("dual mode writes to both and reads from Redis/memory", async () => {
    const pg = createPgStore(await createTestDb());
    const store = composeStore(legacyStore, pg, "dual");
    await store.saveDeal(deal("dual-1"), true);
    const { created } = await store.upsertUser(user("dual-u", "+919000000011"));
    await store.log({ type: "signup", actor: "user", userId: "dual-u", detail: "ZZ dual" });
    expect(created).toBe(true);
    expect(await pg.getDeal("dual-1")).toMatchObject({ id: "dual-1" });
    expect(await pg.userIdForPhone("+919000000011")).toBe("dual-u");
    expect((await pg.stats()).users).toBe(1);
    expect((await pg.listLog())[0].detail).toBe("ZZ dual");
    expect(await legacyStore.getDeal("dual-1")).toMatchObject({ id: "dual-1" });
  });

  it("dual mode survives a Postgres outage", async () => {
    const broken = new Proxy({} as PgStore, { get: () => async () => Promise.reject(new Error("db down")) });
    const store = composeStore(legacyStore, broken, "dual");
    await expect(store.saveDeal(deal("dual-outage"), true)).resolves.toMatchObject({ id: "dual-outage" });
    expect(await store.getDeal("dual-outage")).toMatchObject({ id: "dual-outage" });
  });

  it("postgres mode reads Postgres and still expires stale deals", async () => {
    const pg = createPgStore(await createTestDb());
    const store = composeStore(legacyStore, pg, "postgres");
    await store.saveDeal(deal("pg-stale", Date.now() - 3_600_000, "pending"), true);
    expect(await legacyStore.getDeal("pg-stale")).toBeUndefined();
    expect((await store.getDeal("pg-stale"))?.status).toBe("expired");
  });

  it("falls back to Redis/memory without a database", () => {
    expect(composeStore(legacyStore, null, "postgres").mode).toBe("redis");
  });
});

describe("postgres compare-and-set", () => {
  it("rejects a save from a stale copy in postgres mode and keeps the dual-mode mirror in step", async () => {
    const pg = createPgStore(await createTestDb());
    const store = composeStore(legacyStore, pg, "postgres");
    const d = await store.saveDeal(deal(`zz-cas-${Date.now()}`), true);
    expect(d.version).toBe(1);
    const a = (await store.getDeal(d.id))!;
    const b = (await store.getDeal(d.id))!;
    a.dealPrice -= 100;
    await store.saveDeal(a);
    b.dealPrice -= 200;
    await expect(store.saveDeal(b)).rejects.toThrow("just changed");
    expect((await store.getDeal(d.id))!).toMatchObject({ version: 2, dealPrice: a.dealPrice });

    const dualPg = createPgStore(await createTestDb());
    const dual = composeStore(legacyStore, dualPg, "dual");
    const m = await dual.saveDeal(deal(`zz-cas-dual-${Date.now()}`), true);
    m.dealPrice -= 50;
    await dual.saveDeal(m);
    expect(await dualPg.getDeal(m.id)).toMatchObject({ version: 2, dealPrice: m.dealPrice });
  });
});
