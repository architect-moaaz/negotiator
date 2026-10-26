import { captureCart } from "../privilege/carts";
import { createInvite } from "../privilege/invites";
import { getProduct } from "../shop/products";
import { getStore } from "../shop/stores";

export interface RescuePick {
  productId: string;
  quantity: number;
}

/**
 * The shopper picked GhostCart sellers' offers for the items in their marketplace cart: one cart per
 * store (each store is a separate haggle and checkout), each with its own private link to /p/<token>.
 */
export async function buildRescueCarts(picks: RescuePick[], userId?: string) {
  const byStore = new Map<string, RescuePick[]>();
  for (const pick of picks.slice(0, 20)) {
    const p = await getProduct(pick.productId);
    if (!p || p.status !== "active") continue;
    byStore.set(p.storeId, [...(byStore.get(p.storeId) ?? []), pick]);
  }
  const out: { storeId: string; storeName: string; items: number; url: string }[] = [];
  for (const [storeId, items] of byStore) {
    const store = await getStore(storeId);
    if (!store || store.status !== "live") continue;
    const cart = await captureCart({ storeId, source: "rescue", items: items.map((i) => ({ ref: i.productId, quantity: i.quantity })), userId });
    const { url } = await createInvite(cart.id, "link");
    out.push({ storeId, storeName: store.name, items: cart.lines.reduce((s, l) => s + l.quantity, 0), url: new URL(url, "http://x").pathname });
  }
  return out;
}
