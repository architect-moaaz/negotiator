import { inr, TIER_LIMITS, type SellerTier } from "@ghostcart/core";
import { assertCanHaggle, FraudBlock } from "../fraud/checks";
import { allowedReturnUrl } from "../integrations/keys";
import { settlementGateway } from "../orders/settlement";
import { LOCK_FEE_INR, testPayments } from "../payments";
import { store as kv } from "../store";
import type { Deal } from "../types";
import { policyForProduct, termsForProduct } from "./policies";
import { getProduct } from "./products";
import { getStore } from "./stores";

export class ShopError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/**
 * A shopper starts haggling on a GhostCart Shop product. The seller's list price is the benchmark and
 * their discount rules set the limits; from here the normal haggle, approval and checkout flow runs.
 */
export async function startShopNegotiation(productId: string, userId: string, opts: { channel?: string; city?: string; request?: Request; returnUrl?: string } = {}) {
  const product = await getProduct(productId);
  const store = product && (await getStore(product.storeId));
  if (!product || !store || product.status !== "active") throw new ShopError("This product isn't available.", 404);
  if (store.status !== "live") throw new ShopError("This shop isn't open yet.", 409);
  // Without a settlement gateway the buyer's money would land with GhostCart instead of on hold for the seller.
  if (!settlementGateway()) throw new ShopError("This shop isn't taking payments yet. Check back soon.", 503);
  if (product.stock < 1) throw new ShopError("Out of stock right now.", 409);
  const cap = TIER_LIMITS[store.tier as SellerTier]?.maxOrderValue ?? TIER_LIMITS.new.maxOrderValue;
  if (product.price > cap) throw new ShopError(`This shop can take orders up to ${inr(cap)} for now.`, 409);
  try {
    await assertCanHaggle({ userId, orgId: store.orgId, storeId: store.id, request: opts.request });
  } catch (err) {
    if (err instanceof FraudBlock) throw new ShopError(err.message, 403);
    throw err;
  }

  const terms = await termsForProduct(product, store, opts.channel ?? "shop");
  if (!terms) throw new ShopError("This product is sold at a fixed price.", 409);
  const policy = await policyForProduct(product);

  const now = Date.now();
  const opening = `${product.title} lists at ${inr(product.price)}. For you, right now: ${inr(terms.opening)}. Make me an offer.`;
  const deal: Deal = {
    id: crypto.randomUUID().replace(/-/g, "").slice(0, 10),
    product: {
      title: product.title,
      seller: store.name,
      price: product.price,
      mrp: product.mrp ?? undefined,
      imageUrl: product.images[0],
      inStock: product.stock > 0,
    },
    alternatives: [],
    originalPrice: Math.max(product.mrp ?? 0, product.price),
    dealPrice: terms.opening,
    saved: Math.max(product.mrp ?? 0, product.price) - terms.opening,
    perk: `Ships from ${store.name}`,
    bestSeller: store.name,
    haggle: opening,
    negotiation: { terms, currentOffer: terms.opening, rounds: 0, messages: [{ from: "agent", text: opening, price: terms.opening, at: now }] },
    lockFee: LOCK_FEE_INR,
    testPayments,
    createdAt: now,
    expiresAt: now + policy.expiryMinutes * 60 * 1000,
    status: "negotiating",
    city: opts.city,
    channel: "web",
    userId,
    shop: { storeId: store.id, productId: product.id, slug: store.slug, storeName: store.name, returnUrl: (await allowedReturnUrl(store.id, opts.returnUrl)) ?? undefined },
  };
  await kv.saveDeal(deal, true);
  await kv.incrStats({ deals: 1 });
  await kv.log({ type: "negotiation_started", actor: "user", userId, dealId: deal.id, detail: `Shop haggle on ${product.title} (${store.name}) at list ${inr(product.price)}` });
  await kv.log({ type: "agent_move", actor: "agent", userId, dealId: deal.id, detail: `Opening offer ${inr(terms.opening)} (agent alone to ${inr(terms.autoLimit)}, floor ${inr(terms.floor)})` });
  return deal;
}
