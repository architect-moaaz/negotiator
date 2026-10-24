import { CheckoutError, parseAddress, placeOrder, saveAddress } from "@/lib/checkout";
import { toPublic } from "@/lib/negotiate";
import { store } from "@/lib/store";

/** Post-lock checkout: save the delivery address (issues the balance UPI payment), or simulate that payment in demo mode. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { id?: string; action?: string; address?: Record<string, unknown> };
  const deal = body.id ? await store.getDeal(body.id) : undefined;
  if (!deal) return Response.json({ error: "not found" }, { status: 404 });

  try {
    if (body.action === "address") return Response.json(toPublic(await saveAddress(deal, parseAddress(body.address ?? {}))));
    if (body.action === "simulate") {
      if (!deal.simulate) return Response.json({ error: "simulation disabled" }, { status: 403 });
      return Response.json(toPublic(await placeOrder(deal, "simulated")));
    }
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    if (err instanceof CheckoutError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
