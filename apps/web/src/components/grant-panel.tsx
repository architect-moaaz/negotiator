"use client";

import { inr } from "@/lib/format";
import type { PublicDeal } from "@/lib/types";

/** Agreed on a Shopify/WooCommerce store: show the one-time code and send the shopper to the seller's checkout. */
export function GrantPanel({ deal, now }: { deal: PublicDeal; now: number }) {
  const g = deal.grant!;
  const left = Math.max(0, g.expiresAt - now);
  const minutes = Math.floor(left / 60_000);
  const seconds = Math.floor((left % 60_000) / 1000);
  const store = deal.shop?.storeName ?? deal.bestSeller;
  if (g.redeemedAt) {
    return (
      <div className="mx-auto max-w-xl">
        <h1 className="text-3xl font-bold">Done. You got it for {inr(deal.dealPrice)}.</h1>
        <p className="mt-3 text-muted">
          {store} has your order{g.platformOrderRef ? ` (${g.platformOrderRef})` : ""}. Shipping and delivery updates come from them.
        </p>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-xl">
      <p className="text-saffron">Agreed: {inr(deal.dealPrice)}</p>
      <h1 className="mt-3 text-3xl font-bold leading-tight">{deal.product.title}</h1>
      {g.kind === "draft_order" ? (
        <p className="mt-6 text-muted">
          {store} has set up an order for you at {inr(deal.dealPrice)}. {left > 0 ? `Pay within ${minutes}:${String(seconds).padStart(2, "0")} to keep this price.` : "The price has expired."}
        </p>
      ) : (
        <>
          <p className="mt-6 text-muted">Your one-time code for {store}&apos;s checkout:</p>
          <p className="mt-2 select-all rounded-xl border border-saffron/60 px-5 py-4 text-center font-receipt text-3xl tracking-[0.2em]">{g.code}</p>
          <p className="mt-3 text-sm text-muted">
            Takes {inr(deal.originalPrice - deal.dealPrice > 0 ? deal.product.price - deal.dealPrice : 0)} off this product only, once. {left > 0 ? `Use it within ${minutes}:${String(seconds).padStart(2, "0")}.` : "It has expired."}
          </p>
        </>
      )}
      {left > 0 && (
        <a href={g.checkoutUrl} className="mt-6 block rounded-xl bg-saffron px-6 py-4 text-center text-lg font-semibold text-paper-ink">
          {g.kind === "draft_order" ? `Pay ${inr(deal.dealPrice)} on ${store}` : `Continue to ${store}'s checkout`}
        </a>
      )}
      <p className="mt-4 text-sm text-muted">You pay {store} directly on their site; GhostCart never handles this payment.</p>
    </div>
  );
}
