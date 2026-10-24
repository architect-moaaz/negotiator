"use client";

import { useCallback, useEffect, useState } from "react";
import { inr } from "@/lib/format";
import type { Activity, PublicDeal, Stats, User } from "@/lib/types";

type AdminDeal = PublicDeal & { userId?: string; pinelabsOrderId?: string };
interface AdminData {
  stats: Stats;
  users: User[];
  activity: Activity[];
  deals: AdminDeal[];
}
type Tab = "users" | "activity" | "deals";

const TOKEN_KEY = "gc_admin_token";
const ist = (at: number) =>
  new Date(at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false, dateStyle: "medium", timeStyle: "medium" });

function downloadCsv(filename: string, rows: (string | number | undefined)[][]) {
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

export function AdminConsole() {
  const [token, setToken] = useState("");
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("users");

  const load = useCallback(async (t: string) => {
    const res = await fetch("/api/admin/logs", { headers: { Authorization: `Bearer ${t}` }, cache: "no-store" });
    if (!res.ok) {
      setData(null);
      setError(res.status === 401 ? "That admin token isn't valid." : "Couldn't load logs.");
      return;
    }
    setError("");
    setData(await res.json());
    try {
      sessionStorage.setItem(TOKEN_KEY, t);
    } catch {}
  }, []);

  useEffect(() => {
    let saved = "";
    try {
      saved = sessionStorage.getItem(TOKEN_KEY) ?? "";
    } catch {}
    if (!saved) return;
    const t = setTimeout(() => {
      setToken(saved);
      load(saved);
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    if (!data) return;
    const t = setInterval(() => load(token), 10_000);
    return () => clearInterval(t);
  }, [data, token, load]);

  if (!data) {
    return (
      <form
        className="mx-auto mt-24 flex w-full max-w-sm flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          load(token);
        }}
      >
        <h1 className="text-2xl font-semibold">Proof of life</h1>
        <label htmlFor="admin-token" className="text-muted">
          Admin token
        </label>
        <input
          id="admin-token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="rounded-xl border border-line bg-panel px-4 py-3 focus:border-saffron focus:outline-none"
        />
        <button className="rounded-xl bg-saffron px-4 py-3 font-semibold text-paper-ink">Open logs</button>
        {error && <p role="alert" className="text-alarm">{error}</p>}
      </form>
    );
  }

  const usersById = new Map(data.users.map((u) => [u.id, u]));
  const exportTab = () => {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    if (tab === "users")
      downloadCsv(`ghostcart-signups-${stamp}.csv`, [
        ["signed_up_at_ist", "signed_up_at_iso", "user_id", "name", "phone", "email", "channel", "city"],
        ...data.users.map((u) => [ist(u.createdAt), new Date(u.createdAt).toISOString(), u.id, u.name, u.phone, u.email, u.channel, u.city]),
      ]);
    if (tab === "activity")
      downloadCsv(`ghostcart-activity-${stamp}.csv`, [
        ["at_ist", "at_iso", "type", "actor", "user", "deal_id", "detail"],
        ...data.activity.map((a) => [ist(a.at), new Date(a.at).toISOString(), a.type, a.actor, a.userId ? usersById.get(a.userId)?.name ?? a.userId : "", a.dealId, a.detail]),
      ]);
    if (tab === "deals")
      downloadCsv(`ghostcart-deals-${stamp}.csv`, [
        ["created_at_ist", "deal_id", "user", "product", "seller", "original_price", "deal_price", "saved", "lock_fee", "status", "pinelabs_order_id", "channel", "city"],
        ...data.deals.map((d) => [ist(d.createdAt), d.id, d.userId ? usersById.get(d.userId)?.name ?? d.userId : "", d.product.title, d.product.seller, d.originalPrice, d.dealPrice, d.saved, d.lockFee, d.status, d.pinelabsOrderId, d.channel, d.city]),
      ]);
  };

  const tabs: [Tab, string, number][] = [
    ["users", "Signups", data.users.length],
    ["activity", "Agent & payment log", data.activity.length],
    ["deals", "Deals", data.deals.length],
  ];

  return (
    <div className="mx-auto w-full max-w-6xl">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Proof of life</h1>
          <p className="mt-1 text-muted">
            {data.stats.users} shoppers · {data.stats.deals} deals negotiated · {data.stats.paid} locked · {inr(data.stats.saved)} saved
          </p>
        </div>
        <button onClick={exportTab} className="rounded-xl border border-line px-4 py-2.5 hover:border-saffron">
          Download CSV
        </button>
      </header>

      <div role="tablist" className="mt-8 flex gap-6 border-b border-line">
        {tabs.map(([key, label, count]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 pb-3 ${tab === key ? "border-saffron text-fg" : "border-transparent text-muted hover:text-fg"}`}
          >
            {label} <span className="text-muted tabular-nums">{count}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[44rem] text-left text-sm">
          <tbody className="divide-y divide-line">
            {tab === "users" &&
              data.users.map((u) => (
                <tr key={u.id}>
                  <td className="whitespace-nowrap py-3 pr-4 text-muted tabular-nums">{ist(u.createdAt)}</td>
                  <td className="py-3 pr-4">{u.name}</td>
                  <td className="py-3 pr-4 tabular-nums">{u.phone}</td>
                  <td className="py-3 pr-4 text-muted">{u.channel}</td>
                  <td className="py-3 text-muted">{u.city}</td>
                </tr>
              ))}
            {tab === "activity" &&
              data.activity.map((a, i) => (
                <tr key={`${a.at}-${i}`}>
                  <td className="whitespace-nowrap py-3 pr-4 text-muted tabular-nums">{ist(a.at)}</td>
                  <td className="whitespace-nowrap py-3 pr-4">{a.type.replace(/_/g, " ")}</td>
                  <td className="py-3 pr-4 text-muted">{a.actor}</td>
                  <td className="py-3 pr-4 text-muted">{a.userId ? usersById.get(a.userId)?.name : ""}</td>
                  <td className="py-3">{a.detail}</td>
                </tr>
              ))}
            {tab === "deals" &&
              data.deals.map((d) => (
                <tr key={d.id}>
                  <td className="whitespace-nowrap py-3 pr-4 text-muted tabular-nums">{ist(d.createdAt)}</td>
                  <td className="py-3 pr-4">{d.product.title}</td>
                  <td className="py-3 pr-4 text-muted">{d.userId ? usersById.get(d.userId)?.name : ""}</td>
                  <td className="whitespace-nowrap py-3 pr-4 tabular-nums">
                    {inr(d.dealPrice)} <s className="text-muted">{inr(d.originalPrice)}</s>
                  </td>
                  <td className={`py-3 ${d.status === "paid" ? "text-paid" : "text-muted"}`}>{d.status}</td>
                </tr>
              ))}
          </tbody>
        </table>
        {tabs.find(([k]) => k === tab)![2] === 0 && <p className="py-8 text-muted">Nothing here yet.</p>}
      </div>
    </div>
  );
}
