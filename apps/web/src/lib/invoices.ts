import { schema } from "@ghostcart/db";
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "./db";
import { sellerDetails } from "./shop/disclosure";
import { getStore } from "./shop/stores";
import { istDayBounds } from "./warehouse";

const { feeInvoices, ledgerEntries, orders } = schema;

export type FeeInvoice = typeof feeInvoices.$inferSelect;

/** GST state codes (first two digits of a GSTIN), for the place of supply. */
export const STATE_CODES: Record<string, string> = {
  "jammu and kashmir": "01", "himachal pradesh": "02", punjab: "03", chandigarh: "04", uttarakhand: "05", haryana: "06", delhi: "07", rajasthan: "08", "uttar pradesh": "09", bihar: "10",
  sikkim: "11", "arunachal pradesh": "12", nagaland: "13", manipur: "14", mizoram: "15", tripura: "16", meghalaya: "17", assam: "18", "west bengal": "19", jharkhand: "20",
  odisha: "21", chhattisgarh: "22", "madhya pradesh": "23", gujarat: "24", "dadra and nagar haveli and daman and diu": "26", maharashtra: "27", karnataka: "29", goa: "30", lakshadweep: "31",
  kerala: "32", "tamil nadu": "33", puducherry: "34", "andaman and nicobar islands": "35", telangana: "36", "andhra pradesh": "37", ladakh: "38",
};

/** GhostCart's own details on the invoice (Vercel env; the GSTIN registration is a lead item). */
export const issuer = () => ({
  legalName: process.env.GHOSTCART_LEGAL_NAME ?? "GhostCart (registration pending)",
  gstin: process.env.GHOSTCART_GSTIN ?? null,
  address: process.env.GHOSTCART_ADDRESS ?? null,
  stateCode: process.env.GHOSTCART_STATE_CODE ?? "29",
  sac: process.env.GHOSTCART_SAC ?? "998599",
});

/** Indian financial year for a date: April–March, "2026-27". */
export function financialYear(d: Date) {
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  const y = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

/** [start, end) of an IST calendar month "YYYY-MM". */
export function monthBounds(period: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error("Use YYYY-MM.");
  const [y, m] = period.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { start: istDayBounds(`${period}-01`).start, end: istDayBounds(`${next}-01`).start };
}

/** CGST + SGST inside GhostCart's state, IGST across states (or when the seller's state is unknown). */
export function splitGst(gst: number, placeOfSupply: string | null, issuerState: string) {
  if (placeOfSupply && placeOfSupply === issuerState) {
    const cgst = Math.floor(gst / 2);
    return { cgst, sgst: gst - cgst, igst: 0 };
  }
  return { cgst: 0, sgst: 0, igst: gst };
}

/**
 * Fees earned per store in a month, from the ledger: every transaction crediting ghostcart:fee and
 * ghostcart:gst (payout releases and redeemed price grants), attributed to the store by its order or
 * the seller account in the same transaction.
 */
async function feesByStore(period: string) {
  const { start, end } = monthBounds(period);
  const db = await getDb();
  const rows = await db
    .select({ txnId: ledgerEntries.txnId, orderId: ledgerEntries.orderId, account: ledgerEntries.account, amount: ledgerEntries.amount, memo: ledgerEntries.memo, at: ledgerEntries.createdAt })
    .from(ledgerEntries)
    .where(and(gte(ledgerEntries.createdAt, start), lt(ledgerEntries.createdAt, end), sql`${ledgerEntries.txnId} in (select ${ledgerEntries.txnId} from ${ledgerEntries} where ${ledgerEntries.account} = 'ghostcart:fee')`))
    .orderBy(asc(ledgerEntries.createdAt));
  const orderIds = [...new Set(rows.map((r) => r.orderId).filter((x): x is string => !!x))];
  const orderRows = orderIds.length ? await db.select({ id: orders.id, storeId: orders.storeId }).from(orders).where(inArray(orders.id, orderIds)) : [];
  const storeOf = new Map(orderRows.map((o) => [o.id, o.storeId]));

  const txns = new Map<string, { storeId?: string; ref: string; at: Date; fee: number; gst: number }>();
  for (const r of rows) {
    const t = txns.get(r.txnId) ?? { ref: r.orderId ?? r.memo ?? r.txnId, at: r.at, fee: 0, gst: 0 };
    if (r.orderId) t.storeId ??= storeOf.get(r.orderId);
    const seller = r.account.match(/^seller:([^:]+):/);
    if (seller) t.storeId ??= seller[1];
    if (r.account === "ghostcart:fee") t.fee += -r.amount;
    if (r.account === "ghostcart:gst") t.gst += -r.amount;
    txns.set(r.txnId, t);
  }
  const byStore = new Map<string, { ref: string; at: string; fee: number; gst: number }[]>();
  for (const t of txns.values()) {
    if (!t.storeId || (t.fee === 0 && t.gst === 0)) continue;
    byStore.set(t.storeId, [...(byStore.get(t.storeId) ?? []), { ref: t.ref, at: t.at.toISOString(), fee: t.fee, gst: t.gst }]);
  }
  return byStore;
}

/** Issue (or return the existing) invoice for one store's fees in a month. */
async function issueFor(storeId: string, period: string, lines: { ref: string; at: string; fee: number; gst: number }[]) {
  const db = await getDb();
  const [existing] = await db.select().from(feeInvoices).where(and(eq(feeInvoices.storeId, storeId), eq(feeInvoices.period, period)));
  if (existing) return existing;
  const store = (await getStore(storeId))!;
  const seller = await sellerDetails(store);
  const placeOfSupply = seller.gstin?.slice(0, 2) ?? (store.disclosure ? (STATE_CODES[store.disclosure.state.trim().toLowerCase()] ?? null) : null);
  const taxable = lines.reduce((s, l) => s + l.fee, 0);
  const gst = lines.reduce((s, l) => s + l.gst, 0);
  const me = issuer();
  const split = splitGst(gst, placeOfSupply, me.stateCode);
  const fy = financialYear(monthBounds(period).end);
  // Next serial in the financial year; the unique index makes a concurrent duplicate fail, and we retry.
  for (let attempt = 0; attempt < 5; attempt++) {
    const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${feeInvoices.serial}), 0)::int` }).from(feeInvoices).where(eq(feeInvoices.fy, fy));
    const serial = max + 1;
    try {
      const [row] = await db
        .insert(feeInvoices)
        .values({ number: `GC/${fy}/${String(serial).padStart(6, "0")}`, fy, serial, orgId: store.orgId, storeId, period, sellerName: seller.legalName ?? seller.tradeName, sellerGstin: seller.gstin, sellerAddress: seller.address, placeOfSupply, taxable, ...split, total: taxable + gst, lines })
        .returning();
      return row;
    } catch (err) {
      const [raced] = await db.select().from(feeInvoices).where(and(eq(feeInvoices.storeId, storeId), eq(feeInvoices.period, period)));
      if (raced) return raced;
      if (attempt === 4) throw err;
    }
  }
  throw new Error("unreachable");
}

/** Invoices for every store that earned GhostCart fees in the month. Safe to re-run. */
export async function issueMonthlyInvoices(period: string) {
  const issued: FeeInvoice[] = [];
  for (const [storeId, lines] of await feesByStore(period)) issued.push(await issueFor(storeId, period, lines));
  return issued;
}

/** The previous IST month, "YYYY-MM". */
export function previousMonth(now = Date.now()) {
  const ist = new Date(now + 330 * 60 * 1000);
  const y = ist.getUTCMonth() === 0 ? ist.getUTCFullYear() - 1 : ist.getUTCFullYear();
  const m = ist.getUTCMonth() === 0 ? 12 : ist.getUTCMonth();
  return `${y}-${String(m).padStart(2, "0")}`;
}

export async function invoicesForStore(storeId: string) {
  const db = await getDb();
  return db.select().from(feeInvoices).where(eq(feeInvoices.storeId, storeId)).orderBy(desc(feeInvoices.issuedAt));
}

export async function invoiceByNumber(number: string) {
  const db = await getDb();
  const [row] = await db.select().from(feeInvoices).where(eq(feeInvoices.number, number));
  return row;
}

