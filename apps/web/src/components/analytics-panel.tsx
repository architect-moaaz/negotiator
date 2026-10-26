"use client";

import { useCallback, useEffect, useState } from "react";
import type { Analytics, Bucket } from "@/lib/analytics";
import type { RecoveryStats } from "@/lib/privilege/stats";
import { inr } from "@/lib/format";

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}
    </div>
  );
}

/** Horizontal bars, one hue, every bar direct-labelled; hover gives the share. */
function BarList({ title, data, note }: { title: string; data: Bucket[]; note?: string }) {
  const total = data.reduce((s, b) => s + b.value, 0);
  const max = Math.max(1, ...data.map((b) => b.value));
  return (
    <section className="rounded-2xl border border-line p-4">
      <h3 className="font-semibold">{title}</h3>
      {note && <p className="text-sm text-muted">{note}</p>}
      {total === 0 ? (
        <p className="mt-3 text-sm text-muted">No data yet.</p>
      ) : (
        <ul className="mt-3 space-y-2" role="list">
          {data.map((b) => (
            <li key={b.label} title={`${b.label}: ${b.value} (${Math.round((b.value / total) * 100)}%)`} className="group">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate">{b.label}</span>
                <span className="shrink-0 tabular-nums text-muted">
                  {b.value} · {Math.round((b.value / total) * 100)}%
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-line/60">
                <div className="h-full rounded-full bg-saffron transition-opacity group-hover:opacity-80" style={{ width: `${(b.value / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 24 columns for hour of day (IST); labels every 6 hours, exact count on hover. */
function HourChart({ title, data }: { title: string; data: Bucket[] }) {
  const max = Math.max(1, ...data.map((b) => b.value));
  const total = data.reduce((s, b) => s + b.value, 0);
  const peak = data.reduce((a, b) => (b.value > a.value ? b : a), data[0]);
  return (
    <section className="rounded-2xl border border-line p-4">
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-muted">{total ? `Busiest: ${peak.label}:00–${peak.label}:59 IST (${peak.value})` : "No data yet."}</p>
      <div className="mt-4 flex h-28 items-end gap-[2px]" role="img" aria-label={`${title}: ${data.map((b) => `${b.label}h ${b.value}`).join(", ")}`}>
        {data.map((b) => (
          <div key={b.label} title={`${b.label}:00 IST: ${b.value}`} className="group flex h-full flex-1 items-end">
            <div
              className={`w-full rounded-t-[4px] ${b.value ? "bg-saffron group-hover:opacity-80" : "bg-line/50"}`}
              style={{ height: `${b.value ? Math.max(6, (b.value / max) * 100) : 3}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted tabular-nums">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
    </section>
  );
}

function Funnel({ data, title = "Conversion funnel" }: { data: Bucket[]; title?: string }) {
  const top = Math.max(1, data[0]?.value ?? 1);
  return (
    <section className="rounded-2xl border border-line p-4">
      <h3 className="font-semibold">{title}</h3>
      <ol className="mt-3 space-y-3">
        {data.map((step, i) => {
          const prev = i ? data[i - 1].value : 0;
          const stepRate = i && prev ? Math.round((step.value / prev) * 100) : null;
          return (
            <li key={step.label} title={`${step.label}: ${step.value}${stepRate !== null ? ` (${stepRate}% of previous step)` : ""}`}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span>{step.label}</span>
                <span className="tabular-nums text-muted">
                  {step.value}
                  {stepRate !== null && ` · ${stepRate}% of previous`}
                </span>
              </div>
              <div className="mt-1 h-3 rounded-full bg-line/60">
                <div className="h-full rounded-full bg-saffron" style={{ width: `${Math.max(step.value ? 2 : 0, (step.value / top) * 100)}%` }} />
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const secs = (s: number | null) => (s === null ? "—" : s < 90 ? `${s}s` : `${Math.round(s / 60)}m`);

export function AnalyticsPanel() {
  const [data, setData] = useState<(Analytics & { recovery?: RecoveryStats }) | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/analytics", { cache: "no-store" });
    if (!res.ok) return setError("Couldn't load analytics.");
    setError("");
    setData(await res.json());
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(load, 15000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  if (error) return <p className="mt-6 text-alarm">{error}</p>;
  if (!data) return <p className="mt-6 text-muted">Crunching numbers…</p>;
  const k = data.kpis;
  const a = data.approvals;

  return (
    <div className="mt-6 space-y-10">
      <section>
        <h2 className="text-lg font-semibold">Headline</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Unique visitors" value={String(k.visitors)} sub={`${k.visitorToShopperPct}% signed up`} />
          <Tile label="Shoppers" value={String(k.shoppers)} sub={`${k.shopperToLockedPct}% locked a deal`} />
          <Tile label="Negotiations" value={String(k.negotiations)} sub={`${k.avgRounds} ${k.avgRounds === 1 ? "counter-offer" : "counter-offers"} on average`} />
          <Tile label="Deals locked" value={String(k.locked)} sub={`${k.expiredPct}% of deals expired`} />
          <Tile label="Deal value locked" value={inr(k.gmv)} sub="sum of agreed prices" />
          <Tile label="Shoppers saved" value={inr(k.saved)} sub={`${k.avgDiscountPct}% off list on average`} />
          <Tile label="Lock-fee revenue" value={inr(k.lockRevenue)} sub="₹9 UPI locks (test mode)" />
          <Tile label="Time to pay" value={secs(k.medianSecondsToPay)} sub="median, agreed → paid" />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Funnel data={data.funnel} />
        <section className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Tile label="Escalated to a human" value={String(a.escalations)} sub={`${a.escalationRatePct}% of negotiations`} />
            <Tile label="Human decision time" value={secs(a.avgDecisionSeconds)} sub="average" />
            <Tile label="Reviewed by AgenticOrg" value={`${a.agentReviewedPct}%`} sub="of escalations" />
            <Tile label="Humans followed the agent" value={`${a.humansFollowedAgentPct}%`} sub={`${a.voiceCalls} approval calls placed`} />
          </div>
        </section>
      </div>

      <section>
        <h2 className="text-lg font-semibold">Shopper demographics</h2>
        <p className="text-sm text-muted">From IP location, device and the link they arrived on. We don&apos;t ask for age or gender.</p>
        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <BarList title="City" data={data.demographics.city} />
          <BarList title="State / region" data={data.demographics.region} />
          <BarList title="Country" data={data.demographics.country} />
          <BarList title="Device" data={data.demographics.device} />
          <BarList title="Operating system" data={data.demographics.os} />
          <BarList title="Browser" data={data.demographics.browser} />
          <BarList title="Language" data={data.demographics.language} />
          <BarList title="Came from" data={data.demographics.source} note="?ref= tag, referring site, or direct" />
          <BarList title="Channel" data={data.demographics.channel} />
          <BarList title="Returning shoppers" data={data.demographics.returning} />
          <HourChart title="Signups by hour (IST)" data={data.demographics.signupHour} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Visitors (everyone, signed up or not)</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
          <BarList title="Landing visitors by device" data={data.visitors.device} />
          <BarList title="Landing visitors by city" data={data.visitors.city} />
          <BarList title="Pages viewed" data={data.visitors.pages} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Deals</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <BarList title="Deal status" data={data.commerce.status} />
          <BarList title="Category" data={data.commerce.category} />
          <BarList title="Marketplace" data={data.commerce.marketplace} />
          <BarList title="Discount funded by" data={data.commerce.fundedBy} />
          <BarList title="Most haggled products" data={data.commerce.topProducts} />
          <HourChart title="Negotiations by hour (IST)" data={data.commerce.dealHour} />
        </div>
      </section>

      {data.recovery && (
        <section>
          <h2 className="text-lg font-semibold">GhostCart Privilege (cart recovery, last 30 days)</h2>
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Funnel
              title="Recovery funnel"
              data={[
                { label: "Carts captured", value: data.recovery.captured },
                { label: "Abandoned", value: data.recovery.abandoned },
                { label: "Private offers sent", value: data.recovery.invited },
                { label: "Offers opened", value: data.recovery.opened },
                { label: "Recovered", value: data.recovery.recovered },
              ]}
            />
            <div className="grid grid-cols-2 content-start gap-4">
              <Tile label="Recovered sales" value={inr(data.recovery.recoveredValue)} sub={`from ${inr(data.recovery.listValue)} of carts at list`} />
              <Tile label="Shoppers who opted in" value={String(data.recovery.withConsent)} sub={`${data.recovery.optedOut} stopped offers`} />
              <BarList title="Offers sent by" data={Object.entries(data.recovery.invitesByChannel).map(([label, value]) => ({ label, value }))} />
            </div>
          </div>
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold">Human approvals</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
          <BarList title="Decisions" data={a.decisions} />
          <BarList title="Decided via" data={a.channel} />
        </div>
      </section>
    </div>
  );
}
