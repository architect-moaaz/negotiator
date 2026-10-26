import { GhostCart, GhostCartError } from "@ghostcart/sdk";
import { describe, expect, it } from "vitest";
import { POST as decision } from "@/app/api/v1/approvals/[id]/decision/route";
import { POST as accept } from "@/app/api/v1/sessions/[id]/accept/route";
import { GET as events } from "@/app/api/v1/sessions/[id]/events/route";
import { POST as offers } from "@/app/api/v1/sessions/[id]/offers/route";
import { GET as getSession } from "@/app/api/v1/sessions/[id]/route";
import { POST as create } from "@/app/api/v1/sessions/route";
import { createApiKey } from "./integrations/keys";
import { createOrg } from "./shop/orgs";
import { setPolicy } from "./shop/policies";
import { createProduct } from "./shop/products";
import { createStore, updateStore } from "./shop/stores";

/** The SDK, with its fetches answered by the real route handlers. */
function sdk(secretKey: string) {
  const routes: [RegExp, (req: Request, ctx: never) => Promise<Response>][] = [
    [/^\/api\/v1\/sessions$/, create as never],
    [/^\/api\/v1\/sessions\/([^/]+)$/, getSession as never],
    [/^\/api\/v1\/sessions\/([^/]+)\/offers$/, offers as never],
    [/^\/api\/v1\/sessions\/([^/]+)\/accept$/, accept as never],
    [/^\/api\/v1\/sessions\/([^/]+)\/events$/, events as never],
    [/^\/api\/v1\/approvals\/([^/]+)\/decision$/, decision as never],
  ];
  const fake = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    for (const [re, handler] of routes) {
      const m = path.match(re);
      if (m) return handler(new Request(url, init), { params: Promise.resolve({ id: m[1] }) } as never);
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return new GhostCart({ secretKey, baseUrl: "http://ghostcart.test", fetch: fake });
}

let n = 0;
async function shop() {
  const org = await createOrg({ name: "ZZ API Co", ownerPhone: `+9190000090${String(++n).padStart(2, "0")}`, ownerName: "ZZ" });
  const s = (await updateStore((await createStore({ orgId: org.id, name: "ZZ API Store", platform: "ghostcart_shop" })).id, { status: "live", tier: "verified" }))!;
  await setPolicy(s.id, "store", null, { maxDiscountPct: 10, autoApprovePct: 5 });
  await createProduct(s.id, { title: "ZZ API Headphones", price: 5000, stock: 5, sku: `ZZAPI-${n}` });
  const { value } = await createApiKey(s, "secret", "zz-test");
  return { store: s, key: value, sku: `ZZAPI-${n}` };
}

describe("/api/v1/sessions", () => {
  it("runs a whole negotiation from the seller's own system: free text, escalation, decision, payment, events", async () => {
    const { key, sku } = await shop();
    const gc = sdk(key);
    const s = await gc.sessions.create({ product: sku, shopper: { id: "cust_42" } });
    expect(s).toMatchObject({ status: "negotiating", listPrice: 5000, product: { title: "ZZ API Headphones" } });
    expect(s.reply).toContain("Make me an offer");

    let cur = await gc.sessions.offer(s.id, { text: "can you do 4,600 rs?" });
    for (let i = 0; i < 3 && cur.status === "negotiating"; i++) cur = await gc.sessions.offer(s.id, { amount: 4600 });
    expect(cur).toMatchObject({ status: "awaiting_approval", awaitingApproval: { price: 4600 } });

    cur = await gc.approvals.decide(s.id, { decision: "approved", by: "ZZ Ops" });
    expect(cur).toMatchObject({ status: "pending", agreedPrice: 4600, payment: { lockFee: 9, testMode: true } });
    expect(cur.payment?.url).toContain(`/deal/${s.id}`);

    const seen = [];
    const abort = new AbortController();
    for await (const e of gc.sessions.events(s.id, { signal: abort.signal })) {
      seen.push(e.type);
      if (e.type === "approved") break;
    }
    expect(seen[0]).toBe("started");
    expect(seen).toContain("escalated");
    expect(seen.at(-1)).toBe("approved");
  });

  it("keeps stores apart and explains bad requests", async () => {
    const a = await shop();
    const b = await shop();
    const s = await sdk(a.key).sessions.create({ product: a.sku, shopper: { id: "c1" } });
    await expect(sdk(b.key).sessions.get(s.id)).rejects.toEqual(new GhostCartError("Session not found.", 404));
    await expect(sdk("gc_sk_nope").sessions.get(s.id)).rejects.toMatchObject({ status: 401 });
    await expect(sdk(a.key).sessions.create({ product: "NO-SUCH", shopper: { id: "c1" } })).rejects.toMatchObject({ status: 404 });
    await expect(sdk(a.key).sessions.create({ product: a.sku, shopper: { id: "bad id!" } })).rejects.toMatchObject({ status: 400 });
    await expect(sdk(a.key).sessions.offer(s.id, { text: "hmm, not sure" })).rejects.toMatchObject({ status: 422 });
    const accepted = await sdk(a.key).sessions.accept(s.id);
    expect(accepted.status).toBe("pending");
    await expect(sdk(a.key).sessions.offer(s.id, { amount: 4000 })).rejects.toMatchObject({ status: 409 });
  });
});
