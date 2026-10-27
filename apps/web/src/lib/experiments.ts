import { assignVariant, type Experiment, type NegotiationTerms } from "@ghostcart/core";
import { store as kv } from "./store";
import type { Deal } from "./types";

/**
 * Experiments on shopper-facing choices. Each is off unless switched on (EXPERIMENTS=name,name), and a
 * variant can only move things inside the seller's limits: code still sets every price.
 */
export const EXPERIMENTS = {
  /** Where the agent opens: control 25% of the way from list to its alone-limit, "closer" 50%. */
  opening_position: { name: "opening_position", variants: [{ name: "control", weight: 1 }, { name: "closer", weight: 1 }] },
} satisfies Record<string, Experiment>;
export type ExperimentName = keyof typeof EXPERIMENTS;

export const experimentOn = (name: ExperimentName) => (process.env.EXPERIMENTS ?? "").split(",").map((s) => s.trim()).includes(name);

/** The shopper's variant of the opening experiment, and the opening price it gives (never below the alone-limit). */
export function openingFor(terms: NegotiationTerms, subjectId: string) {
  if (!experimentOn("opening_position")) return { opening: terms.opening, variant: undefined };
  const variant = assignVariant(EXPERIMENTS.opening_position, subjectId);
  if (variant === "control") return { opening: terms.opening, variant };
  const opening = Math.max(terms.autoLimit, terms.benchmark - Math.round((terms.benchmark - terms.autoLimit) * 0.5));
  return { opening, variant };
}

const AGREED = new Set<Deal["status"]>(["pending", "paid", "granted"]);

/** Per variant: haggles, how many agreed, and the average discount off list on agreed ones. */
export async function experimentResults(name: ExperimentName, since = Date.now() - 30 * 86_400_000) {
  const by = new Map<string, { haggles: number; agreed: number; discount: number }>();
  for (const d of await kv.listDeals(10_000)) {
    const v = d.experiments?.[name];
    if (!v || d.createdAt < since) continue;
    const row = by.get(v) ?? { haggles: 0, agreed: 0, discount: 0 };
    row.haggles++;
    if (AGREED.has(d.status) || d.grant?.redeemedAt) {
      row.agreed++;
      row.discount += d.originalPrice ? 1 - d.dealPrice / d.originalPrice : 0;
    }
    by.set(v, row);
  }
  return [...by].map(([variant, r]) => ({ variant, haggles: r.haggles, agreed: r.agreed, agreeRate: r.haggles ? r.agreed / r.haggles : 0, averageDiscount: r.agreed ? r.discount / r.agreed : 0 }));
}
