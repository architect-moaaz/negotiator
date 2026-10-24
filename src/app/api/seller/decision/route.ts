import { decideApproval, HaggleError, toPublic } from "@/lib/negotiate";
import { sellerFromRequest } from "@/lib/sellers";
import { store } from "@/lib/store";

/** The seller approves or rejects a price their agent couldn't agree to on its own. */
export async function POST(request: Request) {
  const seller = await sellerFromRequest(request);
  if (!seller) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { id?: string; decision?: string };
  if (body.decision !== "approved" && body.decision !== "rejected") return Response.json({ error: "decision must be approved or rejected" }, { status: 400 });
  const deal = body.id ? await store.getDeal(body.id) : undefined;
  if (!deal || deal.negotiation?.terms.sellerId !== seller.id) return Response.json({ error: "Deal not found." }, { status: 404 });
  try {
    return Response.json(toPublic(await decideApproval(deal, body.decision, seller.storeName, "seller")));
  } catch (err) {
    if (err instanceof HaggleError) return Response.json({ error: err.message }, { status: 409 });
    throw err;
  }
}
