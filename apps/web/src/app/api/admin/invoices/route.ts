import { toCsv } from "@/lib/shop/export";
import { issueMonthlyInvoices } from "@/lib/invoices";
import { getDb } from "@/lib/db";
import { audit, requireStaff } from "@/lib/staff";
import { schema } from "@ghostcart/db";
import { desc, eq } from "drizzle-orm";

/** All fee invoices for a month as CSV (for the accountant's GST returns). ?period=YYYY-MM */
export async function GET(request: Request) {
  const { denied } = await requireStaff(request, "finance");
  if (denied) return denied;
  const period = new URL(request.url).searchParams.get("period") ?? "";
  const db = await getDb();
  const rows = await db.select().from(schema.feeInvoices).where(eq(schema.feeInvoices.period, period)).orderBy(desc(schema.feeInvoices.serial));
  const csv = toCsv(
    rows.map(({ lines: _l, ...r }) => r),
    ["number", "period", "issuedAt", "sellerName", "sellerGstin", "placeOfSupply", "taxable", "cgst", "sgst", "igst", "total", "storeId", "orgId"],
  );
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="ghostcart-fee-invoices-${period}.csv"` } });
}

/** Issue a month's invoices now (e.g. after fixing data). Body: { period: "YYYY-MM" }. Idempotent. */
export async function POST(request: Request) {
  const { staff, denied } = await requireStaff(request, "finance");
  if (denied) return denied;
  const { period } = (await request.json().catch(() => ({}))) as { period?: string };
  try {
    const issued = await issueMonthlyInvoices(String(period ?? ""));
    await audit(staff, `issued fee invoices for ${period}: ${issued.length}`);
    return Response.json({ issued: issued.map((i) => i.number) });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
