"use client";

import { resolvePolicy, termsFromPolicy, type DiscountPolicy } from "@ghostcart/core";
import { inr } from "@/lib/format";

export const field =
  "rounded-xl border border-line bg-panel px-4 py-3 text-fg placeholder:text-muted/60 focus:border-saffron focus:outline-none disabled:opacity-60";
export const primary = "rounded-xl bg-saffron px-6 py-3.5 text-lg font-semibold text-paper-ink disabled:opacity-50";
export const secondary = "rounded-xl border border-line px-4 py-2.5 hover:border-saffron disabled:opacity-50";

export async function api<T = Record<string, unknown>>(path: string, init?: { method?: string; body?: unknown }): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const res = await fetch(path, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: res.status, error: data.error || "Something went wrong. Try again." };
  return { ok: true, data };
}

/** "On ₹20,000 your agent drops to ₹19,000 alone and asks you before going below that, never under ₹18,000." */
export function PolicyPreview({ levels, price }: { levels: Parameters<typeof resolvePolicy>[0]; price: number }) {
  const t = termsFromPolicy(resolvePolicy(levels), price, { sellerId: "", sellerName: "", category: "" });
  if (!t) return <p className="text-muted">Haggling is off: shoppers pay {inr(price)}.</p>;
  return (
    <p className="text-muted">
      On {inr(price)} your agent opens at <span className="text-fg">{inr(t.opening)}</span>, drops to <span className="text-fg">{inr(t.autoLimit)}</span> on
      its own, and asks you before going lower. It never goes under <span className="text-fg">{inr(t.floor)}</span>.
    </p>
  );
}

export type PolicyDraft = Partial<Record<keyof DiscountPolicy, string | boolean>>;

/** Draft form values ("" = inherit) to a policy. */
export function draftToPolicy(d: PolicyDraft): DiscountPolicy {
  const n = (v: string | boolean | undefined) => (v === undefined || v === "" || typeof v === "boolean" ? undefined : Number(v));
  return {
    enabled: typeof d.enabled === "boolean" ? d.enabled : undefined,
    maxDiscountPct: n(d.maxDiscountPct),
    autoApprovePct: n(d.autoApprovePct),
    floorPrice: n(d.floorPrice),
    maxRounds: n(d.maxRounds),
  };
}

export const policyToDraft = (p: DiscountPolicy | undefined): PolicyDraft => ({
  enabled: p?.enabled,
  maxDiscountPct: p?.maxDiscountPct?.toString() ?? "",
  autoApprovePct: p?.autoApprovePct?.toString() ?? "",
  floorPrice: p?.floorPrice?.toString() ?? "",
  maxRounds: p?.maxRounds?.toString() ?? "",
});

export function ErrorText({ children }: { children?: string }) {
  return children ? (
    <p role="alert" className="text-alarm">
      {children}
    </p>
  ) : null;
}
