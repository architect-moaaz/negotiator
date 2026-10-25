import { afterEach, describe, expect, it, vi } from "vitest";
import type { Deal } from "./types";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
  vi.resetModules();
});

/** Load modules fresh under a given deployment, since payment mode is read at import. */
async function underEnv(vars: Record<string, string | undefined>) {
  vi.resetModules();
  Object.assign(process.env, vars);
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
  return {
    mock: await import("./pinelabs-mock"),
    payments: await import("./payments"),
    negotiate: await import("./negotiate"),
    haggle: await import("./haggle"),
    store: (await import("./store")).store,
    gateway: await import("@/app/api/mock-pinelabs-pay/route"),
  };
}

async function openDeal(m: Awaited<ReturnType<typeof underEnv>>, id: string): Promise<Deal> {
  const product = { title: "Sony WH-1000XM5 Headphones", seller: "Amazon", price: 19989, inStock: true };
  const { terms, bestSeller, originalPrice } = m.haggle.computeTerms(product, []);
  const deal: Deal = {
    id,
    product,
    alternatives: [],
    originalPrice,
    dealPrice: terms.opening,
    saved: originalPrice - terms.opening,
    perk: "",
    bestSeller,
    haggle: "",
    negotiation: { terms, currentOffer: terms.opening, rounds: 1, messages: [] },
    lockFee: 9,
    testPayments: false,
    createdAt: Date.now(),
    expiresAt: Date.now() + 600_000,
    status: "negotiating",
    channel: "web",
  };
  await m.store.saveDeal(deal, true);
  return deal;
}

describe("test payments", () => {
  it("are refused on the production deployment unless deliberately allowed", async () => {
    const prod = await underEnv({ VERCEL_ENV: "production", ALLOW_TEST_PAYMENTS: undefined });
    expect(prod.mock.pinelabsMockEnabled).toBe(false);
    expect(prod.payments.paymentsAvailable).toBe(false);
    const pay = await prod.gateway.POST(new Request("http://test/api/mock-pinelabs-pay", { method: "POST", body: JSON.stringify({ order: "x", action: "pay" }) }));
    expect(pay.status).toBe(404);

    const optedIn = await underEnv({ VERCEL_ENV: "production", ALLOW_TEST_PAYMENTS: "1" });
    expect(optedIn.payments.testPayments).toBe(true);
    expect(optedIn.payments.paymentsAvailable).toBe(true);
  });

  it("run on previews and locally, and every deal says it's test mode", async () => {
    const preview = await underEnv({ VERCEL_ENV: "preview" });
    const deal = await openDeal(preview, "pay-test-1");
    const accepted = await preview.negotiate.acceptOffer(deal);
    expect(accepted.status).toBe("pending");
    expect(accepted.testPayments).toBe(true);
    expect(accepted.upiIntent).toContain("/pay/mock/");
    expect(preview.negotiate.toPublic(accepted).testPayments).toBe(true);
  });
});

describe("when no gateway is available", () => {
  it("accepting a price explains that payments are paused and leaves the deal as it was", async () => {
    const off = await underEnv({ VERCEL_ENV: "production", ALLOW_TEST_PAYMENTS: undefined });
    const deal = await openDeal(off, "pay-off-1");
    await expect(off.negotiate.acceptOffer(deal)).rejects.toThrow(/payments are paused/);
    const saved = await off.store.getDeal("pay-off-1");
    expect(saved?.status).toBe("negotiating");
    expect(saved?.qrDataUrl).toBeUndefined();
  });

  it("never falls back to an unverifiable static UPI QR", async () => {
    const off = await underEnv({ VERCEL_ENV: "production", ALLOW_TEST_PAYMENTS: undefined, UPI_FALLBACK_VPA: "zz@upi" });
    await expect(off.payments.createDealPayment({ dealId: "pay-off-2", title: "x" })).rejects.toBeInstanceOf(off.payments.PaymentsUnavailableError);
  });
});
