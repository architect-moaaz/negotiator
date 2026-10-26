import { cartTerms, inr, recoveryLineTerms, TIER_LIMITS, type SellerTier } from "@ghostcart/core";
import { assertCanHaggle, FraudBlock } from "../fraud/checks";
import { grantAdapterFor, GRANT_PLATFORMS } from "../grants/adapters";
import { allowedReturnUrl } from "../integrations/keys";
import { recordEvent } from "../negotiation-events";
import { settlementGateway } from "../orders/settlement";
import { LOCK_FEE_INR, testPayments } from "../payments";
import { ShopError } from "../shop/negotiation";
import { policyForProduct } from "../shop/policies";
import { getProduct } from "../shop/products";
import { getStore } from "../shop/stores";
import { store as kv } from "../store";
import type { Deal } from "../types";
import { getCart, updateCart, RECOVERABLE, type CartStatus } from "./carts";
import { getRecovery } from "./settings";

/** How long a Privilege haggle stays open once the shopper starts it. */
const PRIVILEGE_MINUTES = 30;

/**
 * GhostCart Privilege: the shopper opens their private invite and makes the seller an offer on the
 * whole cart. Limits are each line's recovery limits summed (cartTerms); from here the normal haggle,
 * approval and grant flow runs, and a multi-line grant puts every item in the seller's checkout.
 */
export async function startCartNegotiation(cartId: string, userId: string, opts: { city?: string; request?: Request } = {}) {
  const cart = await getCart(cartId);
  if (!cart) throw new ShopError("This cart isn't available.", 404);
  if (cart.dealId) {
    const existing = await kv.getDeal(cart.dealId);
    if (existing && existing.userId === userId && ["negotiating", "awaiting_approval", "granted", "pending"].includes(existing.status)) return existing;
  }
  if (!RECOVERABLE.includes(cart.status as CartStatus) && cart.status !== "negotiating") throw new ShopError("This private offer isn't available any more.", 409);
  const store = await getStore(cart.storeId);
  if (!store || store.status !== "live") throw new ShopError("This store isn't taking orders on GhostCart right now.", 409);
  const recovery = await getRecovery(store.id);
  if (!recovery.enabled) throw new ShopError(`${store.name} isn't making private offers right now.`, 409);

  const grants = GRANT_PLATFORMS.has(store.platform);
  if (grants) {
    if (!(await grantAdapterFor(store))) throw new ShopError(`${store.name}'s store isn't connected to GhostCart right now.`, 503);
  } else {
    if (!settlementGateway()) throw new ShopError("This shop isn't taking payments yet. Check back soon.", 503);
    // GhostCart Shop checkout ships one product per order today.
    if (cart.lines.length > 1 || cart.lines[0].quantity > 1) throw new ShopError("Bundle offers on this shop are coming soon. Make an offer on one item for now.", 409);
  }

  // Re-read every product: prices, stock and rules may have changed since the cart was captured.
  const lines: NonNullable<Deal["cart"]>["lines"] = [];
  const lineTerms = [];
  for (const l of cart.lines) {
    const p = await getProduct(l.productId);
    if (!p || p.storeId !== store.id || p.status !== "active") throw new ShopError(`${l.title} isn't available any more.`, 409);
    if (p.stock < l.quantity) throw new ShopError(`Only ${p.stock} of ${p.title} left in stock.`, 409);
    const policy = await policyForProduct(p);
    const terms = recoveryLineTerms(policy, recovery, p.price, { sellerId: store.id, sellerName: store.name, category: "general" });
    lineTerms.push(terms && { terms, quantity: l.quantity });
    lines.push({ productId: p.id, title: p.title, quantity: l.quantity, unitPrice: p.price, image: p.images[0] });
  }
  const terms = cartTerms(lineTerms, { sellerId: store.id, sellerName: store.name });
  if (!terms) throw new ShopError("Some items in this cart are sold at a fixed price, so the cart can't be haggled.", 409);
  const listTotal = terms.benchmark;
  const cap = TIER_LIMITS[store.tier as SellerTier]?.maxOrderValue ?? TIER_LIMITS.new.maxOrderValue;
  if (listTotal > cap) throw new ShopError(`This shop can take orders up to ${inr(cap)} for now.`, 409);
  try {
    await assertCanHaggle({ userId, orgId: store.orgId, storeId: store.id, request: opts.request });
  } catch (err) {
    if (err instanceof FraudBlock) throw new ShopError(err.message, 403);
    throw err;
  }

  const itemCount = lines.reduce((s, l) => s + l.quantity, 0);
  const title = lines.length === 1 && lines[0].quantity === 1 ? lines[0].title : `Your cart: ${itemCount} items from ${store.name}`;
  const now = Date.now();
  const opening = `Welcome back. ${title} comes to ${inr(listTotal)}. As a GhostCart Privilege offer from ${store.name}, I can do ${inr(terms.opening)} right now. Make me an offer.`;
  const deal: Deal = {
    id: crypto.randomUUID().replace(/-/g, "").slice(0, 10),
    product: { title, seller: store.name, price: listTotal, imageUrl: lines[0].image, inStock: true },
    alternatives: [],
    originalPrice: listTotal,
    dealPrice: terms.opening,
    saved: listTotal - terms.opening,
    perk: `Private offer from ${store.name}`,
    bestSeller: store.name,
    haggle: opening,
    negotiation: { terms, currentOffer: terms.opening, rounds: 0, messages: [{ from: "agent", text: opening, price: terms.opening, at: now }] },
    lockFee: LOCK_FEE_INR,
    testPayments,
    createdAt: now,
    expiresAt: now + PRIVILEGE_MINUTES * 60 * 1000,
    status: "negotiating",
    city: opts.city,
    channel: "web",
    userId,
    shop: {
      storeId: store.id,
      productId: lines[0].productId,
      slug: store.slug,
      storeName: store.name,
      platform: store.platform,
      returnUrl: (await allowedReturnUrl(store.id, cart.returnUrl ?? undefined)) ?? undefined,
    },
    cart: { cartId: cart.id, lines },
  };
  await kv.saveDeal(deal, true);
  await updateCart(cart.id, { status: "negotiating", dealId: deal.id, userId, lastActivityAt: new Date() });
  await recordEvent(deal, "started", "agent", { price: terms.opening, message: opening });
  await kv.incrStats({ deals: 1 });
  await kv.log({ type: "negotiation_started", actor: "user", userId, dealId: deal.id, detail: `Privilege haggle on cart ${cart.id} (${itemCount} items, ${store.name}) at list ${inr(listTotal)}` });
  await kv.log({ type: "agent_move", actor: "agent", userId, dealId: deal.id, detail: `Opening offer ${inr(terms.opening)} (agent alone to ${inr(terms.autoLimit)}, floor ${inr(terms.floor)})` });
  return deal;
}
