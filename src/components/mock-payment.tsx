"use client";

import { useEffect, useState } from "react";
import { inr } from "@/lib/format";
import type { MockOrder } from "@/lib/pinelabs-mock";

/** Phone-side test checkout for the Pine Labs mock gateway. No real money moves. */
export function MockPayment({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<MockOrder | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/mock-pinelabs-pay?order=${encodeURIComponent(orderId)}`, { cache: "no-store" })
      .then(async (r) => (r.ok ? setOrder(await r.json()) : setError("This payment link isn't valid.")))
      .catch(() => setError("Couldn't load this payment."));
  }, [orderId]);

  async function act(action: "pay" | "decline") {
    setBusy(true);
    const res = await fetch("/api/mock-pinelabs-pay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: orderId, action }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error || "Payment failed. Try again.");
    setOrder(body);
  }

  if (error) return <p role="alert" className="mt-20 text-alarm">{error}</p>;
  if (!order) return <p className="mt-20 text-muted">Loading payment…</p>;

  const amount = order.order_amount.value / 100;

  return (
    <div className="w-full max-w-sm">
      <p className="rounded-lg border border-saffron/50 bg-saffron/10 px-4 py-2 text-center text-sm text-saffron">
        Test mode: simulated UPI payment. No money moves.
      </p>
      <section className="receipt mt-6 px-6 py-8 text-[13px] leading-relaxed">
        <p className="text-center font-semibold tracking-wide">UPI PAYMENT</p>
        <p className="text-center text-paper-muted">to GhostCart</p>
        <div className="receipt-rule my-4" />
        <div className="flex items-baseline justify-between">
          <span>Amount</span>
          <span className="text-3xl font-semibold">{inr(amount)}</span>
        </div>
        <div className="flex justify-between text-paper-muted">
          <span>For</span>
          <span className="max-w-[60%] truncate text-right">{order.notes ?? "Deal lock"}</span>
        </div>
        <div className="flex justify-between text-paper-muted">
          <span>Order</span>
          <span>{order.order_id.slice(-10)}</span>
        </div>
        <div className="receipt-rule my-4" />

        {order.status === "PENDING" && (
          <div className="flex flex-col gap-3 font-sans">
            <button
              onClick={() => act("pay")}
              disabled={busy}
              className="rounded-lg bg-paper-ink py-3.5 text-base font-semibold text-paper disabled:opacity-50"
            >
              {busy ? "Paying…" : `Pay ${inr(amount)}`}
            </button>
            <button onClick={() => act("decline")} disabled={busy} className="py-2 text-paper-muted underline underline-offset-4 disabled:opacity-50">
              Decline
            </button>
          </div>
        )}
        {order.status === "PROCESSED" && (
          <p className="text-center font-sans text-base font-semibold">Paid {inr(amount)}. Head back to GhostCart, your deal is locked.</p>
        )}
        {order.status === "FAILED" && <p className="text-center font-sans">Payment declined. Your deal is still open on GhostCart until the timer runs out.</p>}
        {order.status === "CREATED" && <p className="text-center font-sans text-paper-muted">Waiting for the payment request…</p>}
      </section>
      <p className="mt-4 text-center text-xs text-muted">Simulates Pine Labs Online UPI (UAT) for today&apos;s demo.</p>
    </div>
  );
}
