import { BoostError, removeBoost, setBoost } from "@/lib/shop/boosts";
import { requireStaff } from "@/lib/staff";

/** Staff: boost a product (it shows first, labelled "Sponsored"). Body: { productId, days, note }. */
export async function POST(request: Request) {
  const { staff, denied } = await requireStaff(request, "finance");
  if (denied) return denied;
  const { productId, days, note } = (await request.json().catch(() => ({}))) as { productId?: string; days?: unknown; note?: string };
  try {
    return Response.json(await setBoost(String(productId ?? ""), Number(days), String(note ?? ""), staff.name));
  } catch (err) {
    if (err instanceof BoostError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}

/** Staff: end a boost. Body: { productId }. */
export async function DELETE(request: Request) {
  const { staff, denied } = await requireStaff(request, "finance");
  if (denied) return denied;
  const { productId } = (await request.json().catch(() => ({}))) as { productId?: string };
  return Response.json({ removed: await removeBoost(String(productId ?? ""), staff.name) });
}
