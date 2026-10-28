import { registerGrantAdapter } from "../grants/adapters";
import { callPlugin, wooConnectionForStore } from "./client";

/**
 * WooCommerce price grant: the plugin creates a fixed_product coupon for one product, usable once,
 * expiring, and returns an add-to-cart link that applies it.
 */
registerGrantAdapter("woocommerce", {
  platform: "woocommerce",
  async ready(store) {
    return !!(await wooConnectionForStore(store.id));
  },
  async liveStock({ store, products }) {
    const conn = await wooConnectionForStore(store.id);
    const byWoo = new Map<number, string>(
      products.flatMap((p): [number, string][] => {
        const id = Number(p.source.startsWith("woo:") ? p.source.slice(4) : p.sku?.replace(/^woo-/, ""));
        return id > 0 ? [[id, p.id]] : [];
      }),
    );
    if (!conn || !byWoo.size) return new Map();
    const { stock } = await callPlugin<{ stock: Record<string, number> }>(conn.externalId, conn.accessTokenEncrypted, "stock", { productIds: [...byWoo.keys()] });
    const out = new Map<string, number>();
    for (const [id, qty] of Object.entries(stock ?? {})) if (byWoo.has(Number(id)) && Number.isFinite(qty)) out.set(byWoo.get(Number(id))!, Math.max(0, Math.floor(qty)));
    return out;
  },
  async createGrant({ store, product, code, discountInr, expiresAt, lines }) {
    const conn = await wooConnectionForStore(store.id);
    const wooIdOf = (p: typeof product) => (p.source.startsWith("woo:") ? p.source.slice(4) : p.sku?.replace(/^woo-/, ""));
    const wooId = wooIdOf(product);
    if (!conn || !wooId) throw new Error("This store's WooCommerce connection isn't set up.");
    if (lines?.length) {
      // GhostCart Privilege: a fixed_cart coupon limited to these products, and a link that fills the cart.
      const items = lines.map((l) => ({ productId: Number(wooIdOf(l.product)), quantity: l.quantity }));
      if (items.some((i) => !i.productId)) throw new Error("This store's WooCommerce connection isn't set up.");
      const { checkoutUrl } = await callPlugin<{ checkoutUrl: string }>(conn.externalId, conn.accessTokenEncrypted, "coupons", {
        code,
        items,
        amount: discountInr.toFixed(2),
        expiresAt: expiresAt.toISOString(),
      });
      return { checkoutUrl };
    }
    const { checkoutUrl } = await callPlugin<{ checkoutUrl: string }>(conn.externalId, conn.accessTokenEncrypted, "coupons", {
      code,
      productId: Number(wooId),
      amount: discountInr.toFixed(2),
      expiresAt: expiresAt.toISOString(),
    });
    return { checkoutUrl };
  },
});
