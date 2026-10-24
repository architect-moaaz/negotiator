export const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export function timeAgo(at: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

/** Marketplace titles are long; keep the first few words ("Sony WH-1000XM5 Best Active Noise Cancelling"). */
export function shortTitle(title: string, words = 6) {
  return title
    .replace(/\(.*?\)|\[.*?\]/g, "")
    .split(/,|\||–|\s-\s/)[0]
    .split(/\s+/)
    .slice(0, words)
    .join(" ")
    .trim();
}

/** Stage-demo listing: served from a fixed product so a slow or blocking store can't sink the pitch. */
export const DEMO_URL = "https://www.amazon.in/dp/B09XS7JWHH";
