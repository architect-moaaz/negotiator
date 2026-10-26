"use client";

import { useCallback, useEffect, useState } from "react";

interface Row {
  dispute: { id: string; reason: string; details: string; sellerResponse: string | null; createdAt: string };
  order: { id: string; dealId: string; title: string; total: number; storeId: string };
}

/** Staff resolve buyer problems: full refund, partial refund, or release to the seller. */
export function DisputesPanel() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const res = await fetch("/api/admin/disputes", { cache: "no-store" });
    if (res.ok) setRows(await res.json());
    else setError((await res.json().catch(() => ({}))).error ?? "Couldn't load disputes.");
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function resolve(r: Row, outcome: string) {
    setError("");
    const res = await fetch("/api/admin/disputes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disputeId: r.dispute.id, outcome, amountInr: outcome === "partial_refund" ? Number(amounts[r.dispute.id]) : undefined, note: notes[r.dispute.id] ?? "" }),
    });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Couldn't resolve.");
    load();
  }

  if (!rows) return <p className="mt-6 text-muted">{error || "Loading disputes…"}</p>;
  return (
    <div className="mt-6 space-y-4">
      {error && <p className="text-alarm">{error}</p>}
      {rows.length === 0 && <p className="py-6 text-muted">No open disputes.</p>}
      {rows.map((r) => (
        <article key={r.dispute.id} className="rounded-2xl border border-saffron/60 p-5">
          <p className="text-lg font-semibold">{r.order.title}</p>
          <p className="text-muted">
            ₹{(r.order.total / 100).toLocaleString("en-IN")} · order {r.order.id} · deal {r.order.dealId}
          </p>
          <p className="mt-3">
            <span className="text-saffron">Buyer ({r.dispute.reason.replace(/_/g, " ")}):</span> {r.dispute.details}
          </p>
          <p className="mt-1">
            <span className="text-muted">Seller:</span> {r.dispute.sellerResponse ?? "no response yet"}
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <input placeholder="Decision note (shown to both)" value={notes[r.dispute.id] ?? ""} onChange={(e) => setNotes({ ...notes, [r.dispute.id]: e.target.value })} className="min-w-64 flex-1 rounded-xl border border-line bg-panel px-4 py-2.5" />
            <button onClick={() => resolve(r, "refunded")} className="rounded-xl border border-line px-4 py-2.5 hover:border-alarm">
              Refund in full
            </button>
            <input inputMode="numeric" placeholder="₹" value={amounts[r.dispute.id] ?? ""} onChange={(e) => setAmounts({ ...amounts, [r.dispute.id]: e.target.value })} className="w-24 rounded-xl border border-line bg-panel px-3 py-2.5" />
            <button onClick={() => resolve(r, "partial_refund")} className="rounded-xl border border-line px-4 py-2.5 hover:border-saffron">
              Refund part
            </button>
            <button onClick={() => resolve(r, "released")} className="rounded-xl border border-line px-4 py-2.5 hover:border-paid">
              Release to seller
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
