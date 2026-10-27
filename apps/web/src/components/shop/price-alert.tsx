"use client";

import { useState } from "react";
import { inr } from "@/lib/format";
import { ShopperSignup } from "../shopper-signup";

/** "Tell me if the price drops to ₹X": one message when the listed price reaches the target. */
export function PriceAlert({ productId, price }: { productId: string; price: number }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(String(Math.round((price * 0.9) / 10) * 10));
  const [state, setState] = useState<"idle" | "busy" | "signup" | "done">("idle");
  const [error, setError] = useState("");

  async function save() {
    setState("busy");
    setError("");
    const res = await fetch("/api/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId, target: Number(target) }) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.needsSignup) return setState("signup");
    if (!res.ok) {
      setState("idle");
      return setError(data.error || "Couldn't set the alert. Try again.");
    }
    setState("done");
  }

  if (state === "done") return <p role="status" className="text-sm text-muted">Done. We&apos;ll tell you once if the price drops to {inr(Number(target))} or less.</p>;
  if (state === "signup")
    return (
      <div className="rounded-2xl border border-line p-5">
        <ShopperSignup onDone={save} />
      </div>
    );
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="text-sm text-muted underline underline-offset-4 hover:text-fg">
        Tell me if the price drops
      </button>
    );
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label className="grid gap-1 text-sm">
        <span className="text-muted">Tell me if the listed price drops to (₹)</span>
        <input inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value.replace(/\D/g, ""))} className="w-36 rounded-xl border border-line bg-panel px-4 py-2 text-fg focus:border-saffron focus:outline-none" />
      </label>
      <button disabled={state === "busy" || !target} className="rounded-xl border border-line px-4 py-2.5 hover:border-saffron disabled:opacity-50">
        {state === "busy" ? "Saving…" : "Set alert"}
      </button>
      {error && (
        <p role="alert" className="w-full text-sm text-alarm">
          {error}
        </p>
      )}
    </form>
  );
}
