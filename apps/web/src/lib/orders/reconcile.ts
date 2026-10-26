import { schema } from "@ghostcart/db";
import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { getDb } from "../db";
import { istDay, istDayBounds } from "../warehouse";
import { settlementGateway } from "./settlement";

const { ledgerEntries, reconciliationIssues, reconciliationRuns } = schema;

type Kind = "hold" | "release" | "refund";
const key = (orderId: string, kind: Kind) => `${orderId}|${kind}`;

/**
 * Match the payment aggregator's settlement report for one IST day against the ledger: per order and
 * kind, the seller share held at payment, the share released after delivery, and refunds to buyers must
 * agree to the paisa. Differences become open issues for finance; a re-run replaces the day's open
 * issues (resolved ones are kept).
 */
export async function reconcileDay(day: string) {
  const gateway = settlementGateway();
  if (!gateway) return null;
  const db = await getDb();
  const { start, end } = istDayBounds(day);

  const ours = new Map<string, number>();
  const rows = await db
    .select({ orderId: ledgerEntries.orderId, kind: ledgerEntries.kind, account: ledgerEntries.account, amount: ledgerEntries.amount })
    .from(ledgerEntries)
    .where(and(gte(ledgerEntries.createdAt, start), lt(ledgerEntries.createdAt, end), inArray(ledgerEntries.kind, ["paid", "released", "refund"])));
  for (const r of rows) {
    if (!r.orderId) continue;
    // paid: the seller's share goes on hold (credit to seller:…:held); released: it comes off hold;
    // refund: money back to the buyer through the gateway (credit to gateway:receivable).
    if (r.kind === "paid" && r.account.endsWith(":held") && r.account.startsWith("seller:")) ours.set(key(r.orderId, "hold"), (ours.get(key(r.orderId, "hold")) ?? 0) - r.amount);
    if (r.kind === "released" && r.account.endsWith(":held") && r.account.startsWith("seller:")) ours.set(key(r.orderId, "release"), (ours.get(key(r.orderId, "release")) ?? 0) + r.amount);
    if (r.kind === "refund" && r.account === "gateway:receivable") ours.set(key(r.orderId, "refund"), (ours.get(key(r.orderId, "refund")) ?? 0) - r.amount);
  }

  const report = await gateway.report(day);
  const theirs = new Map<string, number>();
  for (const l of report) theirs.set(key(l.orderId, l.kind), (theirs.get(key(l.orderId, l.kind)) ?? 0) + l.amount);

  const issues: { orderId: string; kind: Kind; ledgerAmount: number; gatewayAmount: number }[] = [];
  let matched = 0;
  for (const k of new Set([...ours.keys(), ...theirs.keys()])) {
    const [orderId, kind] = k.split("|") as [string, Kind];
    const a = ours.get(k) ?? 0;
    const b = theirs.get(k) ?? 0;
    if (a === b) matched++;
    else issues.push({ orderId, kind, ledgerAmount: a, gatewayAmount: b });
  }

  const [run] = await db.insert(reconciliationRuns).values({ day, gateway: gateway.name, reportLines: report.length, ledgerLines: ours.size, matched, issues: issues.length }).returning();
  await db.delete(reconciliationIssues).where(and(eq(reconciliationIssues.day, day), eq(reconciliationIssues.status, "open")));
  for (const i of issues) {
    await db.insert(reconciliationIssues).values({ runId: run.id, day, ...i }).onConflictDoNothing(); // a resolved issue for the same key stays resolved
  }
  return { run, issues };
}

/** Nightly: yesterday and the day before (late report lines). */
export async function nightlyReconciliation(now = Date.now()) {
  const out = [];
  for (const n of [1, 2]) out.push(await reconcileDay(istDay(now - n * 24 * 60 * 60 * 1000)));
  return out.filter(Boolean);
}

export async function reconciliationStatus() {
  const db = await getDb();
  const [runs, open] = await Promise.all([
    db.select().from(reconciliationRuns).orderBy(desc(reconciliationRuns.ranAt)).limit(10),
    db.select().from(reconciliationIssues).where(eq(reconciliationIssues.status, "open")).orderBy(asc(reconciliationIssues.day)),
  ]);
  return { runs, open };
}

export async function resolveIssue(id: number, note: string, by: string) {
  if (note.trim().length < 5) throw new Error("Say what you found and did.");
  const db = await getDb();
  const [row] = await db.update(reconciliationIssues).set({ status: "resolved", note: note.trim().slice(0, 1000), resolvedBy: by }).where(eq(reconciliationIssues.id, id)).returning();
  if (!row) throw new Error("Issue not found.");
  return row;
}
