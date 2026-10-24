"use client";

import { inr, shortTitle, timeAgo } from "@/lib/format";
import { useTicker } from "./use-ticker";

/**
 * Social proof from real activity only. With nothing to show yet it invites the visitor to be
 * first instead of displaying zeros or anything invented.
 */
export function SocialProof({ variant = "shopper" }: { variant?: "shopper" | "compact" | "seller" }) {
  const data = useTicker(5000);
  if (!data) return null;
  const { stats, events } = data;
  const latest = events[0];

  if (variant === "seller") {
    if (!stats.deals) return null;
    return (
      <p className="text-muted">
        <span className="text-fg">{stats.deals.toLocaleString("en-IN")} shoppers</span> have already haggled on GhostCart. Every one of them was
        buying from a seller like you.
      </p>
    );
  }

  if (!stats.paid) {
    return variant === "compact" ? null : (
      <p className="text-muted">
        <span className="size-2 mr-2 inline-block animate-pulse rounded-full bg-paid align-middle" aria-hidden />
        {stats.deals ? `${stats.deals} shoppers have haggled so far. ` : ""}Be the first to lock a flash deal.
      </p>
    );
  }

  if (variant === "compact") {
    return (
      <p className="text-sm text-muted">
        {stats.paid} {stats.paid === 1 ? "shopper has" : "shoppers have"} locked a deal so far, saving {inr(stats.saved)} between them.
      </p>
    );
  }

  return (
    <div className="space-y-1 text-muted">
      <p>
        <span className="size-2 mr-2 inline-block animate-pulse rounded-full bg-paid align-middle" aria-hidden />
        <span className="text-fg">{stats.paid} deals locked</span> so far · <span className="text-saffron">{inr(stats.saved)} saved</span> by shoppers
      </p>
      {latest && (
        <p className="text-sm">
          Latest: someone{latest.city ? ` in ${latest.city}` : ""} saved {inr(latest.saved)}
          {(() => {
            const m = latest.message.match(/grabbed (.+?) for ₹/);
            return m ? ` on ${shortTitle(m[1], 4)}` : "";
          })()}{" "}
          · {timeAgo(latest.at)}
        </p>
      )}
    </div>
  );
}
