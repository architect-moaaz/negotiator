import { AWAY_DEFAULTS, playbook, validateAwayRule, type AwayRule, type HaggleOutcome } from "@ghostcart/core";
import { schema } from "@ghostcart/db";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { store as kv } from "../store";
import { PolicyError, policyForProduct, setPolicy, storePolicies } from "./policies";
import { getProduct } from "./products";

const { awayRules } = schema;

export async function getAwayRule(storeId: string): Promise<AwayRule> {
  const db = await getDb();
  const [row] = await db.select().from(awayRules).where(eq(awayRules.storeId, storeId));
  return row ? { enabled: row.enabled, maxPctOff: row.maxPctOff, days: row.days, startHour: row.startHour, endHour: row.endHour } : { ...AWAY_DEFAULTS };
}

export async function setAwayRule(storeId: string, input: Partial<AwayRule>) {
  const next = { ...(await getAwayRule(storeId)), ...input };
  next.days = [...new Set(next.days)].sort();
  const errors = validateAwayRule(next);
  if (errors.length) throw new PolicyError(errors);
  const db = await getDb();
  const values = { ...next, updatedAt: new Date() };
  await db.insert(awayRules).values({ storeId, ...values }).onConflictDoUpdate({ target: awayRules.storeId, set: values });
  return next;
}

const LOST = new Set(["expired"]);
const WON = new Set(["pending", "paid", "granted"]);

/** The store's haggles from the last 30 days, as playbook outcomes (single-product GhostCart haggles). */
export async function storeOutcomes(storeId: string, since = Date.now() - 30 * 86_400_000) {
  const out: HaggleOutcome[] = [];
  const policyCache = new Map<string, { autoPct: number; maxPct: number; title: string } | null>();
  for (const d of await kv.listDeals(10_000)) {
    if (d.shop?.storeId !== storeId || d.cart || d.createdAt < since || !d.negotiation) continue;
    const won = WON.has(d.status) || !!d.grant?.redeemedAt;
    const lost = LOST.has(d.status) || d.negotiation.approval?.decision === "rejected";
    if (!won && !lost) continue;
    const offers = d.negotiation.messages.filter((m) => m.from === "shopper" && typeof m.price === "number").map((m) => m.price!);
    if (!offers.length) continue;
    const pid = d.shop.productId;
    if (!policyCache.has(pid)) {
      const p = await getProduct(pid);
      const pol = p && (await policyForProduct(p));
      policyCache.set(pid, p && pol ? { autoPct: pol.autoApprovePct, maxPct: pol.maxDiscountPct, title: p.title } : null);
    }
    const pol = policyCache.get(pid);
    if (!pol) continue;
    out.push({ productId: pid, title: pol.title, list: d.originalPrice, bestShopperOffer: Math.max(...offers), won, autoPct: pol.autoPct, maxPct: pol.maxPct });
  }
  return out;
}

export async function storePlaybook(storeId: string) {
  return playbook(await storeOutcomes(storeId));
}

/** Apply a suggestion: raise one product's agent-alone limit, keeping the rest of its own rules. */
export async function applyAutoPct(storeId: string, productId: string, autoApprovePct: number) {
  const own = (await storePolicies(storeId)).products.get(productId) ?? {};
  await setPolicy(storeId, "product", productId, { ...own, autoApprovePct });
}
