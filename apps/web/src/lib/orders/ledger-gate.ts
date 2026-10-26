import { accounts } from "@ghostcart/core";
import { schema, type Db } from "@ghostcart/db";
import { eq, sql } from "drizzle-orm";
import { trialBalance } from "./ledger";

const { ledgerEntries, orders, holds, refunds } = schema;

export type GateProblem = { check: string; detail: string; orderId?: string; txnId?: string };

/**
 * The release gate for money: the ledger has to agree with itself and with every order.
 *
 * - The whole ledger, and each transaction, sums to zero; a transaction belongs to one order and one kind.
 * - Each order has exactly one "paid" transaction for its total, split exactly as the order says.
 * - An order's postings only touch its own store's seller accounts.
 * - Nothing is over-released or over-refunded: what's still held is never negative, and the total is
 *   fully accounted for as refunded + released + still held.
 * - The hold row and the order status match the ledger (held, released once, or refunded to zero),
 *   and processed refunds match the refund postings.
 *
 * Orders placed in the last `graceMs` with no "paid" transaction yet are skipped (still being written).
 */
export async function ledgerGate(db: Db, { graceMs = 10 * 60 * 1000, now = new Date() } = {}) {
  const problems: GateProblem[] = [];
  const tb = await trialBalance(db);
  if (tb.total !== 0) problems.push({ check: "ledger_total", detail: `the ledger sums to ${tb.total} paise, not 0` });
  for (const txnId of tb.unbalanced) problems.push({ check: "txn_unbalanced", txnId, detail: "this transaction doesn't sum to zero" });

  const mixed = await db
    .select({ txnId: ledgerEntries.txnId })
    .from(ledgerEntries)
    .groupBy(ledgerEntries.txnId)
    .having(sql`count(distinct ${ledgerEntries.orderId}) > 1 or count(distinct ${ledgerEntries.kind}) > 1 or (count(${ledgerEntries.orderId}) > 0 and count(${ledgerEntries.orderId}) < count(*))`);
  for (const m of mixed) problems.push({ check: "txn_mixed", txnId: m.txnId, detail: "this transaction mixes orders or kinds" });

  // Per order: net amount per (kind, account), and how many transactions of each kind.
  const rows = await db
    .select({
      orderId: ledgerEntries.orderId,
      kind: ledgerEntries.kind,
      account: ledgerEntries.account,
      total: sql<string>`sum(${ledgerEntries.amount})`,
      txns: sql<string>`count(distinct ${ledgerEntries.txnId})`,
    })
    .from(ledgerEntries)
    .where(sql`${ledgerEntries.orderId} is not null`)
    .groupBy(ledgerEntries.orderId, ledgerEntries.kind, ledgerEntries.account);
  const byOrder = new Map<string, typeof rows>();
  for (const r of rows) byOrder.set(r.orderId!, [...(byOrder.get(r.orderId!) ?? []), r]);

  const holdRows = new Map((await db.select().from(holds)).map((h) => [h.orderId, h]));
  const refundRows = await db
    .select({ orderId: refunds.orderId, total: sql<string>`coalesce(sum(${refunds.amount}), 0)` })
    .from(refunds)
    .where(eq(refunds.status, "processed"))
    .groupBy(refunds.orderId);
  const refunded = new Map(refundRows.map((r) => [r.orderId, Number(r.total)]));

  let checked = 0;
  const skipped: string[] = [];
  for (const o of await db.select().from(orders)) {
    const lines = byOrder.get(o.id) ?? [];
    const bad = (check: string, detail: string) => problems.push({ check, orderId: o.id, detail });
    const net = (account: string, kind?: string) => lines.filter((l) => l.account === account && (!kind || l.kind === kind)).reduce((s, l) => s + Number(l.total), 0);
    const txns = (kind: string) => Math.max(0, ...lines.filter((l) => l.kind === kind).map((l) => Number(l.txns)));

    const paid = txns("paid");
    if (paid === 0 && now.getTime() - o.createdAt.getTime() < graceMs) {
      skipped.push(o.id);
      continue;
    }
    checked++;
    if (o.fee + o.gst + o.sellerShare !== o.total) bad("order_split", `fee ${o.fee} + GST ${o.gst} + seller share ${o.sellerShare} isn't the total ${o.total}`);
    if (paid !== 1) {
      bad("paid_count", `${paid} "paid" transactions, expected exactly 1`);
      continue;
    }

    const sellerHeld = accounts.sellerHeld(o.storeId);
    const paidAs = { total: net(accounts.gateway, "paid"), sellerShare: -net(sellerHeld, "paid"), fee: -net(accounts.feeHeld, "paid"), gst: -net(accounts.gstHeld, "paid") };
    for (const k of ["total", "sellerShare", "fee", "gst"] as const)
      if (paidAs[k] !== o[k]) bad("paid_amount", `paid ${k} is ${paidAs[k]} in the ledger but ${o[k]} on the order`);

    const foreign = [...new Set(lines.map((l) => l.account))].filter((a) => a.startsWith("seller:") && !a.startsWith(`seller:${o.storeId}:`));
    if (foreign.length) bad("foreign_account", `posts to another store's accounts: ${foreign.join(", ")}`);

    // Still held (credits are negative, so flip the sign), released out of the hold, refunded to the buyer.
    const held = { sellerShare: -net(sellerHeld), fee: -net(accounts.feeHeld), gst: -net(accounts.gstHeld) };
    const heldTotal = held.sellerShare + held.fee + held.gst;
    const released = -(net(accounts.sellerPayable(o.storeId)) + net(accounts.fee) + net(accounts.gst));
    const refundedInLedger = -net(accounts.gateway, "refund");
    for (const [k, v] of Object.entries(held)) if (v < 0) bad("over_released", `held ${k} is ${v}: more left the hold than went in`);
    if (refundedInLedger < 0 || refundedInLedger > o.total) bad("over_refunded", `refunded ${refundedInLedger} of a ${o.total} order`);
    if (refundedInLedger + released + heldTotal !== o.total) bad("conservation", `refunded ${refundedInLedger} + released ${released} + held ${heldTotal} isn't the total ${o.total}`);
    if ((refunded.get(o.id) ?? 0) !== refundedInLedger) bad("refunds_table", `processed refunds total ${refunded.get(o.id) ?? 0}, the ledger refunded ${refundedInLedger}`);

    const releases = txns("released");
    const hold = holdRows.get(o.id);
    if (!hold) {
      bad("hold_missing", "paid, but there's no hold row");
      continue;
    }
    if (releases > 1) bad("released_twice", `${releases} release transactions`);
    if (hold.state === "held" || hold.state === "frozen" || hold.state === "releasing") {
      if (releases !== 0) bad("hold_state", `hold is ${hold.state} but the ledger released it`);
      if (hold.amount !== held.sellerShare) bad("hold_amount", `hold says ${hold.amount} held, the ledger ${held.sellerShare}`);
      if (["completed", "refunded", "cancelled"].includes(o.status)) bad("order_status", `order is ${o.status} while the money is still ${hold.state}`);
    } else if (hold.state === "released") {
      if (releases !== 1) bad("hold_state", "hold is released but the ledger has no release");
      if (heldTotal !== 0) bad("hold_state", `hold is released but ${heldTotal} is still held in the ledger`);
      if (o.status !== "completed") bad("order_status", `hold released but the order is ${o.status}`);
    } else if (hold.state === "refunded") {
      if (heldTotal !== 0) bad("hold_state", `hold is refunded but ${heldTotal} is still held in the ledger`);
      if (o.status !== "refunded" && o.status !== "cancelled") bad("order_status", `hold refunded but the order is ${o.status}`);
    } else bad("hold_state", `unknown hold state "${hold.state}"`);
  }

  // Ledger lines for orders that don't exist can't happen (foreign key), so the order loop covers them all.
  return { ok: problems.length === 0, checked, skipped, problems, total: tb.total };
}
