import { schema } from "@ghostcart/db";
import { eq, inArray } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import { getDb } from "../db";
import { slugify } from "./ids";

const { apiKeys, categories, disputes, holds, kycChecks, ledgerEntries, members, orders, orgs, platformConnections, policies, products, refunds, shipments, stores, webhookEndpoints } = schema;

type Row = Record<string, unknown>;

/** Orders the seller still has to ship: the only ones where they need the buyer's full address. */
const TO_SHIP = new Set(["placed", "shipped"]);

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  // Spreadsheets run cells starting with these as formulas (CSV injection); a leading quote shows them as text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Row[], columns?: string[]) {
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}

const README = `GhostCart data export

One CSV per kind of record, for every store in your organisation. Open them in Excel, Google Sheets or
any spreadsheet. Money columns (total, fee, gst, seller_share, amount, lock_fee) are in paise: divide
by 100 for rupees. Times are UTC (ISO 8601).

org.json             your organisation and team members
stores.csv           stores, status, tier and the details buyers see
categories.csv       product categories
products.csv         your catalogue
policies.csv         discount rules (store, category and product level)
orders.csv           orders; the full delivery address only for orders still to ship
shipments.csv        couriers, tracking numbers and tracking events
holds.csv            your share of each order and when it's released
refunds.csv          refunds and why
disputes.csv         buyer disputes and outcomes
ledger.csv           every money movement on your orders (double-entry; each txn_id sums to zero)
verification.csv     identity, bank and ownership checks (numbers masked)
integrations.csv     API keys (prefix only), webhook endpoints and connected platforms (no secrets)

Not included: secrets and access tokens, handover codes, and other people's data beyond what you need
to fulfil orders.
`;

/** Everything an organisation holds on GhostCart, as a zip of CSVs (Wave 5: per-org data export). */
export async function exportOrgData(orgId: string) {
  const db = await getDb();
  const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId));
  if (!org) return null;
  const team = await db.select().from(members).where(eq(members.orgId, orgId));
  const storeRows = await db.select().from(stores).where(eq(stores.orgId, orgId));
  const storeIds = storeRows.map((s) => s.id);

  const [cats, prods, pols, orderRows, keys, hooks, conns, checks] = await Promise.all([
    storeIds.length ? db.select().from(categories).where(inArray(categories.storeId, storeIds)) : [],
    storeIds.length ? db.select().from(products).where(inArray(products.storeId, storeIds)) : [],
    storeIds.length ? db.select().from(policies).where(inArray(policies.storeId, storeIds)) : [],
    db.select().from(orders).where(eq(orders.orgId, orgId)),
    storeIds.length ? db.select().from(apiKeys).where(inArray(apiKeys.storeId, storeIds)) : [],
    storeIds.length ? db.select().from(webhookEndpoints).where(inArray(webhookEndpoints.storeId, storeIds)) : [],
    storeIds.length ? db.select().from(platformConnections).where(inArray(platformConnections.storeId, storeIds)) : [],
    db.select().from(kycChecks).where(eq(kycChecks.orgId, orgId)),
  ]);
  const orderIds = orderRows.map((o) => o.id);
  const byOrders = orderIds.length > 0;
  const [ships, holdRows, refundRows, disputeRows, ledger] = await Promise.all([
    byOrders ? db.select().from(shipments).where(inArray(shipments.orderId, orderIds)) : [],
    byOrders ? db.select().from(holds).where(inArray(holds.orderId, orderIds)) : [],
    byOrders ? db.select().from(refunds).where(inArray(refunds.orderId, orderIds)) : [],
    byOrders ? db.select().from(disputes).where(inArray(disputes.orderId, orderIds)) : [],
    byOrders ? db.select().from(ledgerEntries).where(inArray(ledgerEntries.orderId, orderIds)) : [],
  ]);

  const files: Record<string, string> = {
    "README.txt": README,
    "org.json": JSON.stringify({ id: org.id, name: org.name, legalName: org.legalName, businessType: org.businessType, createdAt: org.createdAt, members: team.map((m) => ({ phone: m.phone, name: m.name, role: m.role, addedAt: m.createdAt })) }, null, 2),
    "stores.csv": toCsv(storeRows.map(({ verificationToken: _t, disclosure, ...s }) => ({ ...s, ...Object.fromEntries(Object.entries(disclosure ?? {}).map(([k, v]) => [`buyer_${k}`, v])) }))),
    "categories.csv": toCsv(cats),
    "products.csv": toCsv(prods),
    "policies.csv": toCsv(pols),
    "orders.csv": toCsv(
      orderRows.map(({ address, userId: _u, ...o }) => {
        const { name, phone, line1, line2, landmark, city, state, pincode } = address as Record<string, string | undefined>;
        const full = TO_SHIP.has(o.status);
        return { ...o, ship_to_name: full ? name : "", ship_to_phone: full ? phone : "", ship_to_address: full ? [line1, line2, landmark].filter(Boolean).join(", ") : "", ship_to_city: city, ship_to_state: state, ship_to_pincode: pincode };
      }),
    ),
    "shipments.csv": toCsv(ships.map(({ handoverCode: _h, ...s }) => s)),
    "holds.csv": toCsv(holdRows),
    "refunds.csv": toCsv(refundRows),
    "disputes.csv": toCsv(disputeRows),
    "ledger.csv": toCsv(ledger),
    "verification.csv": toCsv(checks.map((c) => ({ type: c.type, status: c.status, provider: c.provider, masked: c.masked, storeId: c.storeId, reason: c.details.reason, createdAt: c.createdAt, reviewedAt: c.reviewedAt }))),
    "integrations.csv": toCsv([
      ...keys.map((k) => ({ type: `api_key_${k.kind}`, storeId: k.storeId, ref: `${k.prefix}…`, detail: (k.allowedOrigins ?? []).join(" "), createdAt: k.createdAt, endedAt: k.revokedAt })),
      ...hooks.map((h) => ({ type: "webhook", storeId: h.storeId, ref: h.url, detail: (h.events ?? []).join(" "), createdAt: h.createdAt, endedAt: h.active ? null : "inactive" })),
      ...conns.map((c) => ({ type: `platform_${c.platform}`, storeId: c.storeId, ref: c.externalId, detail: c.scopes, createdAt: c.installedAt, endedAt: c.uninstalledAt })),
    ]),
  };
  const zip = zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [`ghostcart-export/${name}`, strToU8(text)])), { level: 6 });
  return { zip, files, name: `ghostcart-${slugify(org.name).slice(0, 30).replace(/-+$/, "")}-${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })}.zip` };
}
