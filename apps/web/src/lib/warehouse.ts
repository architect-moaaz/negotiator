import { toPaise } from "@ghostcart/core";
import { schema } from "@ghostcart/db";
import { and, asc, eq, getTableColumns, gte, inArray, lt, lte } from "drizzle-orm";
import { getDb } from "./db";
import { store as kv } from "./store";
import type { Deal } from "./types";

const { disputes, orders, refunds, storeDailyMetrics, stores } = schema;

export type DailyMetrics = typeof storeDailyMetrics.$inferSelect;
/** Column order for CSV exports, so an empty range still has a header row. */
export const METRIC_COLUMNS = Object.keys(getTableColumns(storeDailyMetrics));

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The IST calendar day a moment falls on, as YYYY-MM-DD. */
export const istDay = (at: number | Date) => new Date(new Date(at).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** [start, end) of an IST calendar day, as UTC instants. */
export function istDayBounds(day: string) {
  if (!DAY.test(day)) throw new Error(`Not a day: ${day}`);
  const start = new Date(Date.parse(`${day}T00:00:00Z`) - IST_OFFSET_MS);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

const AGREED = new Set<Deal["status"]>(["pending", "paid", "granted"]);

type Totals = Omit<DailyMetrics, "day" | "storeId" | "orgId" | "computedAt">;
const empty = (): Totals => ({ negotiations: 0, agreed: 0, escalated: 0, humanApproved: 0, humanRejected: 0, listValue: 0, agreedValue: 0, totalRounds: 0, orders: 0, gmv: 0, fees: 0, refunds: 0, disputes: 0 });

/**
 * Roll one IST day up into store_daily_metrics. Negotiations come from the deal store (they expire from
 * Redis after a week, so the nightly run is what keeps them), money from the orders tables. Re-running a
 * day replaces its rows, so late refunds and disputes are picked up by re-running recent days.
 */
export async function rollupDay(day: string) {
  const { start, end } = istDayBounds(day);
  const db = await getDb();
  const totals = new Map<string, Totals>();
  const of = (storeId: string) => totals.get(storeId) ?? totals.set(storeId, empty()).get(storeId)!;

  for (const d of await kv.listDeals(10_000)) {
    if (!d.shop || d.createdAt < start.getTime() || d.createdAt >= end.getTime()) continue;
    const t = of(d.shop.storeId);
    t.negotiations++;
    t.totalRounds += d.negotiation?.rounds ?? 0;
    const approval = d.negotiation?.approval;
    if (approval) {
      t.escalated++;
      if (approval.decision === "approved" || approval.decision === "countered") t.humanApproved++;
      if (approval.decision === "rejected") t.humanRejected++;
    }
    if (AGREED.has(d.status) || d.grant?.redeemedAt) {
      t.agreed++;
      t.listValue += toPaise(d.originalPrice);
      t.agreedValue += toPaise(d.dealPrice);
    }
  }

  for (const o of await db.select().from(orders).where(and(gte(orders.createdAt, start), lt(orders.createdAt, end)))) {
    const t = of(o.storeId);
    t.orders++;
    t.gmv += o.total;
    t.fees += o.fee;
  }
  const refunded = await db
    .select({ storeId: orders.storeId, amount: refunds.amount })
    .from(refunds)
    .innerJoin(orders, eq(orders.id, refunds.orderId))
    .where(and(eq(refunds.status, "processed"), gte(refunds.createdAt, start), lt(refunds.createdAt, end)));
  for (const r of refunded) of(r.storeId).refunds += r.amount;
  const disputed = await db
    .select({ storeId: orders.storeId })
    .from(disputes)
    .innerJoin(orders, eq(orders.id, disputes.orderId))
    .where(and(gte(disputes.createdAt, start), lt(disputes.createdAt, end)));
  for (const r of disputed) of(r.storeId).disputes++;

  const ids = [...totals.keys()];
  const orgOf = new Map(ids.length ? (await db.select({ id: stores.id, orgId: stores.orgId }).from(stores).where(inArray(stores.id, ids))).map((s) => [s.id, s.orgId]) : []);
  const rows = ids.filter((id) => orgOf.has(id)).map((storeId) => ({ day, storeId, orgId: orgOf.get(storeId)!, ...totals.get(storeId)!, computedAt: new Date() }));

  await db.delete(storeDailyMetrics).where(eq(storeDailyMetrics.day, day));
  if (rows.length) await db.insert(storeDailyMetrics).values(rows);
  return { day, stores: rows.length };
}

/** Nightly: yesterday, plus the two days before it again for refunds and disputes that came in late. */
export async function nightlyRollup(now = Date.now()) {
  const days = [1, 2, 3].map((n) => istDay(now - n * 24 * 60 * 60 * 1000));
  const out = [];
  for (const day of days) out.push(await rollupDay(day));
  return out;
}

export async function metricsFor(filter: { storeId?: string; orgId?: string }, from: string, to: string) {
  if (!DAY.test(from) || !DAY.test(to)) throw new Error("Use YYYY-MM-DD dates.");
  const db = await getDb();
  const where = [gte(storeDailyMetrics.day, from), lte(storeDailyMetrics.day, to)];
  if (filter.storeId) where.push(eq(storeDailyMetrics.storeId, filter.storeId));
  if (filter.orgId) where.push(eq(storeDailyMetrics.orgId, filter.orgId));
  return db.select().from(storeDailyMetrics).where(and(...where)).orderBy(asc(storeDailyMetrics.day), asc(storeDailyMetrics.storeId));
}

/** Headline numbers for a set of daily rows. Rates are 0–1; money in paise. */
export function summarise(rows: DailyMetrics[]) {
  const t = rows.reduce((a, r) => {
    for (const k of Object.keys(a) as (keyof Totals)[]) a[k] += r[k];
    return a;
  }, empty());
  return {
    ...t,
    agreeRate: t.negotiations ? t.agreed / t.negotiations : 0,
    escalationRate: t.negotiations ? t.escalated / t.negotiations : 0,
    averageDiscount: t.listValue ? 1 - t.agreedValue / t.listValue : 0,
    averageRounds: t.negotiations ? t.totalRounds / t.negotiations : 0,
  };
}
