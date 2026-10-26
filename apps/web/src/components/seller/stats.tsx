"use client";

import { useEffect, useState } from "react";
import { inr } from "@/lib/format";
import { api } from "./ui";

interface Summary {
  negotiations: number;
  agreed: number;
  orders: number;
  gmv: number;
  agreeRate: number;
  escalationRate: number;
  averageDiscount: number;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Last 30 days from the nightly rollup: how often shoppers agree, how much the agent gives away, what sold. */
export function SellerStats({ storeId }: { storeId: string }) {
  const [s, setS] = useState<Summary | null>(null);
  useEffect(() => {
    let live = true;
    api<{ summary: Summary }>(`/api/seller/stores/${storeId}/metrics`).then((r) => live && r.ok && setS(r.data.summary));
    return () => {
      live = false;
    };
  }, [storeId]);
  if (!s) return null;
  if (!s.negotiations && !s.orders) return <p className="mt-1 text-sm text-muted">Your numbers appear here the day after your first haggle.</p>;
  return (
    <p className="mt-1 text-sm text-muted">
      Last 30 days: {s.negotiations} haggles · {pct(s.agreeRate)} agreed · {pct(s.averageDiscount)} off on average · {pct(s.escalationRate)} came to you · {s.orders} orders ·{" "}
      {inr(s.gmv / 100)} sold
    </p>
  );
}
