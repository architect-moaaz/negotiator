"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { inr, shortTitle } from "@/lib/format";
import type { DealStatus, PublicDeal } from "@/lib/types";
import { YourData } from "./your-data";

const STATUS: Record<DealStatus, string> = {
  negotiating: "Haggling",
  awaiting_approval: "Waiting for approval",
  pending: "Agreed, pay to lock",
  paid: "Locked",
  granted: "Code ready",
  expired: "Expired",
};

export function MyDeals() {
  const router = useRouter();
  const [data, setData] = useState<{ name: string; deals: PublicDeal[] } | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [deleted, setDeleted] = useState(false);

  useEffect(() => {
    fetch("/api/me/deals", { cache: "no-store" })
      .then(async (r) => (r.status === 401 ? setNeedsLogin(true) : setData(await r.json())))
      .catch(() => setNeedsLogin(true));
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "buyer" }) });
    router.push("/");
    router.refresh();
  }

  if (deleted) {
    return (
      <div role="status" className="mt-20 text-center">
        <p className="text-lg">Your account is deleted.</p>
        <p className="mt-2 text-muted">Your name, number and conversations are erased. You&apos;re logged out.</p>
        <Link href="/" className="mt-6 inline-block rounded-xl bg-saffron px-6 py-3 font-semibold text-paper-ink">
          Back to GhostCart
        </Link>
      </div>
    );
  }
  if (needsLogin) {
    return (
      <div className="mt-20 text-center">
        <p className="text-lg">Log in to see your deals.</p>
        <Link href="/login" className="mt-6 inline-block rounded-xl bg-saffron px-6 py-3 font-semibold text-paper-ink">
          Log in
        </Link>
      </div>
    );
  }
  if (!data) return <p className="mt-20 text-center text-muted">Loading your deals…</p>;

  const locked = data.deals.filter((d) => d.status === "paid");
  const saved = locked.reduce((sum, d) => sum + d.saved, 0);

  return (
    <div className="mt-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Hi {data.name.split(" ")[0]}</h1>
          <p className="mt-1 text-muted">
            {locked.length ? (
              <>
                {locked.length} {locked.length === 1 ? "deal" : "deals"} locked · <span className="text-saffron">{inr(saved)} saved</span>
              </>
            ) : (
              "No locked deals yet. Your next one is a link away."
            )}
          </p>
        </div>
        <button onClick={logout} className="rounded-xl border border-line px-4 py-2.5 hover:border-alarm">
          Log out
        </button>
      </div>

      <Link href="/" className="mt-8 inline-block rounded-xl bg-saffron px-6 py-3 font-semibold text-paper-ink">
        Haggle something new
      </Link>

      <ul className="mt-10 divide-y divide-line">
        {data.deals.map((d) => (
          <li key={d.id}>
            <Link href={`/deal/${d.id}`} className="flex items-baseline justify-between gap-6 py-4 hover:text-saffron">
              <span>
                {shortTitle(d.product.title)}
                <span className="block text-sm text-muted">{STATUS[d.status]}</span>
              </span>
              <span className="shrink-0 text-right tabular-nums">
                {inr(d.dealPrice)}
                {d.status === "paid" && <span className="block text-sm text-saffron">−{inr(d.saved)}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <YourData onDeleted={() => setDeleted(true)} />
    </div>
  );
}
