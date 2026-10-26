import { beforeEach, describe, expect, it, vi } from "vitest";

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

process.env.STAFF = "9000000501:owner:ZZ Owner, 9000000502:approver:ZZ Approver, 9000000503:viewer:ZZ Viewer, 123:owner:Bad Number, 9000000504:superuser:Bad Role";
process.env.ADMIN_TOKEN = "zz-service-token";

const { staffRoster } = await import("./staff");
const { POST: code } = await import("@/app/api/auth/code/route");
const { POST: verify } = await import("@/app/api/auth/verify/route");
const { GET: logs } = await import("@/app/api/admin/logs/route");
const { GET: analytics } = await import("@/app/api/admin/analytics/route");
const { POST: decision } = await import("@/app/api/admin/decision/route");
const { store } = await import("./store");
const { computeTerms } = await import("@ghostcart/agent");

let ip = 0;
const json = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://test${path}`, { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": `10.1.0.${++ip}`, ...headers }, body: JSON.stringify(body) });
/** Route handlers read the staff cookie from the Request; mirror the jar into a Cookie header. */
const withCookies = (url: string, init: RequestInit = {}) =>
  new Request(`http://test${url}`, { ...init, headers: { ...(init.headers as Record<string, string>), cookie: [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ") } });

async function logInStaff(phone: string) {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  await store.kvDel(`otp-throttle:+91${phone}`);
  await code(json("/api/auth/code", { phone, role: "staff" }));
  const sent = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes(`+91${phone}`));
  log.mockRestore();
  return verify(json("/api/auth/verify", { phone, role: "staff", code: sent?.match(/(\d{6})$/)?.[1] }));
}

async function escalatedDeal(id: string) {
  const product = { title: "Sony WH-1000XM5 Headphones", seller: "Amazon", price: 19989, inStock: true };
  const { terms, bestSeller, originalPrice } = computeTerms(product, []);
  await store.saveDeal(
    {
      id,
      product,
      alternatives: [],
      originalPrice,
      dealPrice: 19495,
      saved: originalPrice - 19495,
      perk: "",
      bestSeller,
      haggle: "",
      negotiation: { terms, currentOffer: 19495, rounds: 2, messages: [], approval: { price: 19200, requestedAt: Date.now() } },
      lockFee: 9,
      testPayments: false,
      createdAt: Date.now(),
      expiresAt: Date.now() + 600_000,
      status: "awaiting_approval",
      channel: "web",
    },
    true,
  );
}

beforeEach(() => {
  jar = new Map();
});

describe("staff roster", () => {
  it("keeps valid numbers and roles only", () => {
    const roster = staffRoster();
    expect([...roster.values()].map((s) => `${s.name}:${s.role}`)).toEqual(["ZZ Owner:owner", "ZZ Approver:approver", "ZZ Viewer:viewer"]);
  });
});

describe("staff access", () => {
  it("refuses people who aren't on the staff list", async () => {
    expect((await code(json("/api/auth/code", { phone: "9000000599", role: "staff" }))).status).toBe(404);
    expect((await logs(withCookies("/api/admin/logs"))).status).toBe(401);
  });

  it("lets a viewer see analytics but not raw logs or decisions, and records the refusal", async () => {
    expect((await logInStaff("9000000503")).status).toBe(200);
    expect(jar.get("gc_staff")).toBeTruthy();
    expect((await analytics(withCookies("/api/admin/analytics"))).status).toBe(200);
    expect((await logs(withCookies("/api/admin/logs"))).status).toBe(403);
    await escalatedDeal("staff-v1");
    const refused = await decision(withCookies("/api/admin/decision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "staff-v1", decision: "approved" }) }));
    expect(refused.status).toBe(403);
    expect((await store.getDeal("staff-v1"))?.status).toBe("awaiting_approval");
    expect((await store.listLog(20)).some((a) => a.type === "staff_denied" && a.detail.includes("ZZ Viewer"))).toBe(true);
  });

  it("credits an approver's decision to them, not to a name in the request", async () => {
    await logInStaff("9000000502");
    await escalatedDeal("staff-a1");
    const res = await decision(withCookies("/api/admin/decision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "staff-a1", decision: "approved", by: "Someone Else" }) }));
    expect(res.status).toBe(200);
    const deal = await store.getDeal("staff-a1");
    expect(deal?.negotiation?.approval?.decidedBy).toBe("ZZ Approver");
    const trail = (await store.listLog(50)).filter((a) => a.dealId === "staff-a1");
    expect(trail.some((a) => a.type === "staff_action" && a.detail.startsWith("ZZ Approver (approver) approved"))).toBe(true);
  });

  it("locks out someone removed from the roster mid-session", async () => {
    await logInStaff("9000000501");
    expect((await logs(withCookies("/api/admin/logs"))).status).toBe(200);
    const before = process.env.STAFF;
    process.env.STAFF = "9000000502:approver:ZZ Approver";
    expect((await logs(withCookies("/api/admin/logs"))).status).toBe(401);
    process.env.STAFF = before;
  });

  it("still accepts the deprecated service token, and audits its actions", async () => {
    await escalatedDeal("staff-s1");
    const res = await decision(json("/api/admin/decision", { id: "staff-s1", decision: "rejected" }, { authorization: "Bearer zz-service-token" }));
    expect(res.status).toBe(200);
    expect((await store.listLog(50)).some((a) => a.dealId === "staff-s1" && a.detail.startsWith("Service token (owner) rejected"))).toBe(true);
    expect((await decision(json("/api/admin/decision", { id: "staff-s1", decision: "rejected" }, { authorization: "Bearer wrong-token-value" }))).status).toBe(401);
  });
});
