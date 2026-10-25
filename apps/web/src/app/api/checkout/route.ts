import { markPaid, toPublic } from "@/lib/negotiate";
import { store } from "@/lib/store";

/** Simulated UPI payment for demo mode. */
export async function POST(request: Request) {
  const { id } = (await request.json().catch(() => ({}))) as { id?: string };
  const deal = id ? await store.getDeal(id) : undefined;
  if (!deal) return Response.json({ error: "not found" }, { status: 404 });
  if (!deal.simulate) return Response.json({ error: "simulation disabled" }, { status: 403 });
  if (deal.status !== "pending" && deal.status !== "paid") return Response.json({ error: `deal ${deal.status}` }, { status: 409 });
  return Response.json(toPublic(await markPaid(deal, "simulated")));
}
