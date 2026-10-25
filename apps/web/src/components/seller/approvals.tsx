"use client";

import type { NegotiationTerms } from "@ghostcart/core";
import { useCallback, useEffect, useState } from "react";
import { inr } from "@/lib/format";
import type { AgentRecommendation, PublicDeal } from "@/lib/types";
import { api, ErrorText, field, secondary } from "./ui";

type Row = PublicDeal & { terms?: NegotiationTerms; recommendation: AgentRecommendation | null };

const STATUS: Record<string, string> = { negotiating: "Haggling", pending: "Agreed, awaiting ₹9 lock", paid: "Locked", expired: "Expired" };

/** Offers below the agent's limit, waiting on the seller. Polls so a new one shows up within seconds. */
export function ApprovalsTab({ storeId, canApprove, onCount }: { storeId: string; canApprove: boolean; onCount: (n: number) => void }) {
  const [data, setData] = useState<{ waiting: Row[]; recent: Row[] } | null>(null);
  const [counter, setCounter] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const r = await api<{ waiting: Row[]; recent: Row[] }>(`/api/seller/stores/${storeId}/approvals`);
    if (r.ok) {
      setData(r.data);
      onCount(r.data.waiting.length);
    }
  }, [storeId, onCount]);
  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(load, 5000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  async function decide(d: Row, decision: string) {
    setBusy(d.id);
    setErrors((e) => ({ ...e, [d.id]: "" }));
    const r = await api(`/api/seller/stores/${storeId}/approvals`, { body: { dealId: d.id, decision, price: decision === "counter" ? Number(counter[d.id]) : undefined } });
    setBusy("");
    if (!r.ok) setErrors((e) => ({ ...e, [d.id]: r.error }));
    load();
  }

  if (!data) return <p className="mt-6 text-muted">Loading…</p>;
  return (
    <section className="mt-6 max-w-3xl">
      {data.waiting.length === 0 ? (
        <p className="text-muted">No offers waiting. When a shopper goes below what your agent can give alone, it shows up here and we call you.</p>
      ) : (
        <div className="space-y-4">
          {data.waiting.map((d) => {
            const offer = d.negotiation?.approvalPrice ?? 0;
            const t = d.terms!;
            return (
              <article key={d.id} className="rounded-2xl border border-saffron/60 p-5">
                <p className="text-lg font-semibold">{d.product.title}</p>
                <p className="mt-1">
                  Shopper offers <span className="text-saffron">{inr(offer)}</span> on a list price of {inr(t.benchmark)} ({Math.round(((t.benchmark - offer) / t.benchmark) * 100)}% off).
                </p>
                <p className="mt-1 text-sm text-muted">
                  Your agent could go to {inr(t.autoLimit)} alone; your floor is {inr(t.floor)}. Rounds haggled: {d.negotiation?.rounds ?? 0}.
                </p>
                {d.recommendation && (
                  <p className="mt-3 text-sm">
                    <span className="text-muted">Deal-desk agent suggests:</span> {d.recommendation.decision}
                    {d.recommendation.price ? ` at ${inr(d.recommendation.price)}` : ""} ({Math.round(d.recommendation.confidence * 100)}% sure). {d.recommendation.reasoning}
                  </p>
                )}
                {canApprove && (
                  <div className="mt-4 flex flex-wrap items-end gap-3">
                    <button disabled={busy === d.id} onClick={() => decide(d, "approved")} className="rounded-xl bg-paid px-4 py-2.5 font-semibold text-ink disabled:opacity-50">
                      Approve {inr(offer)}
                    </button>
                    <button disabled={busy === d.id} onClick={() => decide(d, "rejected")} className={secondary}>
                      Say no (offer {inr(t.autoLimit)})
                    </button>
                    <label className="grid gap-1 text-sm">
                      <span className="text-muted">Or counter at</span>
                      <input inputMode="numeric" placeholder={String(Math.round((offer + t.autoLimit) / 2))} value={counter[d.id] ?? ""} onChange={(e) => setCounter({ ...counter, [d.id]: e.target.value })} className={`${field} w-32 py-2`} />
                    </label>
                    <button disabled={busy === d.id || !counter[d.id]} onClick={() => decide(d, "counter")} className={secondary}>
                      Counter
                    </button>
                  </div>
                )}
                <ErrorText>{errors[d.id]}</ErrorText>
              </article>
            );
          })}
        </div>
      )}
      {data.recent.length > 0 && (
        <>
          <h2 className="mt-10 text-xl font-semibold">Recent negotiations</h2>
          <table className="mt-4 w-full text-left text-sm">
            <tbody>
              {data.recent.map((d) => (
                <tr key={d.id} className="border-t border-line">
                  <td className="py-2 pr-3">{d.product.title}</td>
                  <td className="py-2 pr-3 tabular-nums">{inr(d.dealPrice)}</td>
                  <td className="py-2 text-muted">{d.checkout?.status === "ordered" ? "Ordered" : (STATUS[d.status] ?? d.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
