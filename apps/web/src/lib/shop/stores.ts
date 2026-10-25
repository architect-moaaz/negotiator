import { schema } from "@ghostcart/db";
import { eq, like } from "drizzle-orm";
import { getDb } from "../db";
import { newId, slugify } from "./ids";

const { stores } = schema;

export type Platform = "ghostcart_shop" | "website" | "shopify" | "woocommerce" | "amazon" | "flipkart";
export type StoreStatus = "draft" | "pending_review" | "live" | "suspended";
export type StoreTier = "new" | "verified" | "trusted";
export type Store = typeof stores.$inferSelect & { platform: Platform; status: StoreStatus; tier: StoreTier };

export const PLATFORMS: Platform[] = ["ghostcart_shop", "website", "shopify", "woocommerce", "amazon", "flipkart"];

/** A free slug: "sharma-electronics", then "sharma-electronics-2", … */
async function freeSlug(name: string) {
  const db = await getDb();
  const base = slugify(name);
  const taken = new Set((await db.select({ slug: stores.slug }).from(stores).where(like(stores.slug, `${base}%`))).map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

export async function createStore(input: { orgId: string; name: string; platform: Platform; domain?: string }): Promise<Store> {
  const db = await getDb();
  const [store] = await db
    .insert(stores)
    .values({ id: newId("st"), orgId: input.orgId, name: input.name.trim().slice(0, 80), slug: await freeSlug(input.name), platform: input.platform, domain: input.domain ?? null })
    .returning();
  return store as Store;
}

export async function getStore(id: string) {
  const db = await getDb();
  const [store] = await db.select().from(stores).where(eq(stores.id, id));
  return store as Store | undefined;
}

export async function getStoreBySlug(slug: string) {
  const db = await getDb();
  const [store] = await db.select().from(stores).where(eq(stores.slug, slug));
  return store as Store | undefined;
}

export async function storesForOrg(orgId: string) {
  const db = await getDb();
  return (await db.select().from(stores).where(eq(stores.orgId, orgId))) as Store[];
}

export async function updateStore(id: string, patch: Partial<Pick<Store, "name" | "domain" | "status" | "tier" | "verifiedAt">>) {
  const db = await getDb();
  const [store] = await db.update(stores).set(patch).where(eq(stores.id, id)).returning();
  return store as Store | undefined;
}
