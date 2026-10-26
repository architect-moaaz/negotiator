import { assertBalanced, type Posting } from "@ghostcart/core";
import { schema, type Db } from "@ghostcart/db";
import { and, eq, like, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";

const { ledgerEntries } = schema;

/** Append one balanced transaction. Throws (and writes nothing) if the postings don't sum to zero. */
export async function post(db: Db, input: { orderId?: string; kind: string; postings: Posting[]; memo?: string }) {
  assertBalanced(input.postings);
  const txnId = `txn_${randomBytes(9).toString("base64url")}`;
  await db.insert(ledgerEntries).values(
    input.postings.filter((p) => p.amount !== 0).map((p) => ({ txnId, orderId: input.orderId ?? null, kind: input.kind, account: p.account, amount: p.amount, memo: input.memo ?? null })),
  );
  return txnId;
}

/** Balance of one account, optionally for one order (debits positive). */
export async function balance(db: Db, account: string, orderId?: string) {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amount}), 0)` })
    .from(ledgerEntries)
    .where(orderId ? and(eq(ledgerEntries.account, account), eq(ledgerEntries.orderId, orderId)) : eq(ledgerEntries.account, account));
  return Number(row?.total ?? 0);
}

/** Balances of every account matching a prefix ("seller:st_abc:"), for payout views. */
export async function balancesByPrefix(db: Db, prefix: string) {
  const rows = await db
    .select({ account: ledgerEntries.account, total: sql<string>`sum(${ledgerEntries.amount})` })
    .from(ledgerEntries)
    .where(like(ledgerEntries.account, `${prefix}%`))
    .groupBy(ledgerEntries.account);
  return Object.fromEntries(rows.map((r) => [r.account, Number(r.total)]));
}

/** Release gate for every money PR: the whole ledger and each transaction must sum to zero. */
export async function trialBalance(db: Db) {
  const [all] = await db.select({ total: sql<string>`coalesce(sum(${ledgerEntries.amount}), 0)` }).from(ledgerEntries);
  const unbalanced = await db
    .select({ txnId: ledgerEntries.txnId, total: sql<string>`sum(${ledgerEntries.amount})` })
    .from(ledgerEntries)
    .groupBy(ledgerEntries.txnId)
    .having(sql`sum(${ledgerEntries.amount}) <> 0`);
  const accounts = await db
    .select({ account: ledgerEntries.account, total: sql<string>`sum(${ledgerEntries.amount})` })
    .from(ledgerEntries)
    .groupBy(ledgerEntries.account);
  return { total: Number(all?.total ?? 0), unbalanced: unbalanced.map((u) => u.txnId), accounts: Object.fromEntries(accounts.map((a) => [a.account, Number(a.total)])) };
}
