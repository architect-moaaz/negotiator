import { cronAuthorized } from "@/lib/cron";
import { issueMonthlyInvoices, previousMonth } from "@/lib/invoices";

/** Vercel Cron, early on the 2nd (IST): last month's fee invoices for every store that earned fees. */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return new Response("unauthorized", { status: 401 });
  const period = previousMonth();
  const issued = await issueMonthlyInvoices(period);
  return Response.json({ period, issued: issued.map((i) => i.number) });
}
