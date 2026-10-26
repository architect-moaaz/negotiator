import { rateLimit } from "@/lib/rate-limit";
import { logSellerAction, requireStoreAccess } from "@/lib/shop/access";
import { importProductsCsv } from "@/lib/shop/products";

const MAX_BYTES = 2 * 1024 * 1024;

/** Catalogue CSV import. Body: { csv: "<file contents>" }. */
export async function POST(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/import">) {
  const { store, phone, denied } = await requireStoreAccess(request, (await ctx.params).id, "catalogue");
  if (denied) return denied;
  const limited = await rateLimit({ name: "import:store", id: store.id, max: 20, windowSeconds: 60 * 60 });
  if (limited) return limited;
  const { csv } = (await request.json().catch(() => ({}))) as { csv?: string };
  if (!csv?.trim()) return Response.json({ error: "Choose a CSV file." }, { status: 400 });
  if (csv.length > MAX_BYTES) return Response.json({ error: "Files up to 2 MB, please. Split bigger catalogues." }, { status: 413 });
  const result = await importProductsCsv(store.id, csv);
  await logSellerAction(store, phone, `imported ${result.created} products from CSV (${result.errors.length} rows skipped)`);
  return Response.json(result);
}
