"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ShopperSignup } from "../shopper-signup";

/** Starts a negotiation on a shop product; asks the shopper to sign up first if needed. */
export function HaggleButton({ productId, disabled, label }: { productId: string; disabled?: boolean; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [needsSignup, setNeedsSignup] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/shop/haggle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.status === 401 && data.needsSignup) return setNeedsSignup(true);
    if (!res.ok) return setError(data.error || "Couldn't start. Try again.");
    router.push(`/deal/${data.id}`);
  }

  if (needsSignup) {
    return (
      <div className="rounded-2xl border border-line p-5">
        <ShopperSignup
          onDone={() => {
            setNeedsSignup(false);
            start();
          }}
        />
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      <button onClick={start} disabled={disabled || busy} className="rounded-xl bg-saffron px-6 py-4 text-lg font-semibold text-paper-ink disabled:opacity-50">
        {busy ? "Starting…" : label}
      </button>
      {error && (
        <p role="alert" className="text-alarm">
          {error}
        </p>
      )}
    </div>
  );
}
