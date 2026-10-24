import { computeOffer, extractProductFromImage, streamHaggle } from "./agent";
import { createDealPayment, LOCK_FEE_INR, simulateEnabled } from "./payments";
import { inr } from "./format";
import { findAlternatives, scrapeProduct } from "./scrape";
import { store } from "./store";
import type { Channel, Deal, DealInput, NegotiationEvent, Product, PublicDeal } from "./types";
import { sendWhatsApp } from "./whatsapp";

const TTL_MS = Number(process.env.DEAL_TTL_SECONDS ?? 180) * 1000;

export { inr };

export function toPublic(deal: Deal): PublicDeal {
  const pub: Partial<Deal> = { ...deal };
  delete pub.pinelabsOrderId;
  delete pub.waFrom;
  return pub as PublicDeal;
}

export async function runNegotiation(
  input: DealInput,
  ctx: { city?: string; channel: Channel; waFrom?: string },
  emit: (e: NegotiationEvent) => void = () => {},
): Promise<Deal> {
  let product: Product;
  let searchQuery: string;

  if (input.kind === "url") {
    emit({ type: "step", text: "Scraping the product page" });
    product = await scrapeProduct(input.url);
    searchQuery = [product.brand, product.title].filter(Boolean).join(" ");
  } else {
    emit({ type: "step", text: "Reading your screenshot" });
    ({ product, searchQuery } = await extractProductFromImage(input.imageBase64, input.mediaType));
  }
  emit({ type: "product", product });

  emit({ type: "step", text: "Checking prices across other sellers" });
  const quotes = await findAlternatives(searchQuery, product.sourceUrl);
  emit({ type: "quotes", quotes });

  const offer = computeOffer(product, quotes);

  emit({ type: "step", text: "Negotiating your flash deal" });
  let haggle = "";
  for await (const chunk of streamHaggle(product, quotes, offer)) {
    haggle += chunk;
    emit({ type: "haggle", text: chunk });
  }
  emit({ type: "offer", offer });

  emit({ type: "step", text: "Generating your UPI deal lock" });
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  const payment = await createDealPayment({ dealId: id, title: product.title });
  const now = Date.now();
  const deal: Deal = {
    id,
    product,
    alternatives: quotes,
    ...offer,
    haggle: haggle.trim(),
    lockFee: LOCK_FEE_INR,
    ...payment,
    simulate: simulateEnabled || !payment.qrDataUrl,
    createdAt: now,
    expiresAt: now + TTL_MS,
    status: "pending",
    city: ctx.city,
    channel: ctx.channel,
    waFrom: ctx.waFrom,
  };

  await store.saveDeal(deal);
  await store.incrStats({ deals: 1 });
  emit({ type: "deal", deal: toPublic(deal) });
  return deal;
}

/** Idempotently mark a deal paid, update stats, broadcast to the ticker and confirm on WhatsApp. */
export async function markPaid(deal: Deal) {
  if (deal.status === "paid") return deal;
  if (!(await store.claimPaid(deal.id))) return { ...deal, status: "paid" as const };

  deal.status = "paid";
  await store.saveDeal(deal);
  await store.incrStats({ paid: 1, saved: deal.saved });
  await store.pushTicker({
    id: deal.id,
    city: deal.city,
    saved: deal.saved,
    at: Date.now(),
    message: `Someone${deal.city ? ` in ${deal.city}` : ""} just grabbed ${deal.product.title} for ${inr(deal.dealPrice)} instead of ${inr(deal.originalPrice)}`,
  });
  if (deal.waFrom) {
    await sendWhatsApp(deal.waFrom, `✅ Deal locked! ${deal.product.title} at ${inr(deal.dealPrice)} + ${deal.perk}. You saved ${inr(deal.saved)}.`).catch(
      (err) => console.error("WhatsApp confirm failed", err),
    );
  }
  return deal;
}
