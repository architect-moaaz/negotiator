"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { inr } from "@/lib/format";
import type { PublicDeal } from "@/lib/types";
import { CheckoutPanel } from "./checkout-panel";
import { HaggleRoom } from "./haggle-room";
import { SocialProof } from "./social-proof";
import { shortTitle } from "@/lib/format";
import { GrantPanel } from "./grant-panel";

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function DealTerminal({ id }: { id: string }) {
  const [deal, setDeal] = useState<PublicDeal | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/deal?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    if (res.status === 404) return setMissing(true);
    if (res.ok) setDeal(await res.json());
  }, [id]);

  const pending = deal?.status === "pending";
  const checkingOut = deal?.status === "paid" && deal.checkout?.status === "awaiting";
  const granted = deal?.status === "granted";
  const now = useNow(pending || checkingOut || granted);
  const remaining = deal ? Math.max(0, deal.expiresAt - now) : 0;
  const expired = deal?.status === "expired" || (pending && remaining === 0);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  // Poll for the deal desk's decision, for payment while an invoice is live (plus a short grace window),
  // and slowly for delivery updates once the order is placed.
  const status = deal?.status;
  const expiresAt = deal?.expiresAt ?? 0;
  const checkout = deal?.checkout?.status;
  const checkoutDue = deal?.checkout?.dueAt ?? 0;
  const delivered = deal?.checkout?.tracking?.at(-1)?.stage === "delivered";
  useEffect(() => {
    const every =
      status === "awaiting_approval"
        ? 2000
        : status === "pending" && Date.now() < expiresAt + 30_000
          ? 3000
          : checkout === "awaiting" && Date.now() < checkoutDue + 30_000
            ? 3000
            : checkout === "ordered" && !delivered
              ? 8000
              : status === "granted" && Date.now() < expiresAt + 30_000
                ? 10000 // to show when the store reports the order
                : 0;
    if (!every) return;
    const t = setInterval(load, every);
    return () => clearInterval(t);
  }, [status, expiresAt, checkout, checkoutDue, delivered, load]);

  if (missing) {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="text-3xl font-bold">This deal doesn&apos;t exist</h1>
        <p className="mt-3 text-muted">Deals disappear an hour after they&apos;re made.</p>
        <Link href="/" className="mt-8 inline-block rounded-xl bg-saffron px-6 py-3 font-semibold text-paper-ink">
          Negotiate a new deal
        </Link>
      </div>
    );
  }
  if (!deal) return <p className="text-center text-muted">Loading your deal…</p>;
  if (deal.status === "negotiating" || deal.status === "awaiting_approval") return <HaggleRoom deal={deal} onUpdate={setDeal} />;
  if (deal.status === "paid" && deal.checkout) return <CheckoutPanel deal={deal} now={now} onUpdate={setDeal} />;
  if ((deal.status === "granted" || deal.grant?.redeemedAt) && deal.grant) return <GrantPanel deal={deal} now={now} />;

  const total = deal.expiresAt - deal.createdAt;
  const secs = Math.ceil(remaining / 1000);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const urgent = pending && !expired && secs <= 30;
  const paid = deal.status === "paid";

  return (
    <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
      <section>
        <p className="text-muted">
          {paid ? "Deal locked" : expired ? "Deal expired" : "Your deal holds for"}
        </p>
        <p
          className={`font-receipt text-[clamp(5rem,18vw,11rem)] font-semibold leading-none tabular-nums tracking-tight ${
            paid ? "text-paid" : expired ? "text-muted/50" : urgent ? "text-alarm" : "text-fg"
          }`}
          aria-live="off"
        >
          {paid ? "Paid" : expired ? "0:00" : clock}
        </p>
        {pending && !expired && (
          <div className="mt-4 h-1.5 w-full max-w-lg overflow-hidden rounded-full bg-line" aria-hidden>
            <div
              className={`h-full ${urgent ? "bg-alarm" : "bg-saffron"}`}
              style={{ width: `${(remaining / total) * 100}%`, transition: "width 250ms linear" }}
            />
          </div>
        )}

        {pending && !expired && deal.saved > 0 && (
          <p className={`mt-4 max-w-lg text-lg ${urgent ? "text-alarm" : ""}`}>
            Lock it now or lose your <span className="text-saffron">{inr(deal.saved)}</span> saving. Takes 10 seconds by UPI.
          </p>
        )}
        <h1 className="mt-10 max-w-xl text-2xl font-semibold leading-snug sm:text-3xl">{deal.product.title}</h1>
        <p className="mt-2 text-muted">
          {deal.shop && deal.negotiation
            ? `List price ${inr(deal.negotiation.benchmark)} at ${deal.shop.storeName}`
            : deal.negotiation
              ? `Best price anywhere ${inr(deal.negotiation.benchmark)} at ${deal.bestSeller}`
              : `Best price at ${deal.bestSeller}`}{" "}
          · {deal.perk}
        </p>

        {paid && (
          <div className="mt-8 max-w-lg">
            <p className="text-lg">
              You saved <span className="text-saffron">{inr(deal.saved)}</span>. Your deal is on the live board.
            </p>
            <p className="mt-6 text-muted">Know someone buying something today? Pass it on. They get the same AI haggler on their side.</p>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(
                `I just haggled ${inr(deal.saved)} off ${shortTitle(deal.product.title, 4)} with an AI on GhostCart. Paste anything you're buying: ${typeof window !== "undefined" ? window.location.origin : ""}`,
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block rounded-xl bg-saffron px-6 py-3 font-semibold text-paper-ink"
            >
              Share on WhatsApp
            </a>
          </div>
        )}
        {expired && !paid && (
          <div className="mt-8">
            <p className="max-w-lg text-muted">The 180 seconds ran out. Run it again and the agent will renegotiate from today&apos;s prices.</p>
            <Link href="/" className="mt-5 inline-block rounded-xl bg-saffron px-6 py-3 font-semibold text-paper-ink">
              Renegotiate
            </Link>
          </div>
        )}

        {deal.negotiation && (
          <details className="mt-10 max-w-xl text-muted">
            <summary className="cursor-pointer text-fg">How you got this price</summary>
            <div className="mt-3 space-y-2 text-sm">
              {deal.negotiation.messages.map((m, i) => (
                <p key={i} className="whitespace-pre-line">
                  <span className="text-fg">
                    {m.from === "shopper" ? "You" : m.from === "desk" ? "Deal desk" : m.from === "seller" ? (deal.negotiation?.sellerName ?? "Seller") : "Agent"}:
                  </span> {m.text}
                </p>
              ))}
            </div>
          </details>
        )}
      </section>

      <section className="receipt relative px-6 py-8 text-[13px] leading-relaxed shadow-2xl shadow-black/40">
        <p className="text-center font-semibold tracking-wide">GHOSTCART FLASH INVOICE</p>
        <p className="text-center text-paper-muted">#{deal.id}</p>
        <div className="receipt-rule my-4" />
        <div className="flex justify-between">
          <span>List price</span>
          <s>{inr(deal.originalPrice)}</s>
        </div>
        <div className="flex justify-between">
          <span>You save</span>
          <span>−{inr(deal.saved)}</span>
        </div>
        <div className="flex justify-between">
          <span>{deal.perk}</span>
          <span>₹0</span>
        </div>
        <div className="receipt-rule my-4" />
        <div className="flex items-baseline justify-between">
          <span>Deal price</span>
          <span className="text-3xl font-semibold">{inr(deal.dealPrice)}</span>
        </div>
        <div className="receipt-rule my-4" />

        {pending && !expired && (
          <div className="flex flex-col items-center gap-3">
            <p className="text-center">
              Pay <strong>{inr(deal.lockFee)}</strong> by UPI to lock this price
            </p>
            {deal.qrDataUrl && (
              <Image src={deal.qrDataUrl} alt="UPI QR code for the deal lock fee" width={200} height={200} unoptimized />
            )}
            {deal.upiIntent && (
              <a href={deal.upiIntent} className="w-full rounded-lg bg-paper-ink py-3 text-center font-sans font-semibold text-paper sm:hidden">
                Pay {inr(deal.lockFee)} now
              </a>
            )}
            {deal.qrDataUrl && <p className="text-center text-paper-muted">Scan with your phone camera to pay · Pine Labs</p>}
            {deal.testPayments && <p className="text-center font-sans font-semibold">Test mode: no money moves.</p>}
            <div className="font-sans text-center [&_p]:text-paper-muted">
              <SocialProof variant="compact" />
            </div>
          </div>
        )}

        {paid && (
          <p className="pointer-events-none absolute inset-x-0 top-1/2 mx-auto w-fit -translate-y-1/2 -rotate-12 rounded-md border-4 border-paid px-4 py-1 text-4xl font-semibold text-paid opacity-90">
            LOCKED
          </p>
        )}
        {expired && !paid && <p className="text-center text-paper-muted">This invoice has expired.</p>}
      </section>
    </div>
  );
}
