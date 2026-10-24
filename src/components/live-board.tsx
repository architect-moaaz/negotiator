"use client";

import { useEffect, useState } from "react";
import { inr, timeAgo } from "@/lib/format";
import { useTicker } from "./use-ticker";

const GOAL = 20;

export function LiveBoard() {
  const data = useTicker(3000);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 5000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);

  const stats = data?.stats ?? { users: 0, deals: 0, paid: 0, saved: 0 };
  const events = data?.events ?? [];
  const progress = Math.min(1, stats.users / GOAL);

  return (
    <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-12 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <section className="space-y-10">
        <div>
          <p className="text-muted">Shoppers today</p>
          <p className="font-receipt text-[clamp(3.5rem,9vw,6.5rem)] font-semibold leading-none tabular-nums">
            {stats.users}
            <span className="text-muted/40">/{GOAL}</span>
          </p>
          {stats.users >= GOAL && <p className="mt-2 text-paid">Goal reached</p>}
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={stats.users} aria-valuemax={GOAL} aria-label="Progress to 20 shoppers">
            <div className="h-full bg-saffron transition-[width] duration-700" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-6">
          <div>
            <dt className="text-muted">Deals locked</dt>
            <dd className="mt-1 text-3xl font-semibold tabular-nums">{stats.paid}</dd>
          </div>
          <div>
            <dt className="text-muted">Shoppers saved</dt>
            <dd className="mt-1 text-3xl font-semibold text-saffron tabular-nums">{inr(stats.saved)}</dd>
          </div>
          <div>
            <dt className="text-muted">Deals negotiated</dt>
            <dd className="mt-1 text-3xl font-semibold tabular-nums">{stats.deals}</dd>
          </div>
        </dl>
      </section>

      <section aria-live="polite">
        <h1 className="text-2xl font-semibold">Just grabbed</h1>
        {events.length === 0 ? (
          <p className="mt-6 max-w-md text-muted">
            No deals locked yet. Paste a product link on the home page and the first one shows up here within seconds.
          </p>
        ) : (
          <ol className="mt-6 divide-y divide-line">
            {events.map((e, i) => (
              <li key={e.id} className={`flex items-baseline justify-between gap-6 py-4 ${i === 0 ? "print-line" : ""}`}>
                <span className={i === 0 ? "text-lg" : "text-muted"}>{e.message}</span>
                <span className="shrink-0 text-right text-sm text-muted tabular-nums">
                  <span className="block text-saffron">−{inr(e.saved)}</span>
                  {now > 0 && timeAgo(e.at, now)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
