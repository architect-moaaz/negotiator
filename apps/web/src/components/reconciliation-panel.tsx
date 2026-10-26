"use client";

import { useCallback, useEffect, useState } from "react";

interface Run {
  id: number;
  day: string;
  gateway: string;
  reportLines: number;
  ledgerLines: number;
  matched: number;
  issues: number;
  ranAt: string;
}
interface Issue {
  id: number;
  day: string;
  orderId: string;
  kind: string;
  ledgerAmount: number;
  gatewayAmount: number;
}

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const today = () => new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);

/** Settlement report vs ledger, day by day: runs, open differences, and resolving them with a note. */
export function ReconciliationPanel() {
  const [data, setData] = useState<{ runs: Run[]; open: Issue[] } | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [day, setDay] = useState(today);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/reconciliation", { cache: "no-store" });
    if (r.ok) setData(await r.json());
    else setError((await r.json().catch(() => ({}))).error ?? "Couldn't load reconciliation.");
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function post(body: unknown) {
    setError("");
    const r = await fetch("/api/admin/reconciliation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) setError((await r.json().catch(() => ({}))).error ?? "Couldn't save.");
    load();
  }

  if (!data) return <p className="text-muted">{error || "Loading reconciliation…"}</p>;
  return (
    <section className="space-y-4" aria-labelledby="recon-heading">
      <h2 id="recon-heading" className="text-xl font-semibold">
        Settlement reconciliation
      </h2>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          post({ action: "run", day });
        }}
      >
        <label className="grid gap-1 text-sm">
          <span className="text-muted">Day (IST)</span>
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="rounded-xl border border-line bg-panel px-3 py-2" />
        </label>
        <button className="rounded-xl border border-line px-4 py-2 hover:border-saffron">Reconcile this day</button>
      </form>
      {error && <p className="text-alarm">{error}</p>}
      {data.open.length === 0 ? (
        <p className="text-paid">No open differences between the settlement report and the ledger.</p>
      ) : (
        <ul className="space-y-3">
          {data.open.map((i) => (
            <li key={i.id} className="rounded-xl border border-alarm/60 p-4 text-sm">
              <p>
                <span className="font-semibold">{i.day}</span> · order {i.orderId} · {i.kind}: ledger {rupees(i.ledgerAmount)}, report {rupees(i.gatewayAmount)}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <input placeholder="What you found and did" value={notes[i.id] ?? ""} onChange={(e) => setNotes({ ...notes, [i.id]: e.target.value })} className="min-w-64 flex-1 rounded-xl border border-line bg-panel px-3 py-2" />
                <button onClick={() => post({ action: "resolve", id: i.id, note: notes[i.id] ?? "" })} className="rounded-xl border border-line px-4 py-2 hover:border-saffron">
                  Resolve
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {data.runs.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead className="text-muted">
            <tr>
              <th className="py-2 font-normal">Day</th>
              <th className="py-2 font-normal">Report lines</th>
              <th className="py-2 font-normal">Matched</th>
              <th className="py-2 font-normal">Differences</th>
            </tr>
          </thead>
          <tbody>
            {data.runs.map((r) => (
              <tr key={r.id} className="border-t border-line tabular-nums">
                <td className="py-2">{r.day}</td>
                <td className="py-2">{r.reportLines}</td>
                <td className="py-2">{r.matched}</td>
                <td className={`py-2 ${r.issues ? "text-alarm" : ""}`}>{r.issues}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
