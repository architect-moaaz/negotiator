"use client";

import { useCallback, useEffect, useState } from "react";

interface Overview {
  events: { id: number; kind: string; action: string; subjectType: string; subjectId: string; details: Record<string, unknown>; reviewedBy: string | null; createdAt: string }[];
  flagged: { id: string; title: string; total: number; storeId: string; flagged: string; status: string }[];
  riskySellers: { storeId: string; orders: number; disputed: number; refunded: number }[];
  riskyBuyers: { userId: string; disputes: number }[];
}

const TONE: Record<string, string> = { blocked: "text-alarm", flagged: "text-saffron", info: "text-muted" };

/** Fraud signals for staff: what was blocked or flagged, orders whose payout is held for review. */
export function FraudPanel() {
  const [data, setData] = useState<Overview | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const res = await fetch("/api/admin/fraud", { cache: "no-store" });
    if (res.ok) setData(await res.json());
    else setError((await res.json().catch(() => ({}))).error ?? "Couldn't load fraud signals.");
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function clear(orderId: string) {
    const res = await fetch("/api/admin/fraud", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, note: notes[orderId] ?? "" }) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Couldn't clear.");
    load();
  }

  if (!data) return <p className="mt-6 text-muted">{error || "Loading…"}</p>;
  return (
    <div className="mt-6 space-y-10">
      {error && <p className="text-alarm">{error}</p>}
      <section>
        <h2 className="text-xl font-semibold">Orders held for review</h2>
        {data.flagged.length === 0 && <p className="mt-2 text-muted">None.</p>}
        {data.flagged.map((o) => (
          <article key={o.id} className="mt-3 rounded-2xl border border-saffron/60 p-4">
            <p className="font-semibold">
              {o.title} · ₹{(o.total / 100).toLocaleString("en-IN")} · {o.id}
            </p>
            <p className="text-saffron">{o.flagged}</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <input placeholder="Why it's fine" value={notes[o.id] ?? ""} onChange={(e) => setNotes({ ...notes, [o.id]: e.target.value })} className="min-w-64 flex-1 rounded-xl border border-line bg-panel px-4 py-2" />
              <button onClick={() => clear(o.id)} className="rounded-xl border border-line px-4 py-2 hover:border-paid">
                Clear and let it pay out
              </button>
            </div>
          </article>
        ))}
      </section>
      <section className="grid gap-6 sm:grid-cols-2">
        <div>
          <h2 className="text-xl font-semibold">Sellers to watch</h2>
          <p className="text-sm text-muted">Over 5% disputed or 10% refunded, with 5+ orders.</p>
          {data.riskySellers.length === 0 ? (
            <p className="mt-2 text-muted">None.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {data.riskySellers.map((s) => (
                <li key={s.storeId}>
                  {s.storeId}: {s.disputed} disputes, {s.refunded} refunds of {s.orders} orders
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h2 className="text-xl font-semibold">Shoppers to watch</h2>
          <p className="text-sm text-muted">Two or more problem reports.</p>
          {data.riskyBuyers.length === 0 ? (
            <p className="mt-2 text-muted">None.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {data.riskyBuyers.map((b) => (
                <li key={b.userId}>
                  {b.userId}: {b.disputes} reports
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <section>
        <h2 className="text-xl font-semibold">Recent signals</h2>
        <table className="mt-3 w-full text-left text-sm">
          <tbody>
            {data.events.map((e) => (
              <tr key={e.id} className="border-t border-line">
                <td className="py-2 pr-3 text-muted">{new Date(e.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" })}</td>
                <td className={`py-2 pr-3 ${TONE[e.action] ?? ""}`}>{e.action}</td>
                <td className="py-2 pr-3">{e.kind.replace(/_/g, " ")}</td>
                <td className="py-2 pr-3 font-receipt">{e.subjectId}</td>
                <td className="py-2 text-muted">{String(e.details.why ?? (Array.isArray(e.details.reasons) ? e.details.reasons.join("; ") : "") ?? "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
