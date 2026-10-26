import { invoiceByNumber, issuer } from "@/lib/invoices";
import { memberPhone } from "@/lib/shop/access";
import { memberRole, roleCan } from "@/lib/shop/orgs";

/** One invoice with GhostCart's details, for the printable page. Owners and admins of that business. */
export async function GET(request: Request, ctx: RouteContext<"/api/seller/invoices/[number]">) {
  const phone = await memberPhone(request);
  if (!phone) return Response.json({ error: "Sign in with your phone number." }, { status: 401 });
  const invoice = await invoiceByNumber(decodeURIComponent((await ctx.params).number));
  const role = invoice && (await memberRole(invoice.orgId, phone));
  if (!invoice || !role || !roleCan(role, "catalogue")) return Response.json({ error: "Invoice not found." }, { status: 404 });
  return Response.json({ invoice, issuer: issuer() }, { headers: { "Cache-Control": "no-store" } });
}
