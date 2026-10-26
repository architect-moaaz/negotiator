import { randomBytes } from "node:crypto";
import { paymentsAvailable, testPayments } from "../payments";
import { store as kv } from "../store";

/**
 * Where the buyer's money actually sits. The payment aggregator (Pine Labs) settles the seller's share
 * on hold, releases it after the dispute window, and refunds the buyer when needed. GhostCart only
 * instructs; it never holds buyer money itself.
 *
 * The Pine Labs split/hold API comes with the partner agreement; until an adapter for it exists,
 * production has no settlement gateway and shop checkout stays closed. "mock" runs wherever test
 * payments are allowed (development, previews, or production with ALLOW_TEST_PAYMENTS=1).
 */
export interface SettlementGateway {
  name: string;
  /** Settle the seller's share on hold for an order. */
  hold(input: { orderId: string; sellerAccountRef: string; amount: number }): Promise<{ ref: string }>;
  release(ref: string): Promise<void>;
  /** Refund the buyer (paise). */
  refund(input: { orderId: string; amount: number; reason: string }): Promise<{ ref: string }>;
  /** What the gateway says it settled, for reconciliation. */
  settlements(orderId: string): Promise<{ held: number; released: number; refunded: number }>;
  /** The settlement report for an IST day (YYYY-MM-DD): every hold, release and refund it processed. */
  report(day: string): Promise<SettlementLine[]>;
}

/** One line of the aggregator's daily settlement report. Paise. */
export interface SettlementLine {
  orderId: string;
  kind: "hold" | "release" | "refund";
  amount: number;
  ref: string;
  at: string;
}

const istDay = (at: number) => new Date(at + 330 * 60 * 1000).toISOString().slice(0, 10);
/** The mock's report: an append-only list per day, like the CSV/API report Pine Labs sends. */
async function logLine(line: Omit<SettlementLine, "at">) {
  const now = Date.now();
  const key = `settle:report:${istDay(now)}`;
  const lines = (await kv.kvGet<SettlementLine[]>(key)) ?? [];
  await kv.kvSet(key, [...lines, { ...line, at: new Date(now).toISOString() }], 400 * 24 * 60 * 60);
}

interface MockSettlement {
  orderId: string;
  amount: number;
  state: "held" | "released";
  refunded: number;
}

const mock: SettlementGateway = {
  name: "mock",
  async hold({ orderId, amount }) {
    const ref = `mockhold_${randomBytes(6).toString("hex")}`;
    await kv.kvSet<MockSettlement>(`settle:${ref}`, { orderId, amount, state: "held", refunded: 0 }, 400 * 24 * 60 * 60);
    await kv.kvSet(`settle:order:${orderId}`, ref, 400 * 24 * 60 * 60);
    await logLine({ orderId, kind: "hold", amount, ref });
    return { ref };
  },
  async release(ref) {
    const s = await kv.kvGet<MockSettlement>(`settle:${ref}`);
    if (!s) throw new Error(`unknown hold ${ref}`);
    await kv.kvSet(`settle:${ref}`, { ...s, state: "released" }, 400 * 24 * 60 * 60);
    await logLine({ orderId: s.orderId, kind: "release", amount: Math.max(0, s.amount - s.refunded), ref });
  },
  async refund({ orderId, amount }) {
    const ref = await kv.kvGet<string>(`settle:order:${orderId}`);
    const s = ref ? await kv.kvGet<MockSettlement>(`settle:${ref}`) : undefined;
    if (ref && s) await kv.kvSet(`settle:${ref}`, { ...s, refunded: s.refunded + amount }, 400 * 24 * 60 * 60);
    const refundRef = `mockrefund_${randomBytes(6).toString("hex")}`;
    await logLine({ orderId, kind: "refund", amount, ref: refundRef });
    return { ref: refundRef };
  },
  async settlements(orderId) {
    const ref = await kv.kvGet<string>(`settle:order:${orderId}`);
    const s = ref ? await kv.kvGet<MockSettlement>(`settle:${ref}`) : undefined;
    if (!s) return { held: 0, released: 0, refunded: 0 };
    // Refunds come out of the seller's held share first, as in the ledger.
    const held = Math.max(0, s.amount - s.refunded);
    return { held: s.state === "held" ? held : 0, released: s.state === "released" ? held : 0, refunded: s.refunded };
  },
  async report(day) {
    return (await kv.kvGet<SettlementLine[]>(`settle:report:${day}`)) ?? [];
  },
};

/** The settlement gateway for this deployment, or null when shop payments can't run yet. */
export function settlementGateway(): SettlementGateway | null {
  const chosen = process.env.SETTLEMENT_PROVIDER ?? (testPayments ? "mock" : "");
  // Mock settlement only alongside the mock payment gateway, never with real money.
  if (chosen === "mock" && testPayments && paymentsAvailable) return mock;
  return null;
}
