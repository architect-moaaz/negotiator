import { accounts, allocateCartDiscount, assertBalanced, inr, orderMoney } from "@ghostcart/core";
import { getDb } from "../db";
import { post } from "../orders/ledger";
import { getProduct } from "../shop/products";
import { getStore } from "../shop/stores";
import { store as kv } from "../store";
import type { Deal } from "../types";
import { updateCart } from "../privilege/carts";
import { grantAdapterFor, grantCode, type GrantLine } from "./adapters";

const GRANT_MINUTES = () => Number(process.env.GRANT_MINUTES ?? 30);
const FEE_BPS = () => Number(process.env.PLATFORM_FEE_BPS ?? 200);

export class GrantError extends Error {}

/** Agreed on a Shopify/Woo store: issue the discount code. Nothing is saved if the platform call fails. */
export async function issueGrant(deal: Deal, price: number, agreedBy: string) {
  if (!deal.shop) throw new GrantError("Not a store deal.");
  const store = await getStore(deal.shop.storeId);
  const product = await getProduct(deal.shop.productId);
  if (!store || !product) throw new GrantError("This product isn't available any more.");
  const adapter = await grantAdapterFor(store);
  if (!adapter) throw new GrantError(`${store.name}'s store isn't connected right now. Try again shortly.`);
  const code = grantCode();
  const expiresAt = new Date(Date.now() + GRANT_MINUTES() * 60 * 1000);
  let discountInr = product.price - price;
  let lines: GrantLine[] | undefined;
  if (deal.cart) {
    // A Privilege cart: re-read every line and split the cart discount across them by list value.
    const products = await Promise.all(deal.cart.lines.map((l) => getProduct(l.productId)));
    if (products.some((p) => !p || p.storeId !== store.id)) throw new GrantError("Something in this cart isn't available any more.");
    const shares = allocateCartDiscount(deal.cart.lines, price);
    lines = deal.cart.lines.map((l, i) => ({ product: products[i]!, quantity: l.quantity, discountInr: shares[i] }));
    discountInr = shares.reduce((a, b) => a + b, 0);
  }
  const { checkoutUrl, kind = "code", ref } = await adapter.createGrant({ store, product, code, discountInr, expiresAt, lines });

  Object.assign(deal, {
    status: "granted",
    dealPrice: price,
    saved: deal.originalPrice - price,
    expiresAt: expiresAt.getTime(),
    grant: { platform: adapter.platform, code, kind, ref, checkoutUrl, expiresAt: expiresAt.getTime() },
  });
  if (deal.negotiation) deal.negotiation.currentOffer = price;
  await kv.log({ type: "deal_agreed", actor: "agent", userId: deal.userId, dealId: deal.id, detail: `Agreed ${inr(price)} (${agreedBy}); ${adapter.platform} ${kind === "draft_order" ? "draft order" : "code"} ${code} for ${inr(discountInr)} off, valid ${GRANT_MINUTES()} min` });
  return deal;
}

/**
 * The platform reports an order that used the code: the deal is won, and GhostCart's fee is owed by
 * the seller (collected through Shopify billing or a monthly invoice). Safe to call twice.
 */
export async function redeemGrant(input: { storeId: string; code: string; platformOrderRef: string; paidInr?: number }) {
  const deal = (await kv.listDeals(5000)).find((d) => d.grant?.code === input.code && d.shop?.storeId === input.storeId);
  if (!deal?.grant) return null;
  if (deal.grant.redeemedAt) return deal;
  deal.grant.redeemedAt = Date.now();
  deal.grant.platformOrderRef = input.platformOrderRef;
  await kv.saveDeal(deal);

  const m = orderMoney({ priceInr: deal.dealPrice, lockFeeInr: 0, feeBps: FEE_BPS() });
  await post(await getDb(), {
    kind: "grant_fee",
    memo: `deal ${deal.id}, ${deal.grant.platform} order ${input.platformOrderRef}`,
    postings: assertBalanced([
      { account: accounts.sellerFeesDue(input.storeId), amount: m.fee + m.gst },
      { account: accounts.fee, amount: -m.fee },
      { account: accounts.gst, amount: -m.gst },
    ]),
  });
  await kv.incrStats({ paid: 1, saved: deal.saved });
  if (deal.cart) {
    await updateCart(deal.cart.cartId, { status: "recovered", recoveredAt: new Date() });
    await kv.log({ type: "cart_recovered", actor: "system", userId: deal.userId, dealId: deal.id, detail: `Privilege cart ${deal.cart.cartId} recovered: ${deal.grant.platform} order ${input.platformOrderRef} at ${inr(deal.dealPrice)}` });
  }
  await kv.log({ type: "order_placed", actor: "system", userId: deal.userId, dealId: deal.id, detail: `${deal.grant.platform} order ${input.platformOrderRef} used ${input.code}; fee ${inr((m.fee + m.gst) / 100)} owed by the seller` });
  return deal;
}

/**
 * Withdraw grants that expired unused where the platform won't expire them itself (Shopify draft
 * orders). Run by the order job; a failure is retried next run.
 */
export async function revokeExpiredGrants(now = Date.now()) {
  const revoked: string[] = [];
  for (const deal of await kv.listDeals(5000)) {
    const g = deal.grant;
    if (!g?.ref || g.redeemedAt || g.revokedAt || g.expiresAt > now || !deal.shop) continue;
    const store = await getStore(deal.shop.storeId);
    const adapter = store && (await grantAdapterFor(store));
    if (!store || !adapter?.revoke) continue;
    try {
      await adapter.revoke({ store, ref: g.ref });
      g.revokedAt = now;
      await kv.saveDeal(deal);
      revoked.push(deal.id);
    } catch (err) {
      console.error(`couldn't revoke ${g.platform} grant ${g.ref}`, err);
    }
  }
  return revoked;
}
