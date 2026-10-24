import { store } from "@/lib/store";

/** Simulated checkout for demo mode: marks a deal paid and fires a ticker event. */
export async function POST(request: Request) {
  const { id } = (await request.json()) as { id: string };
  const deal = store.getDeal(id);
  if (!deal) return Response.json({ error: "not found" }, { status: 404 });
  if (deal.status !== "pending") return Response.json({ error: `deal ${deal.status}` }, { status: 409 });

  deal.status = "paid";
  store.pushTicker({
    id: deal.id,
    city: deal.city,
    saved: deal.originalPrice - deal.dealPrice,
    at: Date.now(),
    message: `Someone${deal.city ? ` in ${deal.city}` : ""} just grabbed ${deal.product.title} for ₹${deal.dealPrice} instead of ₹${deal.originalPrice}`,
  });
  return Response.json(deal);
}
