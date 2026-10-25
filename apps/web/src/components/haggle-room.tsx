"use client";

import { useEffect, useRef, useState } from "react";
import { inr } from "@/lib/format";
import type { PublicDeal } from "@/lib/types";
import { SocialProof } from "./social-proof";

/** Live negotiation between the shopper and GhostCart's seller agent. */
export function HaggleRoom({ deal, onUpdate }: { deal: PublicDeal; onUpdate: (d: PublicDeal) => void }) {
  const n = deal.negotiation!;
  const waiting = deal.status === "awaiting_approval";
  const [offer, setOffer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const threadEnd = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);

  const seenMessages = useRef(n.messages.length);
  useEffect(() => {
    if (n.messages.length > seenMessages.current) threadEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    seenMessages.current = n.messages.length;
  }, [n.messages.length]);

  async function send(body: { offer?: number; accept?: boolean }) {
    setBusy(true);
    setError("");
    const res = await fetch("/api/haggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: deal.id, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error || "Couldn't send that. Try again.");
    setOffer("");
    onUpdate(data);
  }

  const offerValue = Number(offer.replace(/[^\d]/g, ""));
  const lastShopperPrice = [...n.messages].reverse().find((m) => m.from === "shopper")?.price;
  const offMarket = n.benchmark - n.currentOffer;
  const gap = lastShopperPrice !== undefined ? n.currentOffer - lastShopperPrice : 0;
  const secsLeft = now ? Math.max(0, Math.round((deal.expiresAt - now) / 1000)) : null;
  const windowLeft = secsLeft === null ? null : `${Math.floor(secsLeft / 60)}:${String(secsLeft % 60).padStart(2, "0")}`;

  return (
    <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
      <section>
        <p className="text-muted">
          {waiting
            ? n.fundedBy === "seller"
              ? `${n.sellerName} is reviewing your offer`
              : "Deal desk is reviewing your offer"
            : n.fundedBy === "seller"
              ? `${n.sellerName}'s offer`
              : "The seller agent's offer"}
        </p>
        <p className="font-receipt text-[clamp(3.5rem,13vw,7.5rem)] font-semibold leading-none tabular-nums tracking-tight">
          {inr(waiting && n.approvalPrice ? n.approvalPrice : n.currentOffer)}
        </p>
        <h1 className="mt-6 max-w-xl text-xl font-semibold leading-snug sm:text-2xl">{deal.product.title}</h1>
        <p className="mt-1 text-muted">
          {deal.shop ? `List price: ${inr(n.benchmark)} at ${deal.shop.storeName}` : `Best price anywhere: ${inr(n.benchmark)} at ${deal.bestSeller}`}
        </p>
        {!waiting && offMarket > 0 && (
          <p className="mt-3 max-w-xl">
            You&apos;ve already got <span className="text-saffron">{inr(offMarket)} off</span> {deal.shop ? "the list price" : "the best market price"}
            {gap > 0 ? (
              <>
                , and you&apos;re just <span className="text-fg">{inr(gap)}</span> away from a deal.
              </>
            ) : (
              "."
            )}
          </p>
        )}
        {deal.product.soldBy && (
          <p className="mt-1 text-muted">
            Sold by {deal.product.soldBy.name} on {deal.product.soldBy.marketplace}
            {deal.product.soldBy.rating ? ` · ★${deal.product.soldBy.rating}` : ""}
            {n.fundedBy === "seller" ? <span className="text-paid"> · negotiating with the seller directly</span> : null}
          </p>
        )}

        <ol className="mt-8 max-w-xl space-y-3" aria-live="polite">
          {n.messages.map((m, i) => (
            <li key={i} className={`flex ${m.from === "shopper" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] whitespace-pre-line rounded-2xl px-4 py-3 ${
                  m.from === "shopper"
                    ? "rounded-br-sm bg-saffron text-paper-ink"
                    : m.from === "desk" || m.from === "seller"
                      ? "rounded-bl-sm border border-paid/50 bg-paid/10"
                      : "rounded-bl-sm bg-panel"
                }`}
              >
                {m.from !== "shopper" && (
                  <p className="mb-1 text-xs text-muted">
                    {m.from === "desk"
                      ? "Deal desk (human)"
                      : m.from === "seller"
                        ? `${n.sellerName ?? "Seller"} (human)`
                        : n.fundedBy === "seller"
                          ? `${n.sellerName}'s agent`
                          : "Seller agent"}
                  </p>
                )}
                {m.text}
              </div>
            </li>
          ))}
          {(busy || waiting) && (
            <li className="flex justify-start">
              <div className="rounded-2xl rounded-bl-sm bg-panel px-4 py-3 text-muted">
                {waiting
                  ? n.callStatus === "calling" || n.callStatus === "in_progress"
                    ? `Our agent is on the phone with ${n.fundedBy === "seller" ? n.sellerName : "the deal desk"} right now…`
                    : n.reviewedByAgent
                      ? `Our deal-desk agent has reviewed your offer. Waiting for ${n.fundedBy === "seller" ? n.sellerName : "a human on our deal desk"} to sign off…`
                      : n.fundedBy === "seller"
                        ? `Waiting for ${n.sellerName} to approve…`
                        : "A teammate on our deal desk is deciding…"
                  : "Seller agent is thinking…"}
              </div>
            </li>
          )}
        </ol>
        <div ref={threadEnd} />

        {!waiting && (
          <div className="mt-8 max-w-xl">
            {windowLeft && secsLeft! < 15 * 60 && (
              <p className="mb-3 text-sm text-muted">
                This offer stays open for <span className="font-receipt text-fg tabular-nums">{windowLeft}</span>. Prices can move after that.
              </p>
            )}
            <button
              onClick={() => send({ accept: true })}
              disabled={busy}
              className="w-full rounded-xl bg-saffron px-6 py-4 text-lg font-semibold text-paper-ink transition-transform active:scale-[0.98] disabled:opacity-50"
            >
              Take it at {inr(n.currentOffer)}
            </button>
            <form
              className="mt-3 flex gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (offerValue > 0) send({ offer: offerValue });
              }}
            >
              <label htmlFor="counter-offer" className="sr-only">
                Your counter-offer in rupees
              </label>
              <div className="flex min-w-0 flex-1 items-center rounded-xl border border-line bg-panel px-4 focus-within:border-saffron">
                <span className="text-muted">₹</span>
                <input
                  id="counter-offer"
                  inputMode="numeric"
                  placeholder={String(lastShopperPrice ?? Math.round(n.currentOffer * 0.97))}
                  value={offer}
                  onChange={(e) => setOffer(e.target.value)}
                  disabled={busy}
                  className="min-w-0 flex-1 bg-transparent px-2 py-3.5 text-lg tabular-nums text-fg placeholder:text-muted/50 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={busy || !offerValue}
                className="rounded-xl border border-line px-5 font-semibold hover:border-saffron disabled:opacity-50"
              >
                Counter
              </button>
            </form>
            {error && (
              <p role="alert" className="mt-3 text-alarm">
                {error}
              </p>
            )}
            <div className="mt-4">
              <SocialProof variant="compact" />
            </div>
          </div>
        )}
      </section>

      <section className="receipt px-6 py-8 text-[13px] leading-relaxed shadow-2xl shadow-black/40">
        <p className="text-center font-semibold tracking-wide">GHOSTCART NEGOTIATION</p>
        <p className="text-center text-paper-muted">#{deal.id}</p>
        <div className="receipt-rule my-4" />
        <div className="flex justify-between">
          <span>{deal.product.seller} list price</span>
          <s>{inr(deal.originalPrice)}</s>
        </div>
        {!deal.shop && (
          <>
            {deal.alternatives.map((q) => (
              <div key={q.url} className="flex justify-between text-paper-muted">
                <span>{q.seller}</span>
                <span>{inr(q.price)}</span>
              </div>
            ))}
            <div className="flex justify-between">
              <span>Best price anywhere</span>
              <span>{inr(n.benchmark)}</span>
            </div>
            <p className="mt-1 text-paper-muted">Found on {deal.alternatives.length + 1} of the 8 stores we checked, live when you pasted the link.</p>
          </>
        )}
        {deal.shop && <p className="mt-1 text-paper-muted">You&apos;re haggling with {deal.shop.storeName}&apos;s own agent. The seller ships your order.</p>}
        <div className="receipt-rule my-4" />
        <div className="flex items-baseline justify-between">
          <span>{waiting ? "Your offer" : "On the table"}</span>
          <span className="text-3xl font-semibold">{inr(waiting && n.approvalPrice ? n.approvalPrice : n.currentOffer)}</span>
        </div>
        <p className="mt-1 text-right text-paper-muted">
          {inr(n.benchmark - (waiting && n.approvalPrice ? n.approvalPrice : n.currentOffer))} under {deal.shop ? "the list price" : "the best market price"}
        </p>
        <div className="receipt-rule my-4" />
        <p className="text-center text-paper-muted">
          {n.fundedBy === "seller" ? `${n.sellerName} funds this discount from their own margin.` : "GhostCart pays the difference from its own commission."} Once you agree, you get 180 seconds to lock the price with a{" "}
          {inr(deal.lockFee)} UPI payment.
        </p>
      </section>
    </div>
  );
}
