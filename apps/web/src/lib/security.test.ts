import { beforeEach, describe, expect, it, vi } from "vitest";

// A cookie jar standing in for next/headers, swapped per "browser".
type Jar = Map<string, string>;
let jar: Jar = new Map();
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

const { POST: signup } = await import("@/app/api/signup/route");
const { POST: checkout } = await import("@/app/api/deal/checkout/route");
const { GET: getDeal } = await import("@/app/api/deal/route");
const { DELETE: logout } = await import("@/app/api/me/route");
const { rateLimit } = await import("./rate-limit");
const { currentSubject, startSession, endSession } = await import("./session");
const { currentUser } = await import("./users");
const { store } = await import("./store");
const { computeTerms } = await import("./haggle");

let ipCounter = 0;
const post = (path: string, body: unknown, ip = `10.0.0.${++ipCounter}`) =>
  new Request(`http://test${path}`, { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });

/** Dev mode prints the code instead of calling; capture it. */
async function requestCode(send: () => Promise<Response>) {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const res = await send();
  const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes("login code"));
  log.mockRestore();
  return { res, code: line?.match(/(\d{6})$/)?.[1] };
}

beforeEach(() => {
  jar = new Map();
});

describe("sessions", () => {
  it("keep the account id out of the cookie and stop working once ended", async () => {
    await startSession("buyer", "user-123");
    const token = jar.get("gc_session")!;
    expect(token).toBeTruthy();
    expect(token).not.toContain("user-123");
    expect(await currentSubject("buyer")).toBe("user-123");

    await endSession("buyer");
    jar.set("gc_session", token); // replaying the old cookie
    expect(await currentSubject("buyer")).toBeUndefined();
  });

  it("ignore the old unsigned gc_uid cookie", async () => {
    const { user } = await store.upsertUser({ id: "legacy-u", name: "ZZ Legacy", phone: "+919000000301", channel: "web", createdAt: Date.now() });
    jar.set("gc_uid", user.id);
    expect(await currentUser()).toBeUndefined();
  });
});

describe("shopper signup", () => {
  const details = { name: "ZZ Signup", phone: "9000000302", consent: true };

  it("needs the code we phone before it creates an account", async () => {
    const { res, code } = await requestCode(() => signup(post("/api/signup", details)));
    expect(await res.json()).toMatchObject({ codeSent: true });
    expect(await store.userIdForPhone("+919000000302")).toBeUndefined();
    expect(jar.size).toBe(0);

    const wrong = await signup(post("/api/signup", { ...details, code: code === "000000" ? "111111" : "000000" }));
    expect(wrong.status).toBe(400);
    expect(await store.userIdForPhone("+919000000302")).toBeUndefined();

    const ok = await signup(post("/api/signup", { ...details, code }));
    expect(ok.status).toBe(200);
    expect((await currentUser())?.phone).toBe("+919000000302");
  });

  it("signs an existing number back in once the code is proven", async () => {
    const phone = { ...details, phone: "9000000303" };
    const first = await requestCode(() => signup(post("/api/signup", phone)));
    const created = await (await signup(post("/api/signup", { ...phone, code: first.code }))).json();
    await logout();
    await store.kvDel("otp-throttle:+919000000303"); // skip the 40s resend wait
    const again = await requestCode(() => signup(post("/api/signup", { ...phone, name: "Someone Else" })));
    const back = await (await signup(post("/api/signup", { ...phone, name: "Someone Else", code: again.code }))).json();
    expect(back.id).toBe(created.id);
    expect(back.name).toBe("ZZ Signup");
  });
});

describe("deal ownership", () => {
  const product = { title: "Sony WH-1000XM5 Headphones", seller: "Amazon", price: 19989, inStock: true };

  async function paidDeal(id: string, userId: string) {
    const { terms, bestSeller, originalPrice } = computeTerms(product, []);
    await store.saveDeal(
      {
        id,
        product,
        alternatives: [],
        originalPrice,
        dealPrice: 19500,
        saved: originalPrice - 19500,
        perk: "",
        bestSeller,
        haggle: "",
        negotiation: { terms, currentOffer: 19500, rounds: 1, messages: [] },
        lockFee: 9,
        testPayments: false,
        createdAt: Date.now(),
        expiresAt: Date.now() + 600_000,
        status: "paid",
        channel: "web",
        userId,
        checkout: {
          status: "awaiting",
          openedAt: Date.now(),
          dueAt: Date.now() + 600_000,
          amount: 19491,
          address: { name: "ZZ Owner", phone: "+919000000305", line1: `${Math.random().toString(36).slice(2, 8)} Test Street`, city: "Bengaluru", state: "Karnataka", pincode: "560038" },
        },
      },
      true,
    );
  }

  it("lets only the deal's shopper check out or see the delivery name", async () => {
    await paidDeal("own-1", "owner-u");
    await startSession("buyer", "intruder-u");
    const address = { name: "ZZ Intruder", phone: "9000000306", line1: "2 Other Street", city: "Pune", state: "Maharashtra", pincode: "411001" };
    expect((await checkout(post("/api/deal/checkout", { id: "own-1", action: "address", address }))).status).toBe(403);
    const seen = await (await getDeal(new Request("http://test/api/deal?id=own-1"))).json();
    expect(seen.checkout.deliverTo).toBeUndefined();

    jar = new Map();
    await startSession("buyer", "owner-u");
    const mine = await (await getDeal(new Request("http://test/api/deal?id=own-1"))).json();
    expect(mine.checkout.deliverTo).toMatchObject({ name: "ZZ Owner" });
  });

  it("no longer accepts simulated payments", async () => {
    await paidDeal("own-2", "owner-u");
    await startSession("buyer", "owner-u");
    expect((await checkout(post("/api/deal/checkout", { id: "own-2", action: "simulate" }))).status).toBe(400);
    expect((await store.getDeal("own-2"))?.checkout?.status).toBe("awaiting");
  });
});

describe("rate limits", () => {
  it("allow up to the limit, then answer 429 with Retry-After", async () => {
    const limit = { name: "test", id: "k1", max: 2, windowSeconds: 60 };
    expect(await rateLimit(limit)).toBeNull();
    expect(await rateLimit(limit)).toBeNull();
    const blocked = await rateLimit(limit);
    expect(blocked?.status).toBe(429);
    expect(Number(blocked?.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await rateLimit({ ...limit, id: "k2" })).toBeNull();
  });

  it("cap login-code calls per number", async () => {
    const body = { name: "ZZ Limit", phone: "9000000307", consent: true };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      await store.kvDel("otp-throttle:+919000000307"); // skip the 40s resend wait to reach the hourly cap
      statuses.push((await signup(post("/api/signup", body))).status);
    }
    log.mockRestore();
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });
});
