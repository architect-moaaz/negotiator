"use client";

import { useEffect, useState } from "react";
import type { Stats, TickerEvent } from "@/lib/types";

export function useTicker(intervalMs = 4000) {
  const [data, setData] = useState<{ events: TickerEvent[]; stats: Stats } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/ticker?limit=30", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => alive && setData(d))
        .catch(() => {});
    load();
    const t = setInterval(load, intervalMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [intervalMs]);

  return data;
}
