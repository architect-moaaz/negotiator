import { expect, test } from "@playwright/test";

/**
 * Negotiate → escalate → approve through the public API, as a seller's system would. Needs a ZZ test
 * store on the deployment: E2E_SECRET_KEY (its gc_sk_ key) and E2E_SKU (a product with a store policy
 * that escalates offers below ~95% of list). Skipped when they aren't set.
 */
const key = process.env.E2E_SECRET_KEY;
const sku = process.env.E2E_SKU;

test.describe("negotiation API", () => {
  test.skip(!key || !sku, "set E2E_SECRET_KEY and E2E_SKU for a ZZ test store");

  test("negotiates, escalates and gets approved", async ({ request }) => {
    const auth = { Authorization: `Bearer ${key}` };
    const created = await request.post("/api/v1/sessions", { headers: auth, data: { product: sku, shopper: { id: `zz-e2e-${Date.now()}` } } });
    expect(created.status()).toBe(201);
    const s = await created.json();
    let cur = s;
    const low = Math.round(s.listPrice * 0.9);
    for (let i = 0; i < 4 && cur.status === "negotiating"; i++) cur = await (await request.post(`/api/v1/sessions/${s.id}/offers`, { headers: auth, data: { amount: low } })).json();
    expect(cur.status).toBe("awaiting_approval");
    const approved = await (await request.post(`/api/v1/approvals/${s.id}/decision`, { headers: auth, data: { decision: "approved", by: "ZZ E2E" } })).json();
    expect(approved.status).toBe("pending");
    expect(approved.agreedPrice).toBe(low);
  });
});
