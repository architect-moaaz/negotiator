"use client";

import { useState } from "react";

const CANCEL_REASONS: [string, string][] = [
  ["010", "I don't want it any more"],
  ["006", "It's taking too long"],
  ["003", "Found it cheaper"],
  ["001", "The price changed"],
];
const ISSUES: [string, string][] = [
  ["ITM04", "Quality issue"],
  ["ITM03", "Wrong item"],
  ["ITM01", "Missing items"],
  ["FLM02", "Delivery delayed"],
  ["PMT01", "Refund not received"],
];

const field = "rounded-xl border border-line bg-panel px-3 py-2 text-sm";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post(action: string, body: Record<string, unknown>) {
  const r = await fetch(`/api/ondc-buyer/after/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? "Something went wrong.");
  return data;
}
async function wait<T>(what: string, txn: string, done: (d: T) => boolean = () => true): Promise<T> {
  for (let i = 0; i < 15; i++) {
    const d = await (await fetch(`/api/ondc-buyer/after/${what}?txn=${txn}`, { cache: "no-store" })).json();
    if (!d.waiting && done(d)) return d;
    await sleep(1000);
  }
  throw new Error("The seller didn't answer in time. Try again.");
}

/** What a shopper can do once an ONDC order is placed: track, contact the seller, cancel, return, complain. */
export function OndcOrderActions({ txn }: { txn: string }) {
  const [open, setOpen] = useState<"" | "cancel" | "return" | "issue">("");
  const [reason, setReason] = useState("010");
  const [text, setText] = useState("");
  const [issueType, setIssueType] = useState("ITM04");
  const [issueId, setIssueId] = useState("");
  const [info, setInfo] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setError("");
    try {
      const line = await fn();
      setInfo((i) => [...i, line]);
      setOpen("");
      setText("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const track = () =>
    run(async () => {
      await post("track", { transactionId: txn });
      const t = await wait<{ url?: string; status?: string }>("track", txn);
      return t.url ? `Tracking: ${t.url}` : `Tracking status: ${t.status ?? "not available yet"}`;
    });
  const support = () =>
    run(async () => {
      await post("support", { transactionId: txn });
      const s = await wait<{ phone?: string; email?: string }>("support", txn);
      return `Seller support: ${[s.phone, s.email].filter(Boolean).join(" · ") || "no contact given"}`;
    });
  const cancel = () =>
    run(async () => {
      await post("cancel", { transactionId: txn, reason });
      const o = await wait<{ state?: string }>("order", txn, (d) => d.state === "Cancelled");
      return `Order ${o.state?.toLowerCase()}. Any payment is refunded by the seller.`;
    });
  const ret = () =>
    run(async () => {
      await post("return", { transactionId: txn, reason: text });
      const o = await wait<{ fulfillmentState?: string }>("order", txn, (d) => !!d.fulfillmentState?.startsWith("Return"));
      return `Return requested (${o.fulfillmentState?.replace(/_/g, " ").toLowerCase()}). The seller arranges the pickup.`;
    });
  const issue = () =>
    run(async () => {
      const { issueId: id } = await post("issue", { transactionId: txn, type: issueType, description: text });
      setIssueId(id);
      const s = await wait<{ id?: string; lastAction?: string; note?: string }>("issue", txn, (d) => d.id === id);
      return `Complaint raised. Seller: ${s.note ?? s.lastAction ?? "received"}.`;
    });
  const issueStatus = () =>
    run(async () => {
      await post("issue_status", { transactionId: txn, issueId });
      const s = await wait<{ status?: string; resolution?: string; refund?: string; note?: string }>("issue", txn, (d) => d.status !== "OPEN");
      return `Complaint ${s.status?.toLowerCase()}: ${s.resolution ?? s.note ?? ""}${s.refund ? ` (refund ₹${s.refund})` : ""}`;
    });

  const btn = "rounded-xl border border-line px-3 py-2 text-sm hover:border-saffron disabled:opacity-50";
  return (
    <div className="mt-4 space-y-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} onClick={track} className={btn}>
          Track
        </button>
        <button disabled={busy} onClick={support} className={btn}>
          Contact the seller
        </button>
        <button disabled={busy} onClick={() => setOpen(open === "cancel" ? "" : "cancel")} className={btn}>
          Cancel order
        </button>
        <button disabled={busy} onClick={() => setOpen(open === "return" ? "" : "return")} className={btn}>
          Return it
        </button>
        <button disabled={busy} onClick={() => setOpen(open === "issue" ? "" : "issue")} className={btn}>
          Report a problem
        </button>
        {issueId && (
          <button disabled={busy} onClick={issueStatus} className={btn}>
            Check my complaint
          </button>
        )}
      </div>
      {open === "cancel" && (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Why are you cancelling?" value={reason} onChange={(e) => setReason(e.target.value)} className={field}>
            {CANCEL_REASONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <button disabled={busy} onClick={cancel} className={btn}>
            Confirm cancellation
          </button>
        </div>
      )}
      {open === "return" && (
        <div className="flex flex-wrap items-center gap-2">
          <input aria-label="Why are you returning it?" placeholder="Why are you returning it?" value={text} onChange={(e) => setText(e.target.value)} className={`${field} min-w-64 flex-1`} />
          <button disabled={busy} onClick={ret} className={btn}>
            Request return
          </button>
        </div>
      )}
      {open === "issue" && (
        <div className="grid gap-2 sm:max-w-md">
          <select aria-label="What went wrong?" value={issueType} onChange={(e) => setIssueType(e.target.value)} className={field}>
            {ISSUES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <textarea aria-label="What happened?" placeholder="What happened?" rows={3} value={text} onChange={(e) => setText(e.target.value)} className={field} />
          <button disabled={busy} onClick={issue} className={`${btn} justify-self-start`}>
            Send complaint
          </button>
        </div>
      )}
      {busy && <p className="text-muted">Asking the seller…</p>}
      {info.map((l, i) => (
        <p key={i} className="break-all text-muted">
          {l}
        </p>
      ))}
      {error && (
        <p role="alert" className="text-alarm">
          {error}
        </p>
      )}
    </div>
  );
}
