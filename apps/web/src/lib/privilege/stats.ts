import { schema } from "@ghostcart/db";
import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { getDb } from "../db";
import { store as kv } from "../store";

const { cartInvites, carts } = schema;

export interface RecoveryStats {
  captured: number;
  listValue: number;
  withConsent: number;
  abandoned: number;
  invited: number;
  invitesByChannel: Record<string, number>;
  opened: number;
  negotiating: number;
  recovered: number;
  /** What recovered carts sold for (the agreed prices), INR. */
  recoveredValue: number;
  optedOut: number;
}

/** GhostCart Privilege funnel for one store (or every store when storeId is omitted), since a date. */
export async function recoveryStats(storeId?: string, since = new Date(Date.now() - 30 * 24 * 3600_000)): Promise<RecoveryStats> {
  const db = await getDb();
  // Rescue my cart carts are shoppers arriving from marketplaces, not this store's abandoned carts.
  const where = and(storeId ? eq(carts.storeId, storeId) : undefined, gte(carts.createdAt, since), ne(carts.source, "rescue"));
  const rows = await db
    .select({ status: carts.status, n: sql<number>`count(*)::int`, value: sql<number>`coalesce(sum(${carts.subtotal}), 0)::int`, consented: sql<number>`count(${carts.consentAt})::int` })
    .from(carts)
    .where(where)
    .groupBy(carts.status);
  const by = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;
  const ids = storeId ? (await db.select({ id: carts.id }).from(carts).where(where)).map((r) => r.id) : null;
  const inviteRows =
    ids && !ids.length
      ? []
      : await db
          .select({ channel: cartInvites.channel, sent: sql<number>`count(${cartInvites.sentAt})::int`, opened: sql<number>`count(${cartInvites.openedAt})::int` })
          .from(cartInvites)
          .where(and(ids ? inArray(cartInvites.cartId, ids) : undefined, gte(cartInvites.createdAt, since)))
          .groupBy(cartInvites.channel);
  const recoveredRows = await db.select({ dealId: carts.dealId }).from(carts).where(and(where, eq(carts.status, "recovered")));
  let recoveredValue = 0;
  for (const r of recoveredRows.slice(0, 500)) if (r.dealId) recoveredValue += (await kv.getDeal(r.dealId))?.dealPrice ?? 0;
  return {
    captured: rows.reduce((s, r) => s + r.n, 0),
    listValue: rows.reduce((s, r) => s + r.value, 0),
    withConsent: rows.reduce((s, r) => s + r.consented, 0),
    abandoned: by("abandoned") + by("invited") + by("negotiating") + by("recovered") + by("expired") + by("opted_out"),
    invited: inviteRows.filter((r) => r.channel !== "link").reduce((s, r) => s + r.sent, 0),
    invitesByChannel: Object.fromEntries(inviteRows.filter((r) => r.channel !== "link").map((r) => [r.channel, r.sent])),
    opened: inviteRows.reduce((s, r) => s + r.opened, 0),
    negotiating: by("negotiating"),
    recovered: by("recovered"),
    recoveredValue,
    optedOut: by("opted_out"),
  };
}
