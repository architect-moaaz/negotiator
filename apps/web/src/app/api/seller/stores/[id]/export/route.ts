import { rateLimit } from "@/lib/rate-limit";
import { logSellerAction, requireStoreAccess } from "@/lib/shop/access";
import { exportOrgData } from "@/lib/shop/export";

/** Download everything the organisation behind this store holds on GhostCart, as a zip of CSVs. Owner only. */
export async function GET(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/export">) {
  const { store, phone, denied } = await requireStoreAccess(request, (await ctx.params).id, "manage");
  if (denied) return denied;
  const limited = await rateLimit({ name: "org-export", id: store.orgId, max: 10, windowSeconds: 60 * 60 });
  if (limited) return limited;
  const out = await exportOrgData(store.orgId);
  if (!out) return Response.json({ error: "Store not found." }, { status: 404 });
  await logSellerAction(store, phone, "downloaded the organisation's data export");
  return new Response(Buffer.from(out.zip), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${out.name}"`, "Cache-Control": "no-store" },
  });
}
