import { CheckoutError, parseAddress, saveAddress } from "@/lib/checkout";
import { canActAsShopper } from "@/lib/deal-access";
import { toPublic } from "@/lib/negotiate";
import { store } from "@/lib/store";

/** Post-lock checkout: save the delivery address, which issues the balance UPI payment. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { id?: string; action?: string; address?: Record<string, unknown> };
  const deal = body.id ? await store.getDeal(body.id) : undefined;
  if (!deal) return Response.json({ error: "not found" }, { status: 404 });
  if (!(await canActAsShopper(deal))) return Response.json({ error: "Only the shopper who locked this deal can check out." }, { status: 403 });

  try {
    if (body.action === "address") return Response.json(toPublic(await saveAddress(deal, parseAddress(body.address ?? {}))));
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    if (err instanceof CheckoutError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
