"use client";

import { useState } from "react";

const CATEGORIES = [
  ["order", "An order"],
  ["data_privacy", "My data or privacy"],
  ["seller", "A seller"],
  ["payment", "A payment or refund"],
  ["other", "Something else"],
] as const;

const field = "w-full rounded-xl border border-line bg-panel px-4 py-3";

export function GrievanceForm() {
  const [form, setForm] = useState({ name: "", contact: "", category: "", reference: "", message: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filed, setFiled] = useState<{ id: string; acknowledgeBy: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const res = await fetch("/api/grievances", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.error ?? "Couldn't send your complaint. Try again.");
    setFiled(body);
  }

  if (filed)
    return (
      <div role="status" className="mt-10 rounded-2xl border border-saffron p-6">
        <p className="text-lg font-semibold">Complaint sent</p>
        <p className="mt-2 text-muted">
          Your reference is <span className="font-receipt text-fg">{filed.id}</span>. We&apos;ll reply to {form.contact} by{" "}
          {new Date(filed.acknowledgeBy).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" })}.
        </p>
      </div>
    );

  return (
    <form onSubmit={submit} className="mt-10 grid gap-5">
      <label className="grid gap-2">
        <span>Your name</span>
        <input required autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={field} />
      </label>
      <label className="grid gap-2">
        <span>Phone or email for our reply</span>
        <input required value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} className={field} />
      </label>
      <label className="grid gap-2">
        <span>What it&apos;s about</span>
        <select required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={field}>
          <option value="" disabled>
            Choose one
          </option>
          {CATEGORIES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-2">
        <span>
          Order or deal number <span className="text-muted">(if you have one)</span>
        </span>
        <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} className={field} />
      </label>
      <label className="grid gap-2">
        <span>What happened</span>
        <textarea required rows={6} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className={field} />
      </label>
      {error && (
        <p role="alert" className="text-alarm">
          {error}
        </p>
      )}
      <button disabled={busy} className="justify-self-start rounded-xl bg-saffron px-6 py-3 font-semibold text-paper-ink disabled:opacity-50">
        {busy ? "Sending…" : "Send complaint"}
      </button>
    </form>
  );
}
