import { extractProduct } from "@/lib/agent";
import { createDealPayment } from "@/lib/payments";
import { scrapeProductPage } from "@/lib/scrape";
import { store } from "@/lib/store";
import type { Deal } from "@/lib/types";

const TTL_MS = Number(process.env.DEAL_TTL_SECONDS ?? 180) * 1000;

export async function POST(request: Request) {
  const { url, city, channel = "web" } = (await request.json()) as {
    url?: string;
    city?: string;
    channel?: Deal["channel"];
  };
  if (!url) return Response.json({ error: "url is required" }, { status: 400 });

  const markdown = await scrapeProductPage(url);
  const product = await extractProduct(markdown, url);

  // Placeholder offer logic until computeOffer() lands: ~4% off, capped at ₹200.
  const discount = Math.min(200, Math.round(product.price * 0.04));
  const now = Date.now();
  const id = crypto.randomUUID().slice(0, 8);

  const deal: Deal = {
    id,
    product,
    alternatives: [],
    originalPrice: product.mrp ?? product.price,
    dealPrice: product.price - discount,
    perk: "Free instant shipping",
    createdAt: now,
    expiresAt: now + TTL_MS,
    status: "pending",
    city,
    channel,
  };

  Object.assign(
    deal,
    await createDealPayment({
      dealId: id,
      amountInr: deal.dealPrice,
      description: product.title.slice(0, 200),
      expiresAt: deal.expiresAt,
    }),
  );

  return Response.json(store.saveDeal(deal));
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  const deal = id ? store.getDeal(id) : undefined;
  return deal ? Response.json(deal) : Response.json({ error: "not found" }, { status: 404 });
}
