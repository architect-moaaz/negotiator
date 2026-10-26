"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ErrorText, field, secondary } from "./ui";

interface OrderRow {
  id: string;
  title: string;
  total: number;
  sellerShare: number;
  status: string;
  testPayments: boolean;
  shipBy: string;
  createdAt: string;
  deliveredAt: string | null;
  address?: Record<string, string>;
  shipment?: { courier: string; awb: string; lastStatus: string; trackingProvider: string };
  dispute?: { reason: string; details: string; sellerResponse: string | null };
}

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const hoursLeft = (iso: string) => Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000);
const LABEL: Record<string, string> = {
  placed: "To ship",
  shipped: "In transit",
  delivered: "Delivered, payout on hold",
  disputed: "Buyer reported a problem",
  completed: "Paid out",
  refunded: "Refunded",
  cancelled: "Cancelled",
};

export function OrdersTab({ storeId, canAct }: { storeId: string; canAct: boolean }) {
  const [data, setData] = useState<{ held: number; released: number; orders: OrderRow[] } | null>(null);
  const [form, setForm] = useState<Record<string, { courier?: string; awb?: string; code?: string; response?: string }>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [invoices, setInvoices] = useState<{ number: string; period: string; total: number }[]>([]);

  const load = useCallback(async () => {
    const r = await api<{ held: number; released: number; orders: OrderRow[] }>(`/api/seller/stores/${storeId}/orders`);
    if (r.ok) setData(r.data);
    if (canAct) {
      const inv = await api<{ number: string; period: string; total: number }[]>(`/api/seller/stores/${storeId}/invoices`);
      if (inv.ok) setInvoices(inv.data);
    }
  }, [storeId, canAct]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function act(o: OrderRow, body: Record<string, string | undefined>) {
    setErrors((e) => ({ ...e, [o.id]: "" }));
    const r = await api(`/api/seller/stores/${storeId}/orders/${o.id}`, { body });
    if (!r.ok) setErrors((e) => ({ ...e, [o.id]: r.error }));
    load();
  }
  const set = (id: string, k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [id]: { ...form[id], [k]: e.target.value } });

  if (!data) return <p className="mt-6 text-muted">Loading…</p>;
  return (
    <section className="mt-6 max-w-4xl">
      <div className="grid grid-cols-2 gap-4 sm:max-w-md">
        <div className="rounded-xl border border-line p-4">
          <p className="text-sm text-muted">On hold until delivery</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{rupees(data.held)}</p>
        </div>
        <div className="rounded-xl border border-line p-4">
          <p className="text-sm text-muted">Released to you</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{rupees(data.released)}</p>
        </div>
      </div>
      <p className="mt-3 text-sm text-muted">Each payout releases a few days after delivery, once the buyer&apos;s window to report a problem closes.</p>
      {invoices.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-muted hover:text-fg">GhostCart fee invoices ({invoices.length})</summary>
          <ul className="mt-2 space-y-1">
            {invoices.map((i) => (
              <li key={i.number}>
                <a href={`/seller/invoices/${encodeURIComponent(i.number)}`} className="underline underline-offset-4 hover:text-saffron">
                  {i.number}
                </a>{" "}
                <span className="text-muted">
                  · {i.period} · {rupees(i.total)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {data.orders.length === 0 && <p className="mt-8 text-muted">No orders yet.</p>}
      <div className="mt-8 space-y-4">
        {data.orders.map((o) => (
          <article key={o.id} className={`rounded-2xl border p-5 ${o.status === "placed" || o.status === "disputed" ? "border-saffron/60" : "border-line"}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-lg font-semibold">{o.title}</p>
              <p className="text-sm">
                {LABEL[o.status] ?? o.status}
                {o.testPayments && <span className="ml-2 text-muted">(test order)</span>}
              </p>
            </div>
            <p className="text-muted">
              Buyer paid {rupees(o.total)} · your share {rupees(o.sellerShare)} · {o.id}
            </p>

            {o.status === "placed" && (
              <>
                {o.address && (
                  <p className="mt-3 whitespace-pre-line">
                    {o.address.name}, {o.address.phone}
                    {"\n"}
                    {o.address.line1}
                    {o.address.line2 ? `, ${o.address.line2}` : ""}
                    {"\n"}
                    {o.address.city}, {o.address.state} {o.address.pincode}
                  </p>
                )}
                <p className={`mt-2 text-sm ${hoursLeft(o.shipBy) < 12 ? "text-alarm" : "text-muted"}`}>
                  Ship within {Math.max(0, hoursLeft(o.shipBy))} hours or the order is cancelled and the buyer refunded.
                </p>
                {canAct && (
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <label className="grid gap-1 text-sm">
                      <span className="text-muted">Courier</span>
                      <input placeholder="Delhivery" value={form[o.id]?.courier ?? ""} onChange={set(o.id, "courier")} className={`${field} py-2`} />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span className="text-muted">AWB / tracking number</span>
                      <input value={form[o.id]?.awb ?? ""} onChange={set(o.id, "awb")} className={`${field} py-2 font-receipt`} />
                    </label>
                    <button onClick={() => act(o, { action: "ship", courier: form[o.id]?.courier, awb: form[o.id]?.awb })} className={secondary}>
                      Mark shipped
                    </button>
                  </div>
                )}
              </>
            )}

            {o.status === "shipped" && o.shipment && (
              <>
                <p className="mt-3">
                  {o.shipment.courier} · AWB <span className="font-receipt">{o.shipment.awb}</span> · tracking says {o.shipment.lastStatus.replace(/_/g, " ")}
                </p>
                {canAct && (
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <label className="grid gap-1 text-sm">
                      <span className="text-muted">Delivered by hand? Enter the buyer&apos;s 4-digit code</span>
                      <input inputMode="numeric" maxLength={4} value={form[o.id]?.code ?? ""} onChange={set(o.id, "code")} className={`${field} w-32 py-2 font-receipt tracking-[0.3em]`} />
                    </label>
                    <button onClick={() => act(o, { action: "handover", code: form[o.id]?.code })} className={secondary}>
                      Confirm delivery
                    </button>
                  </div>
                )}
              </>
            )}

            {o.status === "disputed" && o.dispute && (
              <div className="mt-3">
                <p>
                  <span className="text-saffron">{o.dispute.reason.replace(/_/g, " ")}:</span> {o.dispute.details}
                </p>
                {o.dispute.sellerResponse ? (
                  <p className="mt-2 text-muted">Your response: {o.dispute.sellerResponse}</p>
                ) : (
                  canAct && (
                    <div className="mt-3 grid gap-2">
                      <textarea rows={2} placeholder="Your side: how it was packed, photos at dispatch, courier notes…" value={form[o.id]?.response ?? ""} onChange={set(o.id, "response")} className={field} />
                      <button onClick={() => act(o, { action: "respond", response: form[o.id]?.response })} className={`${secondary} w-fit`}>
                        Send response
                      </button>
                    </div>
                  )
                )}
                <p className="mt-2 text-sm text-muted">Your payout for this order is paused while GhostCart reviews it.</p>
              </div>
            )}
            <ErrorText>{errors[o.id]}</ErrorText>
          </article>
        ))}
      </div>
    </section>
  );
}
