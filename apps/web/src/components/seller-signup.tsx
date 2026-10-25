"use client";

import Link from "next/link";
import { useState } from "react";

const field = "rounded-xl border border-line bg-panel px-4 py-3 text-fg placeholder:text-muted/60 focus:border-saffron focus:outline-none";

export function SellerSignup() {
  const [form, setForm] = useState({ storeName: "", aliases: "", contactName: "", phone: "", budgetPct: "8", autoApprovePct: "60" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ storeName: string; token: string } | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/sellers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, budgetPct: Number(form.budgetPct), autoApprovePct: Number(form.autoApprovePct) }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error || "Couldn't register. Try again.");
    try {
      sessionStorage.setItem("gc_seller_token", data.token);
    } catch {}
    setDone(data);
  }

  if (done) {
    return (
      <section className="mt-10 rounded-2xl border border-paid/60 p-6">
        <h2 className="text-2xl font-semibold">{done.storeName} is live on GhostCart</h2>
        <p className="mt-3 text-muted">
          You&apos;re logged in. Next time, log in with your phone number. Keep this backup key somewhere safe; it won&apos;t be shown again.
        </p>
        <p className="mt-4 select-all break-all rounded-lg bg-panel px-4 py-3 font-receipt">{done.token}</p>
        <Link href="/seller" className="mt-6 inline-block rounded-xl bg-saffron px-6 py-3 font-semibold text-paper-ink">
          Open seller dashboard
        </Link>
      </section>
    );
  }

  const budget = Number(form.budgetPct) || 0;
  const auto = Number(form.autoApprovePct) || 0;
  const example = 20000;

  return (
    <form onSubmit={submit} className="mt-10 grid gap-5">
      <div className="grid gap-2">
        <label htmlFor="store" className="text-muted">
          Store name
        </label>
        <input id="store" required value={form.storeName} onChange={set("storeName")} className={field} />
      </div>
      <div className="grid gap-2">
        <label htmlFor="aliases" className="text-muted">
          Your seller names on Amazon or Flipkart, exactly as shown after &ldquo;Sold by&rdquo; (comma-separated)
        </label>
        <textarea id="aliases" rows={2} placeholder="Clicktech Retail Private Ltd, SVPeripherals" value={form.aliases} onChange={set("aliases")} className={field} />
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="grid gap-2">
          <label htmlFor="contact" className="text-muted">
            Contact name
          </label>
          <input id="contact" required autoComplete="name" value={form.contactName} onChange={set("contactName")} className={field} />
        </div>
        <div className="grid gap-2">
          <label htmlFor="sphone" className="text-muted">
            Mobile number
          </label>
          <input id="sphone" type="tel" inputMode="numeric" required value={form.phone} onChange={set("phone")} className={field} />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="grid gap-2">
          <label htmlFor="budget" className="text-muted">
            Most you&apos;d discount (% of price)
          </label>
          <input id="budget" type="number" min={1} max={30} required value={form.budgetPct} onChange={set("budgetPct")} className={field} />
        </div>
        <div className="grid gap-2">
          <label htmlFor="auto" className="text-muted">
            Share your agent can give without asking (%)
          </label>
          <input id="auto" type="number" min={10} max={100} required value={form.autoApprovePct} onChange={set("autoApprovePct")} className={field} />
        </div>
      </div>
      <p className="text-muted">
        On a ₹20,000 item your agent can drop to ₹{Math.round(example - (example * budget * auto) / 10000).toLocaleString("en-IN")} on its own, and asks
        you before going as low as ₹{Math.round(example - (example * budget) / 100).toLocaleString("en-IN")}.
      </p>
      {error && (
        <p role="alert" className="text-alarm">
          {error}
        </p>
      )}
      <button disabled={busy} className="rounded-xl bg-saffron px-6 py-4 text-lg font-semibold text-paper-ink disabled:opacity-50">
        {busy ? "Registering…" : "Register my store"}
      </button>
    </form>
  );
}
