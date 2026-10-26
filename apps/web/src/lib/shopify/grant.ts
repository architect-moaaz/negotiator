import { registerGrantAdapter } from "../grants/adapters";
import { shopifyGraphql } from "./admin";
import { connectionForStore, tokenOf } from "./connections";

/**
 * Shopify price grant: a discount code that takes (list − agreed) off this one product, usable once,
 * that expires; the shopper lands on a cart permalink with the code already applied.
 */
registerGrantAdapter("shopify", {
  platform: "shopify",
  async ready(store) {
    return !!(await connectionForStore(store.id));
  },
  async createGrant({ store, product, code, discountInr, expiresAt }) {
    const conn = await connectionForStore(store.id);
    const [, productId, variantId] = product.source.split(":");
    if (!conn || !productId || !variantId) throw new Error("This store's Shopify connection isn't set up.");
    await shopifyGraphql(conn.externalId, tokenOf(conn), `mutation GhostCartGrant($input: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $input) { codeDiscountNode { id } userErrors { field message } }
      }`, {
      input: {
        title: `GhostCart ${code}`,
        code,
        startsAt: new Date().toISOString(),
        endsAt: expiresAt.toISOString(),
        usageLimit: 1,
        appliesOncePerCustomer: true,
        customerSelection: { all: true },
        customerGets: {
          value: { discountAmount: { amount: discountInr.toFixed(2), appliesOnEachItem: false } },
          items: { products: { productsToAdd: [`gid://shopify/Product/${productId}`] } },
        },
      },
    });
    return { checkoutUrl: `https://${conn.externalId}/cart/${variantId}:1?discount=${encodeURIComponent(code)}` };
  },
});
