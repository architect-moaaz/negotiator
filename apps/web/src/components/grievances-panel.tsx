"use client";

import { useCallback, useEffect, useState } from "react";

interface Row {
  id: string;
  name: string;
  contact: string;
  category: string;
  reference: string | null;
  message: string;
  status: "open" | "acknowledged";
  handledBy: string | null;
  createdAt: string;
  due: { step: "acknowledge" | "resolve"; by: string; overdue: boolean };
}

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** The grievance officer's queue: acknowledge within 48 hours, reply with a resolution within a month. */
export function GrievancesPanel() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const res = await fetch("/api/admin/grievances", { cache: "no-store" });
    if (res.ok) setRows(await res.json());
    else setError((await res.json().catch(() => ({}))).error ?? "Couldn't load complaints.");
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function act(id: string, action: "acknowledge" | "resolve") {
    setError("");
    const res = await fetch("/api/admin/grievances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, response: replies[id] }),
    });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Couldn't save.");
    load();
  }

  if (!rows) return <p className="mt-6 text-muted">{error || "Loading complaints…"}</p>;
  return (
    <div className="mt-6 space-y-4">
      {error && <p className="text-alarm">{error}</p>}
      {rows.length === 0 && <p className="py-6 text-muted">No open complaints.</p>}
      {rows.map((g) => (
        <article key={g.id} className={`rounded-2xl border p-5 ${g.due.overdue ? "border-alarm" : "border-line"}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-lg font-semibold">
              {g.name} <span className="font-normal text-muted">about {g.category.replace(/_/g, " ")}</span>
            </p>
            <p className={g.due.overdue ? "font-semibold text-alarm" : "text-muted"}>
              {g.due.overdue ? "Overdue: " : ""}
              {g.due.step === "acknowledge" ? "acknowledge" : "resolve"} by {when(g.due.by)}
            </p>
          </div>
          <p className="text-muted">
            Reply to {g.contact}
            {g.reference ? ` · ref ${g.reference}` : ""} · filed {when(g.createdAt)} · {g.id}
            {g.handledBy ? ` · with ${g.handledBy}` : ""}
          </p>
          <p className="mt-3 whitespace-pre-line">{g.message}</p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            {g.status === "open" && (
              <button onClick={() => act(g.id, "acknowledge")} className="rounded-xl border border-line px-4 py-2.5 hover:border-saffron">
                Mark acknowledged
              </button>
            )}
            <textarea
              rows={2}
              placeholder="Resolution sent to the person"
              value={replies[g.id] ?? ""}
              onChange={(e) => setReplies({ ...replies, [g.id]: e.target.value })}
              className="min-w-64 flex-1 rounded-xl border border-line bg-panel px-4 py-2.5"
            />
            <button onClick={() => act(g.id, "resolve")} className="rounded-xl bg-saffron px-4 py-2.5 font-semibold text-paper-ink">
              Resolve
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
