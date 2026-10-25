"use client";

import { useCallback, useEffect, useState } from "react";
import { inr } from "@/lib/format";
import { FULFILMENT_STAGES } from "@/lib/fulfilment";
import type { Activity, AgentRecommendation, DeliveryAddress, NegotiationTerms, PublicDeal, Seller, SellerDemand, Stats, User } from "@/lib/types";
import { AnalyticsPanel } from "./analytics-panel";
import { StaffLogin, staffLogout } from "./staff-login";
import { RecommendationCard, recommendationButtonLabel } from "./recommendation-card";
import { DisputesPanel } from "./disputes-panel";
import { FinancePanel } from "./finance-panel";
import { FraudPanel } from "./fraud-panel";
import { ReviewsPanel } from "./reviews-panel";

type AdminDeal = PublicDeal & {
  userId?: string;
  pinelabsOrderId?: string;
  terms?: NegotiationTerms;
  recommendation?: AgentRecommendation;
  address?: DeliveryAddress;
};

/** The order's current delivery stage and the one it moves to next. */
function orderStage(d: AdminDeal) {
  const i = FULFILMENT_STAGES.findIndex((s) => s.stage === d.checkout?.tracking?.at(-1)?.stage);
  return { current: FULFILMENT_STAGES[i], next: i >= 0 ? FULFILMENT_STAGES[i + 1] : undefined };
}
interface AdminData {
  me: { name: string; role: string };
  stats: Stats;
  users: User[];
  activity: Activity[];
  deals: AdminDeal[];
  sellers: Seller[];
  demand: SellerDemand[];
}
type Tab = "analytics" | "approvals" | "reviews" | "disputes" | "fraud" | "money" | "users" | "activity" | "deals" | "sellers";

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
  // undefined = still checking the staff session
  const [data, setData] = useState<AdminData | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("approvals");
  const [deciding, setDeciding] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/logs", { cache: "no-store" });
    if (!res.ok) {
      setData(null);
      setError(res.status === 401 ? "" : ((await res.json().catch(() => ({}))).error ?? "Couldn't load logs."));
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
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [data, load]);

  if (data === undefined) return <p className="mt-24 text-center text-muted">Checking your staff session…</p>;
  if (!data) return <StaffLogin title="Proof of life" error={error} onDone={load} />;

  const usersById = new Map(data.users.map((u) => [u.id, u]));
  const approvals = data.deals.filter((d) => d.status === "awaiting_approval");

  async function askAgent(id: string) {
    setDeciding(id);
    setReviewNote((r) => ({ ...r, [id]: "Asking the AgenticOrg agent…" }));
    const res = await fetch("/api/admin/agent-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const body = await res.json().catch(() => ({}));
    setReviewNote((r) => ({ ...r, [id]: res.ok ? (body.recommendation ? "" : `Agent replied without a recommendation: ${String(body.agentReply).slice(0, 200)}`) : body.error }));
    setDeciding(null);
    load();
  }

  async function decide(id: string, decision: "approved" | "rejected" | "recommendation") {
    setDeciding(id);
    await fetch("/api/admin/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, decision }),
    });
    setDeciding(null);
    load();
  }
  async function advance(d: AdminDeal) {
    const { next } = orderStage(d);
    if (!next) return;
    let courier: string | undefined, awb: string | undefined;
    if (next.stage === "shipped") {
      courier = window.prompt("Courier (e.g. Delhivery)") ?? undefined;
      awb = window.prompt("AWB / tracking number") ?? undefined;
    }
    setDeciding(d.id);
    const res = await fetch("/api/admin/fulfil", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: d.id, courier, awb }),
    });
    if (!res.ok) window.alert((await res.json().catch(() => ({}))).error ?? "Couldn't update the order.");
    setDeciding(null);
    load();
  }

  const exportTab = () => {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    if (tab === "users")
      downloadCsv(`ghostcart-signups-${stamp}.csv`, [
        ["signed_up_at_ist", "signed_up_at_iso", "user_id", "name", "phone", "email", "channel", "city", "contact_consent_at_ist"],
        ...data.users.map((u) => [ist(u.createdAt), new Date(u.createdAt).toISOString(), u.id, u.name, u.phone, u.email, u.channel, u.city, u.consentAt ? ist(u.consentAt) : ""]),
      ]);
    if (tab === "activity")
      downloadCsv(`ghostcart-activity-${stamp}.csv`, [
        ["at_ist", "at_iso", "type", "actor", "user", "deal_id", "detail"],
        ...data.activity.map((a) => [ist(a.at), new Date(a.at).toISOString(), a.type, a.actor, a.userId ? usersById.get(a.userId)?.name ?? a.userId : "", a.dealId, a.detail]),
      ]);
    if (tab === "deals")
      downloadCsv(`ghostcart-deals-${stamp}.csv`, [
        ["created_at_ist", "deal_id", "user", "product", "seller", "original_price", "deal_price", "saved", "lock_fee", "status", "pinelabs_order_id", "channel", "city", "checkout", "order_ref", "order_stage", "ship_to"],
        ...data.deals.map((d) => [
          ist(d.createdAt),
          d.id,
          d.userId ? usersById.get(d.userId)?.name ?? d.userId : "",
          d.product.title,
          d.product.seller,
          d.originalPrice,
          d.dealPrice,
          d.saved,
          d.lockFee,
          d.status,
          d.pinelabsOrderId,
          d.channel,
          d.city,
          d.checkout?.status,
          d.checkout?.orderRef,
          orderStage(d).current?.label,
          d.address && `${d.address.name}, ${d.address.line1}, ${d.address.city} ${d.address.pincode}`,
        ]),
      ]);
  };

  const tabs: [Tab, string, number | null][] = [
    ["analytics", "Analytics", null],
    ["approvals", "Approvals", approvals.length],
    ["reviews", "Seller reviews", null],
    ["disputes", "Disputes", null],
    ["fraud", "Fraud", null],
    ...(data.me.role === "owner" ? ([["money", "Money", null]] as [Tab, string, null][]) : []),
    ["users", "Signups", data.users.length],
    ["activity", "Agent & payment log", data.activity.length],
    ["deals", "Deals", data.deals.length],
    ["sellers", "Sellers", data.sellers.length],
  ];

  return (
    <div className="mx-auto w-full max-w-6xl">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Proof of life</h1>
          <p className="mt-1 text-sm text-muted">
            Signed in as {data.me.name} ({data.me.role}).{" "}
            <button
              onClick={async () => {
                await staffLogout();
                setData(null);
              }}
              className="underline underline-offset-4 hover:text-fg"
            >
              Log out
            </button>
          </p>
          <p className="mt-1 text-muted">
            {data.stats.users} shoppers · {data.stats.deals} deals negotiated · {data.stats.paid} locked · {inr(data.stats.saved)} saved
          </p>
        </div>
        {!["approvals", "reviews", "disputes", "fraud", "money", "sellers", "analytics"].includes(tab) && (
          <button onClick={exportTab} className="rounded-xl border border-line px-4 py-2.5 hover:border-saffron">
            Download CSV
          </button>
        )}
      </header>

      <div role="tablist" className="mt-8 flex gap-6 overflow-x-auto border-b border-line">
        {tabs.map(([key, label, count]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`-mb-px shrink-0 border-b-2 pb-3 ${tab === key ? "border-saffron text-fg" : "border-transparent text-muted hover:text-fg"}`}
          >
            {label} {count !== null && <span className="text-muted tabular-nums">{count}</span>}
          </button>
        ))}
      </div>

      {tab === "analytics" && <AnalyticsPanel />}
      {tab === "reviews" && <ReviewsPanel />}
      {tab === "money" && <FinancePanel />}
      {tab === "disputes" && <DisputesPanel />}
      {tab === "fraud" && <FraudPanel />}

      {tab === "approvals" && (
        <div className="mt-6 space-y-4">
          {approvals.length === 0 && <p className="py-6 text-muted">No offers waiting. When a shopper pushes below the agent&apos;s limit, it shows up here.</p>}
          {approvals.map((d) => {
            const price = d.negotiation?.approvalPrice ?? 0;
            const t = d.terms;
            return (
              <article key={d.id} className="rounded-2xl border border-saffron/60 p-5">
                <p className="text-lg font-semibold">{d.product.title}</p>
                {t?.fundedBy === "seller" && <p className="text-sm text-saffron">Seller-funded: {t.sellerName} can approve this from their dashboard too</p>}
                <p className="mt-1 text-muted">
                  {d.userId ? usersById.get(d.userId)?.name : "Shopper"} wants it for <span className="text-fg">{inr(price)}</span>
                  {t && (
                    <>
                      {" "}
                      · best market {inr(t.benchmark)} · agent limit {inr(t.autoLimit)} · floor {inr(t.floor)} · margin left after deal{" "}
                      {inr(price - t.floor)}
                    </>
                  )}
                </p>
                {d.recommendation && <RecommendationCard rec={d.recommendation} shopperOffer={price} />}
                {reviewNote[d.id] && <p className="mt-2 text-sm text-muted">{reviewNote[d.id]}</p>}
                <div className="mt-4 flex flex-wrap gap-3">
                  {d.recommendation && (
                    <button
                      disabled={deciding === d.id}
                      onClick={() => decide(d.id, "recommendation")}
                      className="rounded-xl bg-saffron px-5 py-2.5 font-semibold text-paper-ink disabled:opacity-50"
                    >
                      {recommendationButtonLabel(d.recommendation, price)}
                    </button>
                  )}
                  <button
                    disabled={deciding === d.id}
                    onClick={() => decide(d.id, "approved")}
                    className="rounded-xl bg-paid px-5 py-2.5 font-semibold text-paper-ink disabled:opacity-50"
                  >
                    Approve {inr(price)}
                  </button>
                  <button
                    disabled={deciding === d.id}
                    onClick={() => decide(d.id, "rejected")}
                    className="rounded-xl border border-line px-5 py-2.5 hover:border-alarm disabled:opacity-50"
                  >
                    Reject
                  </button>
                  {!d.recommendation && (
                    <button
                      disabled={deciding === d.id}
                      onClick={() => askAgent(d.id)}
                      className="rounded-xl border border-line px-5 py-2.5 hover:border-saffron disabled:opacity-50"
                    >
                      Ask AgenticOrg agent
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {tab === "sellers" && (
        <div className="mt-6 grid grid-cols-1 gap-10 lg:grid-cols-2">
          <section>
            <h2 className="text-lg font-semibold">Sellers shoppers want</h2>
            <p className="mt-1 text-sm text-muted">From &ldquo;Sold by&rdquo; on every pasted listing. Reach out to the top ones.</p>
            {data.demand.length === 0 && <p className="py-6 text-muted">No listings with a seller yet.</p>}
            <ol className="mt-3 divide-y divide-line">
              {data.demand.map((d) => (
                <li key={d.key} className="flex items-baseline justify-between gap-4 py-3">
                  <span>
                    {d.name} <span className="text-muted">· {d.marketplace}</span>
                    {d.registered && <span className="text-paid"> · on GhostCart</span>}
                  </span>
                  <span className="tabular-nums text-muted">
                    {d.count} {d.count === 1 ? "shopper" : "shoppers"}
                  </span>
                </li>
              ))}
            </ol>
          </section>
          <section>
            <h2 className="text-lg font-semibold">Registered sellers</h2>
            {data.sellers.length === 0 && <p className="py-6 text-muted">No sellers yet. Share /sell with merchants.</p>}
            <ul className="mt-3 divide-y divide-line">
              {data.sellers.map((s) => (
                <li key={s.id} className="py-3">
                  <p>{s.storeName}</p>
                  <p className="text-sm text-muted">
                    up to {(s.budgetPct * 100).toFixed(0)}% off · auto {(s.autoApproveShare * 100).toFixed(0)}% · {s.contactName} {s.phone} · matches {s.aliases.join(", ")}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

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
                  <td className="py-3 pr-4 text-muted">{u.consentAt ? "consented" : "no consent"}</td>
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
                  <td className={`py-3 pr-4 ${d.status === "paid" ? "text-paid" : "text-muted"}`}>
                    {d.checkout?.status === "ordered" ? orderStage(d).current?.label : d.checkout ? `checkout ${d.checkout.status}` : d.status}
                    {d.address && (
                      <span className="block text-xs text-muted">
                        {d.address.name} · {d.address.phone} · {d.address.line1}
                        {d.address.line2 ? `, ${d.address.line2}` : ""}, {d.address.city} {d.address.pincode}
                      </span>
                    )}
                  </td>
                  <td className="py-3">
                    {orderStage(d).next && (
                      <button
                        onClick={() => advance(d)}
                        disabled={deciding === d.id}
                        className="whitespace-nowrap rounded-lg border border-line px-3 py-1.5 hover:border-saffron disabled:opacity-50"
                      >
                        Mark {orderStage(d).next!.label.toLowerCase()}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {!["approvals", "reviews", "disputes", "fraud", "money", "sellers", "analytics"].includes(tab) && tabs.find(([k]) => k === tab)![2] === 0 && <p className="py-8 text-muted">Nothing here yet.</p>}
      </div>
    </div>
  );
}
