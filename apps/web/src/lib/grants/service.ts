import { accounts, assertBalanced, inr, orderMoney } from "@ghostcart/core";
import { getDb } from "../db";
import { post } from "../orders/ledger";
import { getProduct } from "../shop/products";
import { getStore } from "../shop/stores";
import { store as kv } from "../store";
import type { Deal } from "../types";
import { grantAdapterFor, grantCode } from "./adapters";

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
  const discountInr = product.price - price;
  const { checkoutUrl } = await adapter.createGrant({ store, product, code, discountInr, expiresAt });

  Object.assign(deal, {
    status: "granted",
    dealPrice: price,
    saved: deal.originalPrice - price,
    expiresAt: expiresAt.getTime(),
    grant: { platform: adapter.platform, code, checkoutUrl, expiresAt: expiresAt.getTime() },
  });
  if (deal.negotiation) deal.negotiation.currentOffer = price;
  await kv.log({ type: "deal_agreed", actor: "agent", userId: deal.userId, dealId: deal.id, detail: `Agreed ${inr(price)} (${agreedBy}); ${adapter.platform} code ${code} for ${inr(discountInr)} off, valid ${GRANT_MINUTES()} min` });
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
  await kv.log({ type: "order_placed", actor: "system", userId: deal.userId, dealId: deal.id, detail: `${deal.grant.platform} order ${input.platformOrderRef} used ${input.code}; fee ${inr((m.fee + m.gst) / 100)} owed by the seller` });
  return deal;
}
