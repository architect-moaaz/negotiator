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
  async createGrant({ store, product, code, discountInr, expiresAt }) {
    const conn = await wooConnectionForStore(store.id);
    const wooId = product.source.startsWith("woo:") ? product.source.slice(4) : product.sku?.replace(/^woo-/, "");
    if (!conn || !wooId) throw new Error("This store's WooCommerce connection isn't set up.");
    const { checkoutUrl } = await callPlugin<{ checkoutUrl: string }>(conn.externalId, conn.accessTokenEncrypted, "coupons", {
      code,
      productId: Number(wooId),
      amount: discountInr.toFixed(2),
      expiresAt: expiresAt.toISOString(),
    });
    return { checkoutUrl };
  },
});
