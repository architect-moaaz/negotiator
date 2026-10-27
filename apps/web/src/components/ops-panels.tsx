"use client";

import { useCallback, useEffect, useState } from "react";

interface Item {
  kind: "grievance" | "dispute";
  id: string;
  orderId?: string;
  summary: string;
  openedAt: string;
  dueAt: string;
  due: string;
  overdue: boolean;
  assignee?: string;
}

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** One inbox for complaints and disputes, most urgent first, with saved replies and evidence packs. */
export function SupportPanel() {
  const [data, setData] = useState<{ items: Item[]; replies: { title: string; text: string }[] } | null>(null);
  const [copied, setCopied] = useState("");
  const load = useCallback(async () => {
    const res = await fetch("/api/admin/support", { cache: "no-store" });
    if (res.ok) setData(await res.json());
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  if (!data) return <p className="mt-6 text-muted">Loading…</p>;
  const take = async (i: Item, release = false) => {
    await fetch("/api/admin/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: i.kind, id: i.id, release }) });
    load();
  };
  return (
    <div className="mt-6 grid gap-8 lg:grid-cols-[2fr_1fr]">
      <section>
        {data.items.length === 0 && <p className="text-muted">Nothing open. Complaints and buyer disputes land here.</p>}
        <ul className="grid gap-3">
          {data.items.map((i) => (
            <li key={`${i.kind}:${i.id}`} className={`rounded-2xl border p-4 ${i.overdue ? "border-alarm" : "border-line"}`}>
              <p className="text-sm text-muted">
                {i.kind === "grievance" ? "Complaint" : "Dispute"} · opened {when(i.openedAt)} ·{" "}
                <span className={i.overdue ? "text-alarm" : ""}>
                  {i.due} by {when(i.dueAt)}
                  {i.overdue ? " (overdue)" : ""}
                </span>
              </p>
              <p className="mt-1">{i.summary}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                {i.assignee ? (
                  <>
                    <span className="text-muted">With {i.assignee}</span>
                    <button onClick={() => take(i, true)} className="underline">
                      Release
                    </button>
                  </>
                ) : (
                  <button onClick={() => take(i)} className="rounded-lg border border-line px-3 py-1 hover:border-saffron">
                    Take it
                  </button>
                )}
                {i.orderId && (
                  <a href={`/api/admin/orders/${i.orderId}/evidence`} className="underline">
                    Evidence pack
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
      <aside>
        <h3 className="font-semibold">Saved replies</h3>
        <ul className="mt-2 grid gap-3">
          {data.replies.map((r) => (
            <li key={r.title} className="rounded-xl border border-line p-3 text-sm">
              <p className="font-medium">{r.title}</p>
              <p className="mt-1 text-muted">{r.text}</p>
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(r.text).catch(() => {});
                  setCopied(r.title);
                }}
                className="mt-2 underline"
              >
                {copied === r.title ? "Copied" : "Copy"}
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

interface ExperimentRow {
  name: string;
  on: boolean;
  results: { variant: string; haggles: number; agreed: number; agreeRate: number; averageDiscount: number }[];
}

/** Experiments and how each variant is doing (last 30 days). Switched on with EXPERIMENTS in the env. */
export function ExperimentsPanel() {
  const [rows, setRows] = useState<ExperimentRow[] | null>(null);
  useEffect(() => {
    fetch("/api/admin/experiments", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { experiments: [] }))
      .then((d) => setRows(d.experiments));
  }, []);
  if (!rows) return <p className="mt-6 text-muted">Loading…</p>;
  const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
  return (
    <div className="mt-6 grid gap-6">
      {rows.map((e) => (
        <section key={e.name} className="rounded-2xl border border-line p-4">
          <h3 className="font-semibold">
            {e.name.replace(/_/g, " ")} <span className="text-sm font-normal text-muted">{e.on ? "running" : "off (add it to EXPERIMENTS to start)"}</span>
          </h3>
          {e.results.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No haggles under this experiment yet.</p>
          ) : (
            <table className="mt-3 w-full max-w-xl text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="text-left font-normal">Variant</th>
                  <th className="text-right font-normal">Haggles</th>
                  <th className="text-right font-normal">Agreed</th>
                  <th className="text-right font-normal">Agree rate</th>
                  <th className="text-right font-normal">Avg discount</th>
                </tr>
              </thead>
              <tbody>
                {e.results.map((r) => (
                  <tr key={r.variant} className="border-t border-line">
                    <td className="py-1">{r.variant}</td>
                    <td className="py-1 text-right tabular-nums">{r.haggles}</td>
                    <td className="py-1 text-right tabular-nums">{r.agreed}</td>
                    <td className="py-1 text-right tabular-nums">{pct(r.agreeRate)}</td>
                    <td className="py-1 text-right tabular-nums">{pct(r.averageDiscount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-xs text-muted">Small numbers swing a lot: wait for a few hundred haggles per variant before deciding.</p>
        </section>
      ))}
    </div>
  );
}
