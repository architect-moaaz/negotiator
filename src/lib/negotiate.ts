import { computeOffer, extractProductFromImage, streamHaggle } from "./agent";
import { createDealPayment, LOCK_FEE_INR, simulateEnabled } from "./payments";
import { inr } from "./format";
import { findAlternatives, queryFromUrl, scrapeProduct } from "./scrape";
import { store } from "./store";
import type { Activity, ActivityType, Channel, Deal, DealInput, NegotiationEvent, Product, PublicDeal, SellerQuote } from "./types";
import { sendWhatsApp } from "./whatsapp";

const TTL_MS = Number(process.env.DEAL_TTL_SECONDS ?? 180) * 1000;

export { inr };

export function toPublic(deal: Deal): PublicDeal {
  const pub: Partial<Deal> = { ...deal };
  delete pub.pinelabsOrderId;
  delete pub.waFrom;
  delete pub.userId;
  return pub as PublicDeal;
}

export async function runNegotiation(
  input: DealInput,
  ctx: { city?: string; channel: Channel; waFrom?: string; userId?: string },
  emit: (e: NegotiationEvent) => void = () => {},
): Promise<Deal> {
  let product: Product;
  let searchQuery: string;
  const { userId } = ctx;
  const log = (type: ActivityType, detail: string, actor: Activity["actor"] = "agent", dealId?: string) =>
    store.log({ type, actor, userId, dealId, detail });

  await log("negotiation_started", input.kind === "url" ? `Submitted ${input.url}` : "Submitted a screenshot", "user");

  // For URLs whose slug names the product, look up other sellers while the page is still being scraped.
  let earlyQuotes: Promise<SellerQuote[]> | undefined;
  if (input.kind === "url") {
    emit({ type: "step", text: "Scraping the product page" });
    await log("agent_step", `Scraping ${input.url}`);
    const slugQuery = queryFromUrl(input.url);
    if (slugQuery) earlyQuotes = findAlternatives(slugQuery, input.url);
    product = await scrapeProduct(input.url);
    searchQuery = [product.brand, product.title].filter(Boolean).join(" ");
  } else {
    emit({ type: "step", text: "Reading your screenshot" });
    await log("agent_step", "Reading screenshot with vision model");
    ({ product, searchQuery } = await extractProductFromImage(input.imageBase64, input.mediaType));
  }
  emit({ type: "product", product });
  await log("product_identified", `${product.title} at ${product.seller} for ${inr(product.price)}${product.inStock ? "" : " (out of stock)"}`);

  emit({ type: "step", text: "Checking prices across other sellers" });
  const quotes = await (earlyQuotes ?? findAlternatives(searchQuery, product.sourceUrl));
  emit({ type: "quotes", quotes });
  await log(
    "sellers_compared",
    quotes.length ? quotes.map((q) => `${q.seller} ${inr(q.price)}${q.inStock ? "" : " (oos)"}`).join(", ") : "No other sellers found",
  );

  const offer = computeOffer(product, quotes);
  await log("offer_computed", `Best base ${offer.bestSeller}; offer ${inr(offer.dealPrice)} (was ${inr(offer.originalPrice)}) + ${offer.perk}`);

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
    userId,
  };

  await store.saveDeal(deal, true);
  await store.incrStats({ deals: 1 });
  await log("deal_created", `Deal ${id}: ${product.title} at ${inr(deal.dealPrice)}, expires in ${TTL_MS / 1000}s`, "agent", id);
  await log(
    "payment_link_created",
    deal.pinelabsOrderId
      ? `Pine Labs UPI order ${deal.pinelabsOrderId} for ${inr(deal.lockFee)} deal lock`
      : deal.qrDataUrl
        ? `Static UPI QR for ${inr(deal.lockFee)} deal lock`
        : "No UPI QR available; simulated payment enabled",
    "system",
    id,
  );
  emit({ type: "deal", deal: toPublic(deal) });
  return deal;
}

/** Idempotently mark a deal paid, update stats, broadcast to the ticker and confirm on WhatsApp. */
export async function markPaid(deal: Deal, source: "pinelabs" | "pinelabs-webhook" | "simulated") {
  if (deal.status === "paid") return deal;
  if (!(await store.claimPaid(deal.id))) return { ...deal, status: "paid" as const };

  deal.status = "paid";
  await store.saveDeal(deal);
  await store.incrStats({ paid: 1, saved: deal.saved });
  await store.log({
    type: "payment_received",
    actor: "system",
    userId: deal.userId,
    dealId: deal.id,
    detail: `${source}: ${inr(deal.lockFee)} deal lock paid${deal.pinelabsOrderId ? ` (Pine Labs order ${deal.pinelabsOrderId})` : ""}; ${deal.product.title} at ${inr(deal.dealPrice)}`,
  });
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
