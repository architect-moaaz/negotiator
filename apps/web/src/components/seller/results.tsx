"use client";

import { useEffect, useState } from "react";
import { inr } from "@/lib/format";
import type { SellerResults } from "@/lib/shop/results";
import { api } from "./ui";

interface Day {
  day: string;
  negotiations: number;
  agreed: number;
  agreedValue: number;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}
    </div>
  );
}

/** What selling through haggles did for the store: sales, the discounts that bought them, fees, what's kept. */
export function ResultsTab({ storeId }: { storeId: string }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<{ from: string; to: string; results: SellerResults; days: Day[] } | null>(null);
  useEffect(() => {
    let live = true;
    api<{ from: string; to: string; results: SellerResults; days: Day[] }>(`/api/seller/stores/${storeId}/metrics?days=${days}`).then((r) => live && r.ok && setData(r.data));
    return () => {
      live = false;
    };
  }, [storeId, days]);

  if (!data) return <p className="mt-6 text-muted">Loading…</p>;
  const r = data.results;
  return (
    <div className="mt-6 grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted">
          {data.from} to {data.to} (IST, updated nightly)
        </p>
        <div role="group" aria-label="Period" className="flex gap-2">
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)} aria-pressed={days === d} className={`rounded-full border px-3 py-1 text-sm ${days === d ? "border-saffron text-fg" : "border-line text-muted"}`}>
              {d} days
            </button>
          ))}
        </div>
      </div>
      {!r.haggles ? (
        <p className="text-muted">No haggles in this period yet. Your results appear the day after your first one.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Tile label="Sales from haggles" value={inr(r.sales)} sub={`${r.deals} deals from ${r.haggles} haggles (${pct(r.agreeRate)})`} />
            <Tile label="Discounts you gave" value={inr(r.discounts)} sub={`${pct(r.averageDiscount)} off list on average`} />
            <Tile label="Closed by your agent" value={String(r.closedByAgent)} sub={`${r.cameToYou} came to you for a decision`} />
            <Tile label="Kept from GhostCart orders" value={inr(r.keptFromGhostCartOrders)} sub={`${inr(r.paidOnGhostCart)} paid, less ${inr(r.fees)} fees and ${inr(r.refunds)} refunds`} />
          </div>
          <p className="max-w-2xl text-sm text-muted">
            Sales count every agreed haggle, paid on GhostCart or on your own checkout. Fees on your own checkout&apos;s sales come on your monthly GhostCart invoice.
            {r.disputes ? ` ${r.disputes} order${r.disputes === 1 ? "" : "s"} had a buyer problem reported.` : ""}
          </p>
          <table className="w-full max-w-2xl text-sm">
            <caption className="mb-2 text-left font-semibold">By day</caption>
            <thead className="text-muted">
              <tr>
                <th className="py-1 text-left font-normal">Day</th>
                <th className="py-1 text-right font-normal">Haggles</th>
                <th className="py-1 text-right font-normal">Deals</th>
                <th className="py-1 text-right font-normal">Sales</th>
              </tr>
            </thead>
            <tbody>
              {[...data.days].reverse().map((d) => (
                <tr key={d.day} className="border-t border-line">
                  <td className="py-1">{d.day}</td>
                  <td className="py-1 text-right tabular-nums">{d.negotiations}</td>
                  <td className="py-1 text-right tabular-nums">{d.agreed}</td>
                  <td className="py-1 text-right tabular-nums">{inr(Math.round(d.agreedValue / 100))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
