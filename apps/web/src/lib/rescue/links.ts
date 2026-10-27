/**
 * Rescue my cart: what a shopper pasted (product links or plain product names) as items to look for.
 * Only the text is used: links are never opened, and marketplace ids (ASINs, Flipkart item ids) are not
 * looked up anywhere. A link whose address carries no product words is skipped.
 */
export interface PastedItem {
  title: string;
  /** Where it came from, for the shopper's reference ("amazon.in"). */
  source?: string;
  quantity: number;
}

const MAX_ITEMS = 20;

/** Words from a product URL's readable slug ("/Milton-Thermosteel-Flip-Bottle/dp/B0…" → "Milton Thermosteel Flip Bottle"). */
export function titleFromUrl(raw: string): { title: string; source: string } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.replace(/^www\.|^m\./, "");
  const parts = url.pathname.split("/").filter(Boolean).map((p) => decodeURIComponent(p));
  let slug: string | undefined;
  if (/(^|\.)amazon\./.test(host)) {
    const dp = parts.findIndex((p) => p === "dp" || p === "gp");
    slug = dp > 0 ? parts[dp - 1] : undefined;
  } else if (/(^|\.)flipkart\.com$/.test(host)) {
    slug = parts.findIndex((p) => p === "p") > 0 ? parts[parts.findIndex((p) => p === "p") - 1] : parts[0];
  } else {
    // Other stores: the longest path segment with several words in it.
    slug = parts.filter((p) => /[a-z].*[-_+].*[a-z]/i.test(p)).sort((a, b) => b.length - a.length)[0];
  }
  const title = (slug ?? "")
    .replace(/\.(html?|php|aspx?)$/i, "")
    .replace(/[-_+]+/g, " ")
    .replace(/\b[a-z0-9]{10,}\b/gi, (w) => (/\d/.test(w) && /[a-z]/i.test(w) ? "" : w)) // drop opaque ids
    .replace(/\s+/g, " ")
    .trim();
  return title.split(" ").length >= 2 ? { title: title.slice(0, 200), source: host } : null;
}

/** Each non-empty line (or each link) becomes an item; "2 x Steel bottle" sets a quantity. */
export function itemsFromText(text: string): PastedItem[] {
  const items: PastedItem[] = [];
  for (const raw of text.split(/\n|(?=https?:\/\/)/)) {
    let line = raw.trim();
    if (!line) continue;
    let quantity = 1;
    const q = line.match(/^(\d{1,2})\s*[x×*]\s+/i);
    if (q) {
      quantity = Math.min(10, Math.max(1, Number(q[1])));
      line = line.slice(q[0].length);
    }
    const link = line.match(/https?:\/\/\S+/)?.[0];
    if (link) {
      const found = titleFromUrl(link);
      if (found) items.push({ ...found, quantity });
    } else if (line.length >= 3) {
      items.push({ title: line.slice(0, 200), quantity });
    }
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}
