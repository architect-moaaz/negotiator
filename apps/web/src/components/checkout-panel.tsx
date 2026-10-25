"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { inr } from "@/lib/format";
import { FULFILMENT_STAGES } from "@/lib/fulfilment";
import type { FulfilmentStage, PublicCheckout, PublicDeal } from "@/lib/types";

const FIELDS = [
  { name: "name", label: "Full name", autoComplete: "name", span: 2 },
  {
    name: "phone",
    label: "Mobile number",
    autoComplete: "tel-national",
    inputMode: "tel",
    span: 2,
  },
  {
    name: "line1",
    label: "Flat, house no., building, street",
    autoComplete: "address-line1",
    span: 2,
  },
  {
    name: "line2",
    label: "Area, locality (optional)",
    autoComplete: "address-line2",
    span: 2,
    optional: true,
  },
  {
    name: "landmark",
    label: "Landmark (optional)",
    autoComplete: "off",
    span: 2,
    optional: true,
  },
  {
    name: "pincode",
    label: "Pincode",
    autoComplete: "postal-code",
    inputMode: "numeric",
    span: 1,
  },
  { name: "city", label: "City", autoComplete: "address-level2", span: 1 },
  { name: "state", label: "State", autoComplete: "address-level1", span: 2 },
] as const;

// Big status word on the left once the order is placed.
const HEADLINE: Record<FulfilmentStage, string> = {
  placed: "Ordered",
  confirmed: "Confirmed",
  shipped: "Shipped",
  out_for_delivery: "On its way",
  delivered: "Delivered",
};

type Step = "address" | "pay" | "ordered" | "lapsed";

function stepOf(c: PublicCheckout, lapsed: boolean): Step {
  if (c.status === "ordered") return "ordered";
  if (lapsed || c.status === "lapsed") return "lapsed";
  return c.deliverTo ? "pay" : "address";
}

const dayFmt = new Intl.DateTimeFormat("en-IN", {
  weekday: "long",
  day: "numeric",
  month: "short",
});
const timeFmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

/** Order tracking: every delivery stage, with the time and note for the ones reached so far. */
function Tracking({ c }: { c: PublicCheckout }) {
  const reached = new Map((c.tracking ?? []).map((t) => [t.stage, t]));
  const current = c.tracking?.at(-1)?.stage;
  return (
    <section className="mt-10 max-w-xl" aria-label="Order tracking">
      <h2 className="text-lg font-semibold">Track your order</h2>
      <ol className="mt-4">
        {FULFILMENT_STAGES.map(({ stage, label }, i) => {
          const t = reached.get(stage);
          const last = i === FULFILMENT_STAGES.length - 1;
          return (
            <li
              key={stage}
              className="relative flex gap-4 pb-6 last:pb-0"
              aria-current={stage === current ? "step" : undefined}
            >
              {!last && (
                <span
                  className={`absolute left-[11px] top-6 h-full w-0.5 ${reached.has(FULFILMENT_STAGES[i + 1].stage) ? "bg-paid" : "bg-line"}`}
                  aria-hidden
                />
              )}
              <span
                className={`relative grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                  t
                    ? "bg-paid text-ink"
                    : "border border-line bg-ink text-muted"
                } ${stage === current && stage !== "delivered" ? "ring-4 ring-paid/25" : ""}`}
                aria-hidden
              >
                {t ? "✓" : ""}
              </span>
              <div className="-mt-0.5">
                <p className={t ? "text-fg" : "text-muted"}>{label}</p>
                {t && (
                  <p className="text-sm text-muted">
                    {timeFmt.format(t.at)}
                    {t.note ? ` · ${t.note}` : ""}
                  </p>
                )}
                {!t && stage === "delivered" && c.deliveryBy && (
                  <p className="text-sm text-muted">
                    Expected by {dayFmt.format(c.deliveryBy)}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** After the lock fee: 30 minutes to add a delivery address and pay the balance, then the order is placed. */
const CONFETTI = Array.from({ length: 48 }, (_, i) => i);
const CONFETTI_COLORS = ["#f4b740", "#4fd1a5", "#ff5a5f", "#edeaf5", "#9b8cff"];

/** "Yay, order placed!" toast with a burst of confetti (skipped for people who prefer reduced motion). */
function OrderPlacedParty() {
  return (
    <>
      <div
        className="pointer-events-none fixed inset-0 z-40 overflow-hidden motion-reduce:hidden"
        aria-hidden
      >
        {CONFETTI.map((i) => (
          <span
            key={i}
            className="animate-confetti absolute -top-[5%] rounded-sm"
            style={{
              left: `${(i * 37) % 100}%`,
              width: i % 3 ? 8 : 12,
              height: i % 3 ? 14 : 8,
              background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
              animationDelay: `${(i % 12) * 80}ms`,
              animationDuration: `${2.2 + (i % 5) * 0.4}s`,
            }}
          />
        ))}
      </div>
      <p
        role="status"
        className="animate-pop-in fixed inset-x-0 top-6 z-50 mx-auto w-fit rounded-full bg-paid px-6 py-3 text-lg font-semibold text-ink shadow-2xl shadow-black/40"
      >
        🎉 Yay! Your order is placed
      </p>
    </>
  );
}

export function CheckoutPanel({
  deal,
  now,
  onUpdate,
}: {
  deal: PublicDeal;
  now: number;
  onUpdate: (d: PublicDeal) => void;
}) {
  const c = deal.checkout!;
  const remaining = Math.max(0, c.dueAt - now);
  const step = stepOf(
    c,
    c.status === "awaiting" && remaining === 0 && !c.deliverTo,
  );
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [prefillName, setPrefillName] = useState("");
  // Celebrate only when the order is placed while this page is open, not on every later visit.
  const [prevStep, setPrevStep] = useState(step);
  const [celebrate, setCelebrate] = useState(false);
  if (step !== prevStep) {
    setPrevStep(step);
    if (step === "ordered") setCelebrate(true);
  }
  useEffect(() => {
    if (!celebrate) return;
    const t = setTimeout(() => setCelebrate(false), 5000);
    return () => clearTimeout(t);
  }, [celebrate]);

  useEffect(() => {
    fetch("/api/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((u: { name?: string } | null) => u?.name && setPrefillName(u.name))
      .catch(() => {});
  }, []);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    const res = await fetch("/api/deal/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: deal.id, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok)
      return (
        setError(data.error || "Something went wrong. Try again."),
        false
      );
    onUpdate(data);
    return true;
  }

  async function submitAddress(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const address = Object.fromEntries(new FormData(e.currentTarget));
    if (await post({ action: "address", address })) setEditing(false);
  }

  const secs = Math.ceil(remaining / 1000);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const urgent = step !== "ordered" && step !== "lapsed" && secs <= 120;
  const showForm = (step === "address" || editing) && remaining > 0;

  return (
    <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
      {celebrate && <OrderPlacedParty />}
      <section>
        <p className="text-muted">
          {step === "ordered"
            ? `Order ${c.orderRef}`
            : step === "lapsed"
              ? "Price lock released"
              : "Price locked. Finish your order in"}
        </p>
        <p
          className={`font-receipt text-[clamp(4rem,15vw,9rem)] font-semibold leading-none tabular-nums tracking-tight ${
            step === "ordered"
              ? "text-paid"
              : step === "lapsed"
                ? "text-muted/50"
                : urgent
                  ? "text-alarm"
                  : "text-fg"
          }`}
          aria-live="off"
        >
          {step === "ordered"
            ? HEADLINE[c.tracking?.at(-1)?.stage ?? "placed"]
            : step === "lapsed"
              ? "0:00"
              : clock}
        </p>
        {(step === "address" || step === "pay") && (
          <div
            className="mt-4 h-1.5 w-full max-w-lg overflow-hidden rounded-full bg-line"
            aria-hidden
          >
            <div
              className={`h-full ${urgent ? "bg-alarm" : "bg-saffron"}`}
              style={{
                width: `${(remaining / (c.dueAt - c.openedAt)) * 100}%`,
                transition: "width 250ms linear",
              }}
            />
          </div>
        )}

        <h1 className="mt-8 max-w-xl text-2xl font-semibold leading-snug sm:text-3xl">
          {deal.product.title}
        </h1>

        {step !== "ordered" && (
          <ol className="mt-8 flex max-w-xl flex-wrap gap-x-6 gap-y-2 text-sm">
            {(
              [
                ["Price locked", true],
                ["Delivery address", !!c.deliverTo],
                [`Pay ${inr(c.amount)}`, false],
                ["Order placed", false],
              ] as const
            ).map(([label, done], i) => (
              <li
                key={label}
                className={`flex items-center gap-2 ${done ? "text-fg" : "text-muted"}`}
              >
                <span
                  className={`grid size-6 place-items-center rounded-full text-xs font-semibold ${done ? "bg-paid text-ink" : "border border-line"}`}
                  aria-hidden
                >
                  {done ? "✓" : i + 1}
                </span>
                {label}
                <span className="sr-only">{done ? "(done)" : "(to do)"}</span>
              </li>
            ))}
          </ol>
        )}

        {showForm && (
          <form
            onSubmit={submitAddress}
            className="mt-8 grid max-w-xl grid-cols-2 gap-3"
          >
            <p className="col-span-2 text-lg font-semibold">
              Where should we deliver it?
            </p>
            {FIELDS.map((f) => (
              <label
                key={f.name}
                className={
                  f.span === 2 ? "col-span-2" : "col-span-2 sm:col-span-1"
                }
              >
                <span className="mb-1 block text-sm text-muted">{f.label}</span>
                <input
                  name={f.name}
                  required={!("optional" in f)}
                  autoComplete={f.autoComplete}
                  inputMode={"inputMode" in f ? f.inputMode : undefined}
                  defaultValue={f.name === "name" ? prefillName : undefined}
                  key={f.name === "name" ? prefillName : f.name}
                  className="w-full rounded-lg border border-line bg-panel px-3 py-2.5 text-fg outline-none focus:border-saffron"
                />
              </label>
            ))}
            {error && (
              <p role="alert" className="col-span-2 text-alarm">
                {error}
              </p>
            )}
            <div className="col-span-2 mt-2 flex items-center gap-4">
              <button
                type="submit"
                disabled={busy}
                className="rounded-xl bg-saffron px-6 py-3 font-semibold text-paper-ink disabled:opacity-50"
              >
                {busy
                  ? "Saving…"
                  : c.amount
                    ? `Continue to pay ${inr(c.amount)}`
                    : "Place order"}
              </button>
              {editing && (
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="text-muted underline underline-offset-4"
                >
                  Cancel
                </button>
              )}
            </div>
            <p className="col-span-2 text-sm text-muted">
              We only share this address with the seller and the courier for
              this order.
            </p>
          </form>
        )}

        {step === "pay" && !editing && (
          <div className="mt-8 max-w-xl">
            <p className="text-lg">
              Delivering to{" "}
              <span className="font-semibold">{c.deliverTo!.name}</span>,{" "}
              {c.deliverTo!.area}.{" "}
              <button
                onClick={() => setEditing(true)}
                className="text-saffron underline underline-offset-4"
              >
                Change
              </button>
            </p>
            <p className="mt-2 text-muted">
              Pay the {inr(c.amount)} balance by UPI before the timer runs out
              and we place the order.
            </p>
          </div>
        )}

        {step === "ordered" && (
          <div className="mt-8 max-w-xl space-y-2 text-lg">
            <p>
              Paid in full. Your {deal.bestSeller} order is going to{" "}
              {c.deliverTo?.name}, {c.deliverTo?.area}.
            </p>
            {c.deliveryBy && (
              <p className="text-muted">
                Estimated delivery by{" "}
                <span className="text-fg">{dayFmt.format(c.deliveryBy)}</span>.
                This page updates as your order moves.
              </p>
            )}
            <p className="text-muted">
              You saved <span className="text-saffron">{inr(deal.saved)}</span>.
            </p>
          </div>
        )}
        {step === "ordered" && <Tracking c={c} />}

        {step === "lapsed" && (
          <div className="mt-8">
            <p className="max-w-lg text-muted">
              The 30 minutes ran out before{" "}
              {c.deliverTo
                ? "the balance was paid"
                : "we had a delivery address"}
              , so the price lock was released. Run it again and the agent will
              renegotiate from today&apos;s prices.
            </p>
            <Link
              href="/"
              className="mt-5 inline-block rounded-xl bg-saffron px-6 py-3 font-semibold text-paper-ink"
            >
              Renegotiate
            </Link>
          </div>
        )}
      </section>

      <section className="receipt relative px-6 py-8 text-[13px] leading-relaxed shadow-2xl shadow-black/40">
        <p className="text-center font-semibold tracking-wide">
          GHOSTCART ORDER
        </p>
        <p className="text-center text-paper-muted">#{c.orderRef ?? deal.id}</p>
        <div className="receipt-rule my-4" />
        <div className="flex justify-between">
          <span>List price</span>
          <s>{inr(deal.originalPrice)}</s>
        </div>
        <div className="flex justify-between">
          <span>Deal price</span>
          <span>{inr(deal.dealPrice)}</span>
        </div>
        <div className="flex justify-between">
          <span>Lock fee paid</span>
          <span>−{inr(deal.lockFee)}</span>
        </div>
        <div className="flex justify-between">
          <span>{deal.perk}</span>
          <span>₹0</span>
        </div>
        <div className="receipt-rule my-4" />
        <div className="flex items-baseline justify-between">
          <span>{step === "ordered" ? "Paid" : "Balance due"}</span>
          <span className="text-3xl font-semibold">{inr(c.amount)}</span>
        </div>
        <div className="receipt-rule my-4" />

        {step === "address" && (
          <p className="text-center text-paper-muted">
            Add a delivery address to get the payment QR.
          </p>
        )}

        {step === "pay" && (
          <div className="flex flex-col items-center gap-3">
            <p className="text-center">
              Pay <strong>{inr(c.amount)}</strong> by UPI to place the order
            </p>
            {c.qrDataUrl && (
              <Image
                src={c.qrDataUrl}
                alt="UPI QR code for the order balance"
                width={200}
                height={200}
                unoptimized
              />
            )}
            {c.upiIntent && (
              <a
                href={c.upiIntent}
                className="w-full rounded-lg bg-paper-ink py-3 text-center font-sans font-semibold text-paper sm:hidden"
              >
                Pay {inr(c.amount)} now
              </a>
            )}
            {deal.simulate && (
              <button
                onClick={() => post({ action: "simulate" })}
                disabled={busy}
                className="w-full rounded-lg border-2 border-paper-ink py-2.5 font-sans font-semibold disabled:opacity-50"
              >
                {busy ? "Placing order…" : "Simulate UPI payment"}
              </button>
            )}
            {error && !editing && (
              <p role="alert" className="text-center font-sans text-alarm">
                {error}
              </p>
            )}
            {c.qrDataUrl && (
              <p className="text-center text-paper-muted">
                Scan with your phone camera to pay · Pine Labs
              </p>
            )}
          </div>
        )}

        {step === "ordered" && c.deliverTo && (
          <div className="space-y-1">
            <div className="flex justify-between">
              <span>Ship to</span>
              <span className="text-right">
                {c.deliverTo.name}, {c.deliverTo.area}
              </span>
            </div>
            {c.awb && (
              <div className="flex justify-between">
                <span>{c.courier ?? "Courier"}</span>
                <span>AWB {c.awb}</span>
              </div>
            )}
            {c.deliveryBy && (
              <div className="flex justify-between">
                <span>Est. delivery</span>
                <span>{dayFmt.format(c.deliveryBy)}</span>
              </div>
            )}
          </div>
        )}

        {step === "ordered" && (
          <p className="pointer-events-none absolute inset-x-0 top-1/2 mx-auto w-fit -translate-y-1/2 -rotate-12 rounded-md border-4 border-paid px-4 py-1 text-4xl font-semibold text-paid opacity-90">
            ORDERED
          </p>
        )}
        {step === "lapsed" && (
          <p className="text-center text-paper-muted">
            This order window has closed.
          </p>
        )}
      </section>
    </div>
  );
}
