import { resolvePolicy, termsFromPolicy, validatePolicy, type DiscountPolicy, type PolicyScope, type ResolvedPolicy } from "@ghostcart/core";
import { schema } from "@ghostcart/db";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { newId } from "./ids";
import type { Category, Product } from "./products";
import type { Store } from "./stores";

const { categories, policies } = schema;

type Row = typeof policies.$inferSelect;

const toPolicy = (r: Row | undefined): DiscountPolicy | undefined =>
  r && {
    enabled: r.enabled ?? undefined,
    maxDiscountPct: r.maxDiscountPct ?? undefined,
    autoApprovePct: r.autoApprovePct ?? undefined,
    floorPrice: r.floorPrice ?? undefined,
    maxRounds: r.maxRounds ?? undefined,
    expiryMinutes: r.expiryMinutes ?? undefined,
    bundlesAllowed: r.bundlesAllowed ?? undefined,
    channels: r.channels ?? undefined,
  };

export class PolicyError extends Error {
  constructor(public errors: string[]) {
    super(errors.join(" "));
  }
}

/** Every policy row in a store, indexed by level. */
export async function storePolicies(storeId: string) {
  const db = await getDb();
  const rows = await db.select().from(policies).where(eq(policies.storeId, storeId));
  return {
    store: toPolicy(rows.find((r) => r.scope === "store")),
    categories: new Map(rows.filter((r) => r.scope === "category").map((r) => [r.categoryId!, toPolicy(r)!])),
    products: new Map(rows.filter((r) => r.scope === "product").map((r) => [r.productId!, toPolicy(r)!])),
  };
}

/**
 * Save the policy at one level, replacing what was there. Unset fields inherit from the level above.
 * Pass an empty policy to clear an override.
 */
export async function setPolicy(storeId: string, scope: PolicyScope, targetId: string | null, policy: DiscountPolicy) {
  const errors = validatePolicy(policy, scope);
  if (errors.length) throw new PolicyError(errors);
  if ((scope === "store") !== (targetId === null)) throw new PolicyError(["Pick what this rule applies to."]);
  const db = await getDb();
  const where =
    scope === "store"
      ? and(eq(policies.storeId, storeId), eq(policies.scope, "store"))
      : scope === "category"
        ? and(eq(policies.storeId, storeId), eq(policies.scope, "category"), eq(policies.categoryId, targetId!))
        : and(eq(policies.storeId, storeId), eq(policies.scope, "product"), eq(policies.productId, targetId!));
  await db.delete(policies).where(where);
  if (Object.values(policy).every((v) => v === undefined)) return;
  await db.insert(policies).values({
    id: newId("pol"),
    storeId,
    scope,
    categoryId: scope === "category" ? targetId : null,
    productId: scope === "product" ? targetId : null,
    enabled: policy.enabled ?? null,
    maxDiscountPct: policy.maxDiscountPct ?? null,
    autoApprovePct: policy.autoApprovePct ?? null,
    floorPrice: policy.floorPrice ?? null,
    maxRounds: policy.maxRounds ?? null,
    expiryMinutes: policy.expiryMinutes ?? null,
    bundlesAllowed: policy.bundlesAllowed ?? null,
    channels: policy.channels ?? null,
    updatedAt: new Date(),
  });
}

/** The rules that apply to one product after the store → category → product cascade. */
export async function policyForProduct(product: Pick<Product, "id" | "storeId" | "categoryId">): Promise<ResolvedPolicy> {
  const all = await storePolicies(product.storeId);
  return resolvePolicy({
    store: all.store,
    category: product.categoryId ? all.categories.get(product.categoryId) : undefined,
    product: all.products.get(product.id),
  });
}

/** Negotiation limits for a shop product, or null when haggling is off for it (or for this channel). */
export async function termsForProduct(product: Product, store: Pick<Store, "id" | "name">, channel?: string) {
  const db = await getDb();
  const [category] = product.categoryId
    ? await db.select().from(categories).where(eq(categories.id, product.categoryId))
    : ([] as Category[]);
  return termsFromPolicy(await policyForProduct(product), product.price, { sellerId: store.id, sellerName: store.name, category: category?.name ?? "general", channel });
}
