import { openCheckout, toPublicCheckout } from "./checkout";
import { chooseMove, MAX_ROUNDS, overrideAfterRejection } from "./haggle";
import { notifyChat } from "./chat/engine";
import { HaggleError } from "./errors";
import { recordEvent } from "./negotiation-events";
import { GRANT_PLATFORMS } from "./grants/adapters";
import { GrantError, issueGrant } from "./grants/service";
import { createDealPayment, PaymentsUnavailableError, testPayments } from "./payments";
import { inr, shortTitle } from "./format";
import { maskPhone, normalizePhone } from "./users";
import { placeCall, vobizConfigured } from "./vobiz";
import { store } from "./store";
import type { Activity, ActivityType, Deal, PublicDeal } from "./types";

const TTL_MS = Number(process.env.DEAL_TTL_SECONDS ?? 180) * 1000;
const NEGOTIATION_WINDOW_MS = 15 * 60 * 1000;
const APPROVAL_WINDOW_MS = 30 * 60 * 1000;

export { inr };

export function toPublic(deal: Deal): PublicDeal {
  const pub: Partial<Deal> = { ...deal };
  delete pub.pinelabsOrderId;
  delete pub.userId;
  delete pub.negotiation;
  delete pub.checkout;
  const n = deal.negotiation;
  return {
    ...(pub as Omit<PublicDeal, "negotiation" | "checkout">),
    checkout: toPublicCheckout(deal.checkout),
    negotiation: n && {
      fundedBy: n.terms.fundedBy ?? "ghostcart",
      sellerName: n.terms.sellerName,
      benchmark: n.terms.benchmark,
      currentOffer: n.currentOffer,
      rounds: n.rounds,
      maxRounds: MAX_ROUNDS,
      messages: n.messages,
      approvalPrice: deal.status === "awaiting_approval" ? n.approval?.price : undefined,
      callStatus: deal.status === "awaiting_approval" ? n.call?.status : undefined,
      reviewedByAgent: deal.status === "awaiting_approval" ? !!n.recommendation : undefined,
    },
  };
}

const logFor = (deal: Deal) => (type: ActivityType, detail: string, actor: Activity["actor"]) =>
  store.log({ type, actor, userId: deal.userId, dealId: deal.id, detail });

/** Agreed price: create the UPI deal-lock payment and start the 180s invoice clock. */
async function issueInvoice(deal: Deal, price: number, agreedBy: string) {
  // Shopify/WooCommerce stores: the shopper pays on the seller's own checkout with a single-use code.
  if (deal.shop?.platform && GRANT_PLATFORMS.has(deal.shop.platform)) {
    try {
      return await issueGrant(deal, price, agreedBy);
    } catch (err) {
      if (err instanceof GrantError) throw new HaggleError(err.message);
      console.error("price grant failed", err);
      throw new HaggleError("Couldn't create your discount code on the store. Try accepting again.");
    }
  }
  let payment;
  try {
    payment = await createDealPayment({ dealId: deal.id, title: deal.product.title });
  } catch (err) {
    if (!(err instanceof PaymentsUnavailableError)) throw err;
    await logFor(deal)("payment_link_created", `No lock payment for ${inr(price)}: ${err.message}`, "system");
    // Nothing is saved, so the deal stays where it was and the shopper can accept again.
    throw new HaggleError("Your price is agreed, but payments are paused right now. Try again in a few minutes.");
  }
  Object.assign(deal, payment, {
    dealPrice: price,
    saved: deal.originalPrice - price,
    status: "pending",
    testPayments,
    expiresAt: Date.now() + TTL_MS,
  });
  if (deal.negotiation) deal.negotiation.currentOffer = price;
  const log = logFor(deal);
  await log("deal_agreed", `Agreed ${inr(price)} (${agreedBy}); saves ${inr(deal.saved)} vs ${inr(deal.originalPrice)}`, "agent");
  await log(
    "payment_link_created",
    `Pine Labs${testPayments ? " test" : ""} UPI order ${deal.pinelabsOrderId} for ${inr(deal.lockFee)} deal lock, ${TTL_MS / 1000}s window`,
    "system",
  );
  return deal;
}

export { HaggleError };

/** Shopper makes a counter-offer; the seller agent responds within code-enforced limits. */
export async function submitOffer(deal: Deal, offer: number) {
  const n = deal.negotiation;
  if (!n || deal.status !== "negotiating") throw new HaggleError(`This deal is ${deal.status}.`);
  if (!Number.isFinite(offer) || offer < 1 || offer > deal.originalPrice * 2) throw new HaggleError("Enter a price in rupees.");
  offer = Math.round(offer);

  const log = logFor(deal);
  n.messages.push({ from: "shopper", text: `How about ${inr(offer)}?`, price: offer, at: Date.now() });
  await log("offer_received", `Shopper offered ${inr(offer)} (agent at ${inr(n.currentOffer)}, round ${n.rounds + 1})`, "user");

  const chosen = await chooseMove({
    product: deal.product,
    terms: n.terms,
    bestSeller: deal.bestSeller,
    quotes: deal.alternatives,
    negotiation: n,
    offer,
  });
  const { move, message } = overrideAfterRejection(chosen.move, n) ?? chosen;
  n.messages.push({ from: "agent", text: message, price: move.price, at: Date.now() });
  await log("agent_move", `${move.action} at ${inr(move.price)}: "${message}"`, "agent");

  if (move.action === "accept") {
    await issueInvoice(deal, move.price, "seller agent accepted shopper's offer");
  } else if (move.action === "escalate") {
    deal.status = "awaiting_approval";
    deal.expiresAt = Date.now() + APPROVAL_WINDOW_MS;
    n.approval = { price: move.price, requestedAt: Date.now() };
    n.recommendation = undefined; // a new escalation needs a fresh review
    await log(
      "approval_requested",
      `Needs human approval: ${inr(move.price)} is below the agent's auto-approve limit ${inr(n.terms.autoLimit)} (floor ${inr(n.terms.floor)})`,
      "agent",
    );
    await startApprovalCall(deal);
  } else {
    n.currentOffer = move.price;
    n.rounds += 1;
    deal.dealPrice = move.price;
    deal.saved = deal.originalPrice - move.price;
  }
  await store.saveDeal(deal);
  await recordEvent(deal, "offer", "shopper", { price: offer });
  await recordEvent(deal, move.action === "accept" ? "agreed" : move.action === "escalate" ? "escalated" : move.action, "agent", { price: move.price, message });
  // Only once the deal is saved: a notification must never point at a state that didn't stick.
  if (move.action === "escalate") await pushApprovalRequest(deal, move.price);
  return deal;
}

/** Shopper accepts the agent's current offer. */
export async function acceptOffer(deal: Deal) {
  const n = deal.negotiation;
  if (!n || deal.status !== "negotiating") throw new HaggleError(`This deal is ${deal.status}.`);
  n.messages.push({ from: "shopper", text: `Deal at ${inr(n.currentOffer)}.`, price: n.currentOffer, at: Date.now() });
  await issueInvoice(deal, n.currentOffer, "shopper accepted agent's offer");
  await store.saveDeal(deal);
  await recordEvent(deal, "agreed", "shopper", { price: n.currentOffer });
  return deal;
}

/** Human deal desk approves or rejects a price below the agent's auto-approve limit. */
/** Phone the approver (the seller, or the deal desk for GhostCart-funded deals) through Vobiz. */
/** The GhostCart Shop owner (or an admin/approver) to phone about a seller-funded offer. */
async function shopApproverPhone(storeId: string) {
  const { getStore } = await import("./shop/stores");
  const { approverPhones } = await import("./shop/orgs");
  const s = await getStore(storeId);
  return s ? (await approverPhones(s.orgId))[0]?.phone : undefined;
}

/** A shop's approvers get a push on their phones (the app opens the offer to approve or reject). */
async function pushApprovalRequest(deal: Deal, price: number) {
  if (!deal.shop) return;
  const { getStore } = await import("./shop/stores");
  const { notifyApprovers } = await import("./push");
  const s = await getStore(deal.shop.storeId);
  if (s) await notifyApprovers(s.orgId, { title: `Offer: ${inr(price)}`, body: `A shopper offered ${inr(price)} for ${deal.product.title} (list ${inr(deal.originalPrice)}). Approve or reject.`, data: { type: "approval", storeId: s.id, dealId: deal.id } });
}

/** Tell the shopper the seller decided, by push, if they use the app. */
async function pushDecision(deal: Deal, text: string) {
  const { notifyBuyer } = await import("./push");
  await notifyBuyer(deal.userId, { title: deal.shop?.storeName ?? "Your deal", body: text, data: { type: "deal", dealId: deal.id } });
}

async function startApprovalCall(deal: Deal) {
  const n = deal.negotiation!;
  if (!vobizConfigured) return;
  const role = n.terms.fundedBy === "seller" ? "seller" : "desk";
  const phone =
    role === "desk"
      ? process.env.VOBIZ_DESK_PHONE && normalizePhone(process.env.VOBIZ_DESK_PHONE)
      : deal.shop
        ? await shopApproverPhone(deal.shop.storeId)
        : n.terms.sellerId && (await store.getSeller(n.terms.sellerId))?.phone;
  if (!phone) return;

  n.call = { status: "calling", to: phone, role, turns: 0, transcript: [], startedAt: Date.now() };
  try {
    const res = await placeCall({ to: phone, dealId: deal.id });
    n.call.callUuid = res.request_uuid;
    await logFor(deal)("approval_call_placed", `Calling ${role === "seller" ? n.terms.sellerName : "deal desk"} via Vobiz (${maskPhone(phone)})`, "agent");
  } catch (err) {
    n.call.status = "failed";
    await logFor(deal)("approval_call_ended", `Vobiz call failed: ${String(err).slice(0, 200)}`, "system");
  }
}

/** The approver names their own price on the call; it goes back to the shopper as the new offer. */
export async function counterFromApprover(deal: Deal, price: number, decidedBy: string, role: "desk" | "seller") {
  const n = deal.negotiation;
  if (!n?.approval || deal.status !== "awaiting_approval") throw new HaggleError("Nothing waiting for approval.");
  Object.assign(n.approval, { decision: "countered", decidedAt: Date.now(), decidedBy });
  const who = role === "seller" ? (n.terms.sellerName ?? "The seller") : "Deal desk";
  await logFor(deal)("approval_decided", `${decidedBy} countered ${inr(n.approval.price)} with ${inr(price)}`, role === "seller" ? "seller" : "human");
  n.messages.push({ from: role, text: `${who} says: ${inr(price)}, and that's a real deal. Take it?`, price, at: Date.now() });
  Object.assign(n, { currentOffer: price, rounds: MAX_ROUNDS });
  Object.assign(deal, { status: "negotiating", dealPrice: price, saved: deal.originalPrice - price, expiresAt: Date.now() + NEGOTIATION_WINDOW_MS });
  await store.saveDeal(deal);
  await recordEvent(deal, "countered", role, { price, message: n.messages.at(-1)!.text });
  await notifyChat(deal);
  await pushDecision(deal, n.messages.at(-1)!.text);
  return deal;
}

export async function decideApproval(deal: Deal, decision: "approved" | "rejected", decidedBy: string, role: "desk" | "seller" = "desk") {
  const n = deal.negotiation;
  if (!n?.approval || deal.status !== "awaiting_approval") throw new HaggleError("Nothing waiting for approval.");
  const { price } = n.approval;
  // Create the lock payment first: if payments are down this throws before anything is recorded,
  // so the offer stays waiting and the approver can try again.
  if (decision === "approved") await issueInvoice(deal, price, `approved by ${decidedBy}`);
  Object.assign(n.approval, { decision, decidedAt: Date.now(), decidedBy });
  await logFor(deal)(
    "approval_decided",
    `${decidedBy} ${decision} ${inr(price)} (requested ${Math.round((Date.now() - n.approval.requestedAt) / 1000)}s ago)`,
    role === "seller" ? "seller" : "human",
  );
  const who = role === "seller" ? (n.terms.sellerName ?? "The seller") : "Deal desk";

  if (decision === "approved") {
    n.messages.push({ from: role, text: `${who} approved ${inr(price)}. It's yours.`, price, at: Date.now() });
  } else {
    const final = n.terms.autoLimit;
    n.messages.push({
      from: role,
      text: `${who} couldn't do ${inr(price)}. Final offer: ${inr(final)}, take it or leave it.`,
      price: final,
      at: Date.now(),
    });
    Object.assign(n, { currentOffer: final, rounds: MAX_ROUNDS });
    Object.assign(deal, { status: "negotiating", dealPrice: final, saved: deal.originalPrice - final, expiresAt: Date.now() + NEGOTIATION_WINDOW_MS });
  }
  await store.saveDeal(deal);
  await recordEvent(deal, decision, role, { price: decision === "approved" ? price : n.terms.autoLimit, message: n.messages.at(-1)!.text });
  await notifyChat(deal);
  await pushDecision(deal, n.messages.at(-1)!.text);
  return deal;
}

/** Idempotently mark a deal paid, update stats, broadcast to the ticker and confirm on WhatsApp. */
export async function markPaid(deal: Deal, source: "pinelabs" | "pinelabs-webhook") {
  if (deal.status === "paid") return deal;
  if (!(await store.claimPaid(deal.id))) return { ...deal, status: "paid" as const };

  deal.status = "paid";
  await openCheckout(deal);
  await store.saveDeal(deal);
  await recordEvent(deal, "paid", "system", { price: deal.lockFee });
  await store.incrStats({ paid: 1, saved: deal.saved });
  await store.log({
    type: "payment_received",
    actor: "system",
    userId: deal.userId,
    dealId: deal.id,
    detail: `${source}: ${inr(deal.lockFee)} deal lock paid${deal.pinelabsOrderId ? ` (Pine Labs ${process.env.PINELABS_MODE === "mock" ? "UAT mock " : ""}order ${deal.pinelabsOrderId})` : ""}; ${deal.product.title} at ${inr(deal.dealPrice)}`,
  });
  await store.pushTicker({
    id: deal.id,
    city: deal.city,
    saved: deal.saved,
    at: Date.now(),
    message: `Someone${deal.city ? ` in ${deal.city}` : ""} just grabbed ${shortTitle(deal.product.title)} for ${inr(deal.dealPrice)} instead of ${inr(deal.originalPrice)}`,
  });
  return deal;
}
