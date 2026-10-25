"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { inr, timeAgo } from "@/lib/format";
import type { UserInsights } from "@/lib/insights";
import { StaffLogin } from "./staff-login";

const ist = (at: number) => new Date(at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false, dateStyle: "medium", timeStyle: "short" });

function downloadCsv(filename: string, rows: (string | number | undefined)[][]) {
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  Object.assign(document.createElement("a"), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel px-5 py-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 font-receipt text-3xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}
    </div>
  );
}

/** /userloggedin: how many shoppers logged in, and how far each got (negotiated, locked, bought, delivered). */
export function UserInsightsView() {
  // undefined = still checking the staff session
  const [data, setData] = useState<UserInsights | null | undefined>(undefined);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/users", { cache: "no-store" });
    if (!res.ok) {
      setData(null);
      setError(res.status === 401 ? "" : ((await res.json().catch(() => ({}))).error ?? "Couldn't load users."));
      return;
    }
    setError("");
    setData(await res.json());
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    return () => clearTimeout(first);
  }, [load]);

  useEffect(() => {
    if (!data) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [data, load]);

  if (data === undefined) return <p className="mt-24 text-center text-muted">Checking your staff session…</p>;
  if (!data) return <StaffLogin title="Users" error={error} onDone={load} />;

  const t = data.totals;
  const funnel: [string, number][] = [
    ["Signed up", t.users],
    ["Negotiated a deal", t.negotiated],
    ["Locked a price", t.locked],
    ["Bought", t.bought],
    ["Delivered", t.delivered],
  ];
  const pct = (n: number) => (t.users ? Math.round((n / t.users) * 100) : 0);

  const exportCsv = () =>
    downloadCsv(`ghostcart-users-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.csv`, [
      ["name", "phone", "channel", "city", "signed_up_ist", "logins", "last_login_ist", "last_seen_ist", "deals", "locked", "bought", "delivered", "spent_inr", "saved_inr"],
      ...data.users.map((u) => [
        u.name,
        u.phone,
        u.channel,
        u.city,
        ist(u.signedUpAt),
        u.logins,
        u.lastLoginAt && ist(u.lastLoginAt),
        u.lastSeenAt && ist(u.lastSeenAt),
        u.deals,
        u.locked,
        u.bought,
        u.delivered,
        u.spent,
        u.saved,
      ]),
    ]);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Users</h1>
          <p className="mt-1 text-muted">Live · updated {timeAgo(data.generatedAt)} · {ist(data.generatedAt)} IST</p>
        </div>
        <div className="flex gap-3">
          <Link href="/admin" className="rounded-xl border border-line px-4 py-2 hover:border-saffron">
            Admin
          </Link>
          <button onClick={exportCsv} className="rounded-xl border border-line px-4 py-2 hover:border-saffron">
            Export CSV
          </button>
        </div>
      </header>

      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Shoppers signed up" value={t.users} sub={`${t.logins} ${t.logins === 1 ? "login" : "logins"} in total`} />
        <Stat label="Logged in today" value={t.loggedInToday} sub={`${t.activeLastHour} active in the last hour`} />
        <Stat label="Bought" value={t.bought} sub={`${inr(t.orderValue)} in orders`} />
        <Stat label="Saved for shoppers" value={inr(t.saved)} sub={`${inr(t.lockFees)} in lock fees`} />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-label="Funnel">
          <h2 className="text-lg font-semibold">How far shoppers get</h2>
          <ul className="mt-4 space-y-3">
            {funnel.map(([label, n]) => (
              <li key={label}>
                <div className="flex justify-between text-sm">
                  <span>{label}</span>
                  <span className="tabular-nums text-muted">
                    {n} · {pct(n)}%
                  </span>
                </div>
                <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-line">
                  <div className="h-full rounded-full bg-saffron" style={{ width: `${pct(n)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Recent logins">
          <h2 className="text-lg font-semibold">Recent logins</h2>
          <ul className="mt-3 divide-y divide-line text-sm">
            {data.recentLogins.map((l, i) => (
              <li key={`${l.at}-${i}`} className="flex justify-between gap-3 py-2">
                <span>
                  {l.name} <span className="text-muted">{l.returning ? "came back" : "signed up"}</span>
                </span>
                <span className="whitespace-nowrap text-muted">{timeAgo(l.at)}</span>
              </li>
            ))}
            {!data.recentLogins.length && <li className="py-2 text-muted">No logins yet.</li>}
          </ul>
        </section>
      </div>

      <section className="mt-10" aria-label="All users">
        <h2 className="text-lg font-semibold">Every shopper</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-2 pr-4 font-normal">Shopper</th>
                <th className="py-2 pr-4 font-normal">Signed up</th>
                <th className="py-2 pr-4 font-normal">Logins</th>
                <th className="py-2 pr-4 font-normal">Last seen</th>
                <th className="py-2 pr-4 font-normal">Deals</th>
                <th className="py-2 pr-4 font-normal">Locked</th>
                <th className="py-2 pr-4 font-normal">Bought</th>
                <th className="py-2 pr-4 font-normal">Paid</th>
                <th className="py-2 font-normal">Saved</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.users.map((u) => (
                <tr key={u.id}>
                  <td className="py-3 pr-4">
                    {u.name}
                    <span className="block text-xs text-muted">
                      {u.phone} · {u.channel}
                      {u.city ? ` · ${u.city}` : ""}
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-3 pr-4 text-muted tabular-nums">{ist(u.signedUpAt)}</td>
                  <td className="py-3 pr-4 tabular-nums">{u.logins}</td>
                  <td className="whitespace-nowrap py-3 pr-4 text-muted">{u.lastSeenAt ? timeAgo(u.lastSeenAt) : "—"}</td>
                  <td className="py-3 pr-4 tabular-nums">{u.deals}</td>
                  <td className="py-3 pr-4 tabular-nums">{u.locked}</td>
                  <td className={`py-3 pr-4 tabular-nums ${u.bought ? "text-paid" : ""}`}>
                    {u.bought}
                    {u.delivered ? <span className="text-muted"> ({u.delivered} delivered)</span> : null}
                  </td>
                  <td className="py-3 pr-4 tabular-nums">{u.spent ? inr(u.spent) : "—"}</td>
                  <td className="py-3 tabular-nums">{u.saved ? inr(u.saved) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.users.length && <p className="py-8 text-muted">Nobody has signed up yet.</p>}
        </div>
      </section>
    </div>
  );
}
