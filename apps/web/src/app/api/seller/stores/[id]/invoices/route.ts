import { invoicesForStore } from "@/lib/invoices";
import { requireStoreAccess } from "@/lib/shop/access";

/** GhostCart's fee invoices for this store, newest first. Owners and admins. */
export async function GET(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/invoices">) {
  const { store, denied } = await requireStoreAccess(request, (await ctx.params).id, "catalogue");
  if (denied) return denied;
  const rows = await invoicesForStore(store.id);
  return Response.json(
    rows.map(({ number, period, taxable, cgst, sgst, igst, total, issuedAt }) => ({ number, period, taxable, gst: cgst + sgst + igst, total, issuedAt })),
    { headers: { "Cache-Control": "no-store" } },
  );
}
