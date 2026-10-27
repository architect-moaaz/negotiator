/**
 * Rescue my cart: is a GhostCart seller's product the same thing a shopper has in a marketplace cart?
 * Pure and deterministic, so a match can be explained ("same barcode", "same brand and model").
 * Same-item matches (barcode, or brand plus model number) always rank above "similar" (title words).
 */

/** A GTIN (EAN-8, UPC-A, EAN-13, GTIN-14) with a valid check digit, as 14 digits; otherwise null. */
export function normalizeGtin(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/[\s-]/g, "");
  if (!/^\d{8}$|^\d{12,14}$/.test(digits)) return null;
  const padded = digits.padStart(14, "0");
  if (/^0+$/.test(padded)) return null;
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += Number(padded[i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(padded[13]) ? padded : null;
}

const STOP = new Set(["the", "and", "for", "with", "of", "in", "a", "an", "to", "by", "new", "pack", "combo", "set", "pcs", "piece", "pieces", "free", "best", "latest", "original"]);

/** Lower-case word tokens, units kept with their numbers ("1l", "500ml", "128gb"). */
export function titleTokens(title: string): string[] {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      // "1 L" → "1l", "128 GB" → "128gb"
      .replace(/(\d+(?:\.\d+)?)\s+(ml|l|ltr|litre|liter|g|gm|kg|mg|gb|tb|mb|mah|w|cm|mm|m|inch|in)\b/g, "$1$2")
      .split(/[^a-z0-9.]+/)
      .map((t) => t.replace(/^\.+|\.+$/g, ""))
      .filter((t) => t.length > 1 && !STOP.has(t))
  );
}

/** A model number as compared: letters and digits only, upper case ("SM-A156E" → "SMA156E"). */
export const normalizeModel = (raw: string | null | undefined) => {
  const m = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return m.length >= 3 && /\d/.test(m) ? m : null;
};

export interface MatchQuery {
  title: string;
  brand?: string | null;
  gtin?: string | null;
  model?: string | null;
}

export interface MatchCandidate {
  title: string;
  brand?: string | null;
  gtin?: string | null;
  modelNumber?: string | null;
}

export type MatchKind = "same_gtin" | "same_model" | "similar";

export interface MatchResult {
  kind: MatchKind;
  /** 0–1. Same-item matches are 1; similar ones are the share of the query's title words found. */
  score: number;
  why: string;
}

const SIMILAR_MIN = 0.6;

/**
 * Does this catalogue product match what the shopper has? Barcodes decide when both sides have one;
 * a different barcode is a different item. Brand plus model number is next. Otherwise title words must
 * mostly overlap (and brands must agree when both are known) to count as "similar".
 */
export function matchProduct(q: MatchQuery, c: MatchCandidate): MatchResult | null {
  const qg = normalizeGtin(q.gtin);
  const cg = normalizeGtin(c.gtin);
  if (qg && cg) return qg === cg ? { kind: "same_gtin", score: 1, why: "Same barcode" } : null;

  const qb = q.brand?.trim().toLowerCase() || null;
  const cb = c.brand?.trim().toLowerCase() || null;
  if (qb && cb && qb !== cb) return null;

  const qm = normalizeModel(q.model);
  const cm = normalizeModel(c.modelNumber);
  if (qm && cm && qm === cm && (!qb || !cb || qb === cb)) return { kind: "same_model", score: 1, why: `Same model (${c.modelNumber})` };
  // A model number seen in the shopper's title (marketplace titles often carry it).
  if (cm && cb && !qm && titleTokens(q.title).some((t) => t.toUpperCase().replace(/[^A-Z0-9]/g, "") === cm) && titleTokens(q.title).includes(cb))
    return { kind: "same_model", score: 1, why: `Same model (${c.modelNumber})` };

  const qt = new Set(titleTokens(`${q.brand ?? ""} ${q.title}`));
  const ct = new Set(titleTokens(`${c.brand ?? ""} ${c.title}`));
  if (!qt.size || !ct.size) return null;
  let common = 0;
  for (const t of qt) if (ct.has(t)) common++;
  // Numbers with units must agree when both mention them (1l vs 2l is not the same bottle).
  const units = (s: Set<string>) => [...s].filter((t) => /^\d+(\.\d+)?[a-z]+$/.test(t));
  const qu = units(qt);
  const cu = units(ct);
  if (qu.length && cu.length && !qu.some((u) => cu.includes(u))) return null;
  if (common < 2) return null; // one shared word ("bottle") says nothing about being the same thing
  const score = common / qt.size;
  return score >= SIMILAR_MIN ? { kind: "similar", score: Math.round(score * 100) / 100, why: `${common} of ${qt.size} words match` } : null;
}

/** Rank matches: same item first, then by score, then cheapest. */
export function rankMatches<T extends { match: MatchResult; price: number }>(items: T[]): T[] {
  const rank = (k: MatchKind) => (k === "similar" ? 1 : 0);
  return [...items].sort((a, b) => rank(a.match.kind) - rank(b.match.kind) || b.match.score - a.match.score || a.price - b.price);
}
