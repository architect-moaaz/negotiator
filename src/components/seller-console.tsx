"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { inr } from "@/lib/format";
import type { AgentRecommendation, NegotiationTerms, PublicDeal } from "@/lib/types";
import { PhoneLogin } from "./phone-login";
import { RecommendationCard, recommendationButtonLabel } from "./recommendation-card";

interface SellerData {
  seller: { storeName: string; aliases: string[]; budgetPct: number; autoApproveShare: number };
  deals: (PublicDeal & { terms?: NegotiationTerms; recommendation?: AgentRecommendation })[];
}

const TOKEN_KEY = "gc_seller_token";

export function SellerConsole() {
  const [token, setToken] = useState("");
  const [data, setData] = useState<SellerData | null>(null);
  const [error, setError] = useState("");
  const [deciding, setDeciding] = useState<string | null>(null);
  const [useKey, setUseKey] = useState(false);
  const [checked, setChecked] = useState(false);

  const load = useCallback(async (t: string) => {
    const res = await fetch("/api/seller/me", { headers: t ? { Authorization: `Bearer ${t}` } : {}, cache: "no-store" });
    setChecked(true);
    if (!res.ok) {
      setData(null);
      if (t) setError(res.status === 401 ? "That seller key isn't valid." : "Couldn't load your dashboard.");
      return;
    }
    setError("");
    setData(await res.json());
    if (t) {
      try {
        sessionStorage.setItem(TOKEN_KEY, t);
      } catch {}
    }
  }, []);

  useEffect(() => {
    let saved = "";
    try {
      saved = sessionStorage.getItem(TOKEN_KEY) ?? "";
    } catch {}
    const t = setTimeout(() => {
      setToken(saved);
      load(saved); // empty key: the session cookie from phone login or signup is used
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    if (!data) return;
    const t = setInterval(() => load(token), 3000);
    return () => clearInterval(t);
  }, [data, token, load]);

  async function decide(id: string, decision: "approved" | "rejected" | "recommendation") {
    setDeciding(id);
    await fetch("/api/seller/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ id, decision }),
    });
    setDeciding(null);
    load(token);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "seller" }) });
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {}
    setToken("");
    setData(null);
  }

  if (!data) {
    if (!checked) return <p className="mt-24 text-center text-muted">Loading…</p>;
    return (
      <div className="mx-auto mt-16 flex w-full max-w-sm flex-col gap-4">
        <h1 className="text-2xl font-semibold">Seller dashboard</h1>
        {useKey ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              load(token);
            }}
          >
            <label htmlFor="seller-key" className="text-muted">
              Seller key
            </label>
            <input
              id="seller-key"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="rounded-xl border border-line bg-panel px-4 py-3 focus:border-saffron focus:outline-none"
            />
            <button className="rounded-xl bg-saffron px-4 py-3 font-semibold text-paper-ink">Open dashboard</button>
            {error && (
              <p role="alert" className="text-alarm">
                {error}
              </p>
            )}
          </form>
        ) : (
          <PhoneLogin role="seller" onDone={() => load("")} />
        )}
        <button type="button" onClick={() => setUseKey(!useKey)} className="text-left text-muted underline underline-offset-4">
          {useKey ? "Log in with your phone instead" : "Use your seller key instead"}
        </button>
        <p className="text-muted">
          Not on GhostCart yet?{" "}
          <Link href="/sell" className="text-fg underline underline-offset-4">
            Register your store
          </Link>
        </p>
      </div>
    );
  }

  const waiting = data.deals.filter((d) => d.status === "awaiting_approval");
  const closed = data.deals.filter((d) => d.status !== "awaiting_approval");

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-3xl font-semibold">{data.seller.storeName}</h1>
        <button onClick={logout} className="rounded-xl border border-line px-4 py-2.5 hover:border-alarm">
          Log out
        </button>
      </div>
      <p className="mt-1 text-muted">
        Agent gives up to {(data.seller.budgetPct * data.seller.autoApproveShare * 100).toFixed(1)}% off on its own and asks you up to{" "}
        {(data.seller.budgetPct * 100).toFixed(0)}% · matches {data.seller.aliases.join(", ")}
      </p>

      <h2 className="mt-10 text-xl font-semibold">Waiting for you</h2>
      {waiting.length === 0 && <p className="mt-3 text-muted">Nothing to approve. Offers below your agent&apos;s limit show up here instantly.</p>}
      <div className="mt-4 space-y-4">
        {waiting.map((d) => {
          const price = d.negotiation?.approvalPrice ?? 0;
          return (
            <article key={d.id} className="rounded-2xl border border-saffron/60 p-5">
              <p className="text-lg font-semibold">{d.product.title}</p>
              <p className="mt-1 text-muted">
                Shopper offers <span className="text-fg">{inr(price)}</span>
                {d.terms && (
                  <>
                    {" "}
                    · listed {inr(d.product.price)} · best market {inr(d.terms.benchmark)} · your floor {inr(d.terms.floor)}
                  </>
                )}
              </p>
              {d.recommendation && <RecommendationCard rec={d.recommendation} shopperOffer={price} />}
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
              </div>
            </article>
          );
        })}
      </div>

      <h2 className="mt-12 text-xl font-semibold">Your negotiations</h2>
      {closed.length === 0 ? (
        <p className="mt-3 text-muted">{waiting.length ? "No finished negotiations yet." : "No shoppers have haggled on your listings yet."}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {closed.map((d) => (
            <li key={d.id} className="flex items-baseline justify-between gap-6 py-3">
              <span>{d.product.title}</span>
              <span className="shrink-0 text-muted tabular-nums">
                {inr(d.dealPrice)} · {d.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
