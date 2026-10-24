import { extractProductFromImage, streamHaggle } from "./agent";
import { chooseMove, computeTerms, MAX_ROUNDS } from "./haggle";
import { createDealPayment, LOCK_FEE_INR, simulateEnabled } from "./payments";
import { inr } from "./format";
import { findAlternatives, queryFromUrl, sameProductQuotes, scrapeProduct } from "./scrape";
import { store } from "./store";
import type { Activity, ActivityType, Channel, Deal, DealInput, NegotiationEvent, Offer, Product, PublicDeal, SellerQuote } from "./types";
import { sendWhatsApp } from "./whatsapp";

const TTL_MS = Number(process.env.DEAL_TTL_SECONDS ?? 180) * 1000;
const NEGOTIATION_WINDOW_MS = 15 * 60 * 1000;
const APPROVAL_WINDOW_MS = 30 * 60 * 1000;
const PERK = "Free instant shipping";

export { inr };

export function toPublic(deal: Deal): PublicDeal {
  const pub: Partial<Deal> = { ...deal };
  delete pub.pinelabsOrderId;
  delete pub.waFrom;
  delete pub.userId;
  delete pub.negotiation;
  const n = deal.negotiation;
  return {
    ...(pub as Omit<PublicDeal, "negotiation">),
    negotiation: n && {
      benchmark: n.terms.benchmark,
      currentOffer: n.currentOffer,
      rounds: n.rounds,
      maxRounds: MAX_ROUNDS,
      messages: n.messages,
      approvalPrice: deal.status === "awaiting_approval" ? n.approval?.price : undefined,
    },
  };
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
  const quotes = sameProductQuotes(product, await (earlyQuotes ?? findAlternatives(searchQuery, product.sourceUrl)));
  emit({ type: "quotes", quotes });
  await log(
    "sellers_compared",
    quotes.length ? quotes.map((q) => `${q.seller} ${inr(q.price)}${q.inStock ? "" : " (oos)"}`).join(", ") : "No other sellers found",
  );

  const { terms, bestSeller, originalPrice } = computeTerms(product, quotes);
  const opening: Offer = {
    originalPrice,
    dealPrice: terms.opening,
    saved: originalPrice - terms.opening,
    perk: PERK,
    bestSeller,
  };
  await log(
    "offer_computed",
    `Best price ${bestSeller} ${inr(terms.benchmark)}; ${terms.category} commission ~${(terms.commissionRate * 100).toFixed(1)}% → budget ${inr(terms.budget)}, auto-approve to ${inr(terms.autoLimit)}, floor ${inr(terms.floor)}; opening ${inr(terms.opening)}`,
  );

  emit({ type: "step", text: "Seller agent is making an opening offer" });
  let haggle = "";
  for await (const chunk of streamHaggle(product, quotes, opening)) {
    haggle += chunk;
    emit({ type: "haggle", text: chunk });
  }
  emit({ type: "offer", offer: opening });

  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  const now = Date.now();
  const deal: Deal = {
    id,
    product,
    alternatives: quotes,
    ...opening,
    haggle: haggle.trim(),
    negotiation: {
      terms,
      currentOffer: terms.opening,
      rounds: 0,
      messages: [{ from: "agent", text: haggle.trim(), price: terms.opening, at: now }],
    },
    lockFee: LOCK_FEE_INR,
    simulate: simulateEnabled,
    createdAt: now,
    expiresAt: now + NEGOTIATION_WINDOW_MS,
    status: "negotiating",
    city: ctx.city,
    channel: ctx.channel,
    waFrom: ctx.waFrom,
    userId,
  };

  await store.saveDeal(deal, true);
  await store.incrStats({ deals: 1 });
  await log("agent_move", `Opening offer ${inr(terms.opening)} for ${product.title}`, "agent", id);
  emit({ type: "deal", deal: toPublic(deal) });
  return deal;
}

const logFor = (deal: Deal) => (type: ActivityType, detail: string, actor: Activity["actor"]) =>
  store.log({ type, actor, userId: deal.userId, dealId: deal.id, detail });

/** Agreed price: create the UPI deal-lock payment and start the 180s invoice clock. */
async function issueInvoice(deal: Deal, price: number, agreedBy: string) {
  const payment = await createDealPayment({ dealId: deal.id, title: deal.product.title });
  Object.assign(deal, payment, {
    dealPrice: price,
    saved: deal.originalPrice - price,
    status: "pending",
    simulate: simulateEnabled || !payment.qrDataUrl,
    expiresAt: Date.now() + TTL_MS,
  });
  if (deal.negotiation) deal.negotiation.currentOffer = price;
  const log = logFor(deal);
  await log("deal_agreed", `Agreed ${inr(price)} (${agreedBy}); saves ${inr(deal.saved)} vs ${inr(deal.originalPrice)}`, "agent");
  await log(
    "payment_link_created",
    deal.pinelabsOrderId
      ? `Pine Labs UPI order ${deal.pinelabsOrderId} for ${inr(deal.lockFee)} deal lock, ${TTL_MS / 1000}s window`
      : deal.qrDataUrl
        ? `Static UPI QR for ${inr(deal.lockFee)} deal lock`
        : "No UPI QR available; simulated payment enabled",
    "system",
  );
  return deal;
}

export class HaggleError extends Error {}

/** Shopper makes a counter-offer; the seller agent responds within code-enforced limits. */
export async function submitOffer(deal: Deal, offer: number) {
  const n = deal.negotiation;
  if (!n || deal.status !== "negotiating") throw new HaggleError(`This deal is ${deal.status}.`);
  if (!Number.isFinite(offer) || offer < 1 || offer > deal.originalPrice * 2) throw new HaggleError("Enter a price in rupees.");
  offer = Math.round(offer);

  const log = logFor(deal);
  n.messages.push({ from: "shopper", text: `How about ${inr(offer)}?`, price: offer, at: Date.now() });
  await log("offer_received", `Shopper offered ${inr(offer)} (agent at ${inr(n.currentOffer)}, round ${n.rounds + 1})`, "user");

  const { move, message } = await chooseMove({
    product: deal.product,
    terms: n.terms,
    bestSeller: deal.bestSeller,
    quotes: deal.alternatives,
    negotiation: n,
    offer,
  });
  n.messages.push({ from: "agent", text: message, price: move.price, at: Date.now() });
  await log("agent_move", `${move.action} at ${inr(move.price)}: "${message}"`, "agent");

  if (move.action === "accept") {
    await issueInvoice(deal, move.price, "seller agent accepted shopper's offer");
  } else if (move.action === "escalate") {
    deal.status = "awaiting_approval";
    deal.expiresAt = Date.now() + APPROVAL_WINDOW_MS;
    n.approval = { price: move.price, requestedAt: Date.now() };
    await log(
      "approval_requested",
      `Needs human approval: ${inr(move.price)} is below the agent's auto-approve limit ${inr(n.terms.autoLimit)} (floor ${inr(n.terms.floor)})`,
      "agent",
    );
  } else {
    n.currentOffer = move.price;
    n.rounds += 1;
    deal.dealPrice = move.price;
    deal.saved = deal.originalPrice - move.price;
  }
  await store.saveDeal(deal);
  return deal;
}

/** Shopper accepts the agent's current offer. */
export async function acceptOffer(deal: Deal) {
  const n = deal.negotiation;
  if (!n || deal.status !== "negotiating") throw new HaggleError(`This deal is ${deal.status}.`);
  n.messages.push({ from: "shopper", text: `Deal at ${inr(n.currentOffer)}.`, price: n.currentOffer, at: Date.now() });
  await issueInvoice(deal, n.currentOffer, "shopper accepted agent's offer");
  await store.saveDeal(deal);
  return deal;
}

/** Human deal desk approves or rejects a price below the agent's auto-approve limit. */
export async function decideApproval(deal: Deal, decision: "approved" | "rejected", decidedBy: string) {
  const n = deal.negotiation;
  if (!n?.approval || deal.status !== "awaiting_approval") throw new HaggleError("Nothing waiting for approval.");
  const { price } = n.approval;
  Object.assign(n.approval, { decision, decidedAt: Date.now(), decidedBy });
  await logFor(deal)(
    "approval_decided",
    `${decidedBy} ${decision} ${inr(price)} (requested ${Math.round((Date.now() - n.approval.requestedAt) / 1000)}s ago)`,
    "human",
  );

  if (decision === "approved") {
    n.messages.push({ from: "desk", text: `Deal desk approved ${inr(price)}. It's yours.`, price, at: Date.now() });
    await issueInvoice(deal, price, `approved by ${decidedBy}`);
  } else {
    const final = n.terms.autoLimit;
    n.messages.push({
      from: "desk",
      text: `Deal desk couldn't do ${inr(price)}. Final offer: ${inr(final)}, take it or leave it.`,
      price: final,
      at: Date.now(),
    });
    Object.assign(n, { currentOffer: final, rounds: MAX_ROUNDS });
    Object.assign(deal, { status: "negotiating", dealPrice: final, saved: deal.originalPrice - final, expiresAt: Date.now() + NEGOTIATION_WINDOW_MS });
  }
  await store.saveDeal(deal);
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
