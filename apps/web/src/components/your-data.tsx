"use client";

import { useEffect, useState } from "react";

interface ConsentRecord {
  purpose: string;
  action: "granted" | "withdrawn";
  wording: string;
  source: string;
  at: string;
}

const day = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

/** The shopper's DPDP rights in one place: what they agreed to, a download of their data, and deletion. */
export function YourData({ onDeleted }: { onDeleted: () => void }) {
  const [consent, setConsent] = useState<{ dealContact: "granted" | "withdrawn"; history: ConsentRecord[] } | null>(null);
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch("/api/me/consents", { cache: "no-store" });
    if (res.ok) setConsent(await res.json());
  }
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, []);

  async function setContact(dealContact: boolean) {
    setError("");
    const res = await fetch("/api/me/consents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dealContact }) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Couldn't save that.");
    load();
  }

  async function remove() {
    setError("");
    setDeleting(true);
    const res = await fetch("/api/me/data", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm }) });
    setDeleting(false);
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Couldn't delete your account.");
    onDeleted();
  }

  if (!consent) return null;
  const contactOn = consent.dealContact === "granted";
  return (
    <section className="mt-16 border-t border-line pt-10" aria-labelledby="your-data">
      <h2 id="your-data" className="text-2xl font-semibold">
        Your data
      </h2>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-md">
          <p>Contact about your deals</p>
          <p className="text-sm text-muted">
            {contactOn
              ? "Sellers and GhostCart can call or message you about deals you start. Never marketing."
              : "Nobody will call or message you about your deals. Your orders still go ahead, and you can check them here."}
          </p>
        </div>
        <button onClick={() => setContact(!contactOn)} className="rounded-xl border border-line px-4 py-2.5 hover:border-saffron">
          {contactOn ? "Stop contacting me" : "Allow contact"}
        </button>
      </div>
      {consent.history.length > 0 && (
        <details className="mt-4 text-sm text-muted">
          <summary className="cursor-pointer text-fg">What you agreed to, and when</summary>
          <ul className="mt-2 space-y-2">
            {consent.history.map((c, i) => (
              <li key={i}>
                {day(c.at)}: {c.action === "granted" ? "agreed" : "withdrew"}. &ldquo;{c.wording}&rdquo;
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-md">
          <p>Download your data</p>
          <p className="text-sm text-muted">Your profile, deals, conversations with the agent, orders, and consent records, as a JSON file.</p>
        </div>
        <a href="/api/me/data" className="rounded-xl border border-line px-4 py-2.5 hover:border-saffron">
          Download
        </a>
      </div>

      <div className="mt-8">
        <p>Delete your account</p>
        <p className="max-w-xl text-sm text-muted">
          We erase your name, phone number, email and what you wrote to the agent. Records of orders you paid for are kept for 8 years because accounting and tax law require it, with your name,
          phone and street removed. You can&apos;t delete your account while an order is still on its way or in its return window.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="sr-only" htmlFor="confirm-delete">
            Type delete to confirm
          </label>
          <input
            id="confirm-delete"
            placeholder="Type delete to confirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-56 rounded-xl border border-line bg-panel px-4 py-2.5"
          />
          <button onClick={remove} disabled={confirm.trim().toLowerCase() !== "delete" || deleting} className="rounded-xl border border-alarm px-4 py-2.5 text-alarm disabled:opacity-40">
            {deleting ? "Deleting…" : "Delete my account"}
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-4 text-alarm">
          {error}
        </p>
      )}
    </section>
  );
}
