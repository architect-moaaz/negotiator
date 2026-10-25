import { toPublic } from "@/lib/negotiate";
import { sellerFromRequest } from "@/lib/sellers";
import { store } from "@/lib/store";

/** Seller dashboard data: their settings, approvals waiting on them, and their recent deals. */
export async function GET(request: Request) {
  const seller = await sellerFromRequest(request);
  if (!seller) return Response.json({ error: "unauthorized" }, { status: 401 });
  const deals = (await store.listDeals(500)).filter((d) => d.negotiation?.terms.sellerId === seller.id);
  return Response.json(
    {
      seller: { storeName: seller.storeName, aliases: seller.aliases, budgetPct: seller.budgetPct, autoApproveShare: seller.autoApproveShare },
      deals: deals.map((d) => ({ ...toPublic(d), terms: d.negotiation?.terms, recommendation: d.negotiation?.recommendation })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
