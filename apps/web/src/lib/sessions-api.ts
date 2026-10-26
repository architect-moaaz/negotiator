import { readIntent } from "@ghostcart/agent";
import { bearer, storeForKey } from "./integrations/keys";
import { acceptOffer, counterFromApprover, decideApproval, HaggleError, submitOffer } from "./negotiate";
import { ShopError, startShopNegotiation } from "./shop/negotiation";
import { getProductByRef } from "./shop/products";
import { store as kv } from "./store";
import type { Deal } from "./types";
import { traced } from "./telemetry";

/**
 * The one negotiation API every channel can use (plan: "/api/v1/sessions"). A seller's own system, a
 * chat adapter or a partner calls it with the store's secret key; GhostCart runs the agent, the limits
 * and approvals exactly as on its own pages. Prices are whole rupees.
 */

export class SessionError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export async function storeFromKey(request: Request) {
  const found = await storeForKey(bearer(request), "secret");
  if (!found) throw new SessionError("Invalid or revoked API key. Use the store's secret key: Authorization: Bearer gc_sk_…", 401);
  return found.store;
}

/** A session (deal) that belongs to this store, or 404. */
export async function sessionFor(storeId: string, id: string) {
  const deal = await kv.getDeal(id);
  if (!deal || deal.shop?.storeId !== storeId) throw new SessionError("Session not found.", 404);
  return deal;
}

const APP_URL = () => (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");

/** What API callers see: no internal ids, phone numbers, terms or payment-gateway references. */
export function sessionView(deal: Deal) {
  const n = deal.negotiation;
  const last = n?.messages.at(-1);
  return {
    id: deal.id,
    status: deal.status,
    product: { id: deal.shop?.productId, title: deal.product.title },
    listPrice: deal.originalPrice,
    currentOffer: n?.currentOffer ?? deal.dealPrice,
    agreedPrice: deal.status === "pending" || deal.status === "paid" || deal.status === "granted" ? deal.dealPrice : null,
    rounds: n?.rounds ?? 0,
    awaitingApproval: deal.status === "awaiting_approval" ? { price: n?.approval?.price } : null,
    reply: last && last.from !== "shopper" ? last.text : null,
    messages: (n?.messages ?? []).map((m) => ({ from: m.from, text: m.text, price: m.price ?? null, at: new Date(m.at).toISOString() })),
    expiresAt: new Date(deal.expiresAt).toISOString(),
    version: deal.version ?? 1,
    // How the shopper completes the purchase once a price is agreed.
    grant: deal.grant ? { code: deal.grant.code, checkoutUrl: deal.grant.checkoutUrl, expiresAt: new Date(deal.grant.expiresAt).toISOString() } : null,
    payment: deal.status === "pending" && deal.upiIntent ? { lockFee: deal.lockFee, upiIntent: deal.upiIntent, url: `${APP_URL()}/deal/${deal.id}`, testMode: deal.testPayments } : null,
  };
}

export async function createSession(storeId: string, body: { product?: string; shopper?: { id?: string }; city?: string }) {
  const ref = String(body.product ?? "").trim();
  const shopperId = String(body.shopper?.id ?? "").trim();
  if (!ref) throw new SessionError("Send product: the SKU or GhostCart product id.");
  if (!/^[\w.:@-]{1,80}$/.test(shopperId)) throw new SessionError("Send shopper.id: your own stable id for this shopper (letters, digits, . : @ - _).");
  const product = await getProductByRef(storeId, ref);
  if (!product) throw new SessionError("No product with that SKU or id in this store.", 404);
  try {
    // Shoppers are the seller's own customers, namespaced per store; limits (open deals, risk) apply per shopper.
    return await startShopNegotiation(product.id, `ext:${storeId}:${shopperId}`, { channel: "api", city: body.city?.slice(0, 60) });
  } catch (err) {
    if (err instanceof ShopError) throw new SessionError(err.message, err.status);
    throw err;
  }
}

/** An offer as a number, or the shopper's own words ("can you do 1200?", "ok deal"), read like the chat channels do. */
export async function makeOffer(deal: Deal, body: { amount?: number; text?: string }) {
  try {
    if (body.amount !== undefined) return await submitOffer(deal, Number(body.amount));
    const text = String(body.text ?? "").slice(0, 500);
    if (!text.trim()) throw new SessionError("Send amount (rupees) or text (the shopper's words).");
    const intent = await traced("agent.read_intent", { "deal.id": deal.id, channel: "api" }, () => readIntent(text, { listPrice: deal.originalPrice, currentOffer: deal.negotiation?.currentOffer }));
    if (intent.kind === "accept") return await acceptOffer(deal);
    if (intent.kind === "offer") return await submitOffer(deal, intent.amount);
    throw new SessionError("Couldn't find a price or a yes in that. Send amount, or text with a number.", 422);
  } catch (err) {
    if (err instanceof HaggleError) throw new SessionError(err.message, 409);
    throw err;
  }
}

export async function accept(deal: Deal) {
  try {
    return await acceptOffer(deal);
  } catch (err) {
    if (err instanceof HaggleError) throw new SessionError(err.message, 409);
    throw err;
  }
}

/** The seller's decision on an escalated offer, from their own system (or our dashboard, push, voice: same path). */
export async function decide(deal: Deal, body: { decision?: string; price?: number; by?: string }) {
  const by = String(body.by ?? "").trim().slice(0, 80) || "Seller (API)";
  try {
    if (body.decision === "approved" || body.decision === "rejected") return await decideApproval(deal, body.decision, by, "seller");
    if (body.decision === "counter") {
      const t = deal.negotiation?.terms;
      const price = Math.round(Number(body.price));
      if (!t || !(price >= Math.max(t.floor, deal.negotiation?.approval?.price ?? 0) && price <= t.benchmark))
        throw new SessionError(`Counter between the shopper's offer and the list price, and not below the floor of ₹${t?.floor.toLocaleString("en-IN")}.`);
      return await counterFromApprover(deal, price, by, "seller");
    }
    throw new SessionError('decision must be "approved", "rejected" or "counter" (with price).');
  } catch (err) {
    if (err instanceof HaggleError) throw new SessionError(err.message, 409);
    throw err;
  }
}

/** Shared error handling for the v1 session routes. */
export async function handle(run: () => Promise<Response>) {
  try {
    return await run();
  } catch (err) {
    if (err instanceof SessionError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
