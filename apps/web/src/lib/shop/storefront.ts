import { cookies } from "next/headers";
import { sessionSubject, sessionCookieName } from "../session";
import { memberRole } from "./orgs";
import { listCategories, listProducts } from "./products";
import { getStoreBySlug, type Store } from "./stores";

/**
 * A shop as shoppers see it. Live shops are public; a draft shop is visible only to its own members,
 * as a preview. Returns null when the shopper shouldn't see it at all.
 */
export async function loadStorefront(slug: string): Promise<{ store: Store; preview: boolean } | null> {
  const store = await getStoreBySlug(slug);
  if (!store || store.status === "suspended") return null;
  if (store.status === "live") return { store, preview: false };
  const phone = await sessionSubject("member", (await cookies()).get(sessionCookieName("member"))?.value);
  return phone && (await memberRole(store.orgId, phone)) ? { store, preview: true } : null;
}

export async function storefrontCatalogue(storeId: string) {
  const [products, categories] = await Promise.all([listProducts(storeId, { status: ["active"] }), listCategories(storeId)]);
  return { products, categories: categories.filter((c) => products.some((p) => p.categoryId === c.id)) };
}
