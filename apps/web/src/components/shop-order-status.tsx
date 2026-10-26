"use client";

import { useCallback, useEffect, useState } from "react";

interface BuyerOrder {
  status: string;
  shipBy: string;
  deliveredAt: string | null;
  problemWindowEndsAt?: string;
  canReportProblem: boolean;
  shipment?: { courier: string; awb: string; lastStatus: string; events: { at: string; status: string }[]; handoverCode: string };
  dispute?: { reason: string; status: string; resolution: string | null };
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/** For GhostCart Shop orders: what the seller has done, the handover code, and the buyer's options. */
export function ShopOrderStatus({ dealId, storeName, returnUrl }: { dealId: string; storeName: string; returnUrl?: string }) {
  const [order, setOrder] = useState<BuyerOrder | null>(null);
  const [problem, setProblem] = useState({ open: false, reason: "not_received", details: "" });
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/orders/${dealId}`, { cache: "no-store" });
    if (res.ok) setOrder(await res.json());
  }, [dealId]);
  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(load, 15000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  async function act(body: Record<string, string>) {
    setError("");
    const res = await fetch(`/api/orders/${dealId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Something went wrong.");
    else setProblem({ ...problem, open: false });
    load();
  }

  if (!order) return null;
  return (
    <div className="mt-6 max-w-xl space-y-3 font-sans">
      {order.status === "placed" && <p>{storeName} is packing your order. It ships by {day(order.shipBy)}, or you get a full refund automatically.</p>}
      {order.shipment && order.status === "shipped" && (
        <>
          <p>
            On its way with {order.shipment.courier} (AWB <span className="font-receipt">{order.shipment.awb}</span>).
          </p>
          <p className="rounded-xl border border-saffron/60 px-4 py-3">
            When it arrives, give the delivery person this code: <span className="font-receipt text-2xl tracking-[0.3em]">{order.shipment.handoverCode}</span>
          </p>
          <button onClick={() => act({ action: "received" })} className="rounded-xl border border-line px-4 py-2.5 hover:border-paid">
            I&apos;ve received it
          </button>
        </>
      )}
      {order.status === "delivered" && (
        <p>
          Delivered{order.deliveredAt ? ` on ${day(order.deliveredAt)}` : ""}. Something wrong? You can report it
          {order.problemWindowEndsAt ? ` until ${day(order.problemWindowEndsAt)}` : ""}; {storeName} isn&apos;t paid until then.
        </p>
      )}
      {order.dispute && (
        <p className="text-muted">
          {order.dispute.status === "open"
            ? "You reported a problem. GhostCart is reviewing it with the seller, and the payment is on hold meanwhile."
            : `Your report was resolved: ${order.dispute.status.replace(/_/g, " ")}. ${order.dispute.resolution ?? ""}`}
        </p>
      )}
      {order.status === "refunded" && <p>Refunded to your UPI account.</p>}
      {order.status === "cancelled" && <p>{storeName} didn&apos;t ship in time, so the order was cancelled and you were refunded in full.</p>}

      {order.canReportProblem && !order.dispute && !problem.open && (
        <button onClick={() => setProblem({ ...problem, open: true })} className="text-muted underline underline-offset-4 hover:text-fg">
          Report a problem
        </button>
      )}
      {problem.open && (
        <form
          className="grid gap-3 rounded-xl border border-line p-4"
          onSubmit={(e) => {
            e.preventDefault();
            act({ action: "problem", reason: problem.reason, details: problem.details });
          }}
        >
          <label className="grid gap-1">
            <span className="text-muted">What went wrong?</span>
            <select value={problem.reason} onChange={(e) => setProblem({ ...problem, reason: e.target.value })} className="rounded-lg border border-line bg-panel px-3 py-2">
              <option value="not_received">It never arrived</option>
              <option value="damaged">It arrived damaged</option>
              <option value="not_as_described">It isn&apos;t what was described</option>
              <option value="other">Something else</option>
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-muted">Tell us what happened</span>
            <textarea required rows={3} value={problem.details} onChange={(e) => setProblem({ ...problem, details: e.target.value })} className="rounded-lg border border-line bg-panel px-3 py-2" />
          </label>
          <button className="w-fit rounded-xl bg-saffron px-4 py-2.5 font-semibold text-paper-ink">Send report</button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-alarm">
          {error}
        </p>
      )}
      {returnUrl && (
        <a href={returnUrl} className="inline-block text-muted underline underline-offset-4 hover:text-fg">
          Back to {new URL(returnUrl).hostname}
        </a>
      )}
    </div>
  );
}
