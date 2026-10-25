"use client";

import { inr } from "@/lib/format";
import { useTicker } from "./use-ticker";

/** Live social-proof strip of locked deals. */
export function Ticker() {
  const data = useTicker();
  const events = data?.events ?? [];
  if (!events.length) return null;

  const items = events.slice(0, 12);
  return (
    <div className="overflow-hidden border-t border-line bg-panel/70 py-3 text-sm" aria-label="Recently locked deals">
      <div className="marquee flex w-max gap-12 whitespace-nowrap" style={{ ["--marquee-duration" as string]: `${items.length * 7}s` }}>
        {[...items, ...items].map((e, i) => (
          <span key={`${e.id}-${i}`} aria-hidden={i >= items.length} className="text-muted">
            {e.message} <span className="text-saffron">· saved {inr(e.saved)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
