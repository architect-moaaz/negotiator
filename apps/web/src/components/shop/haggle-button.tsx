"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { t, type Lang } from "@/lib/i18n";
import { ShopperSignup } from "../shopper-signup";

/**
 * Starts a negotiation on a shop product (or, with endpoint and payload, on something else such as a
 * GhostCart Privilege cart); asks the shopper to sign up first if needed.
 */
export function HaggleButton({
  productId,
  disabled,
  label,
  returnUrl,
  endpoint = "/api/shop/haggle",
  payload,
  lang = "en",
}: {
  productId?: string;
  disabled?: boolean;
  label: string;
  returnUrl?: string;
  endpoint?: string;
  payload?: Record<string, unknown>;
  lang?: Lang;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [needsSignup, setNeedsSignup] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setBusy(true);
    setError("");
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload ?? { productId, returnUrl }) });
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
          lang={lang}
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
        {busy ? t(lang, "product.starting") : label}
      </button>
      {error && (
        <p role="alert" className="text-alarm">
          {error}
        </p>
      )}
    </div>
  );
}
