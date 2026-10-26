"use client";

import Link from "next/link";
import { useState } from "react";

const field = "rounded-xl border border-line bg-panel px-4 py-3 text-fg placeholder:text-muted/60 focus:border-saffron focus:outline-none disabled:opacity-60";

/** Shopper signup with the phone code (same two steps as /api/signup). Calls onDone once signed in. */
export function ShopperSignup({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ name: "", phone: "", consent: false, code: "" });
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, phone: form.phone, consent: form.consent, code: note ? form.code : undefined, source: "shop" }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error || "Couldn't sign you up. Try again.");
    if (data.codeSent) return setNote(data.via === "call" ? `We're calling ${data.phone} now with your 6-digit code.` : "Dev mode: the code is in the server console.");
    onDone();
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="font-semibold">Quick sign-up so the seller can reach you about this deal</p>
      <p className="-mt-2 text-sm text-muted">
        Been here before?{" "}
        <Link href="/login" className="text-fg underline underline-offset-4">
          Log in with a code
        </Link>
      </p>
      <label className="grid gap-2">
        <span className="text-muted">Your name</span>
        <input required autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={busy} className={field} />
      </label>
      <label className="grid gap-2">
        <span className="text-muted">Mobile number</span>
        <input
          required
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="98765 43210"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          disabled={busy || !!note}
          className={field}
        />
      </label>
      <label className="flex items-start gap-3 text-sm text-muted">
        <input type="checkbox" required checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} className="mt-0.5 size-4 accent-saffron" />
        <span>GhostCart and this seller can contact me on this number about this deal. No marketing.</span>
      </label>
      {note && (
        <label className="grid gap-2">
          <span className="text-muted">{note}</span>
          <input
            required
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="••••••"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\D/g, "") })}
            className={`${field} font-receipt tracking-[0.4em]`}
          />
        </label>
      )}
      {error && (
        <p role="alert" className="text-alarm">
          {error}
        </p>
      )}
      <button disabled={busy || (!!note && form.code.length !== 6)} className="rounded-xl bg-saffron px-6 py-3.5 text-lg font-semibold text-paper-ink disabled:opacity-50">
        {busy ? "One moment…" : note ? "Verify and start haggling" : "Call me with a code"}
      </button>
    </form>
  );
}
