import { registerGrantAdapter } from "../grants/adapters";
import { ShopifyError, shopifyGraphql } from "./admin";
import { connectionForStore, tokenOf } from "./connections";

/**
 * Shopify price grant. First choice: a discount code that takes (list − agreed) off this one product,
 * usable once, that expires; the shopper lands on a cart permalink with the code applied. If Shopify
 * won't create the code (no discount scope, a plan without discount APIs, a failing call), fall back to a
 * draft order for that one variant at the agreed price, and send the shopper to its invoice. The draft
 * carries the code as a custom attribute, so the resulting order still marks the deal won; expired
 * drafts are deleted by the order job.
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
    const shop = conn.externalId;
    const token = tokenOf(conn);
    try {
      await shopifyGraphql(shop, token, `mutation GhostCartGrant($input: DiscountCodeBasicInput!) {
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
      return { checkoutUrl: `https://${shop}/cart/${variantId}:1?discount=${encodeURIComponent(code)}`, kind: "code" };
    } catch (err) {
      if (!(err instanceof ShopifyError)) throw err;
      console.warn(`shopify discount code failed for ${shop}, using a draft order: ${err.message}`);
    }
    const out = await shopifyGraphql<{ draftOrderCreate: { draftOrder: { id: string; invoiceUrl: string } } }>(
      shop,
      token,
      `mutation GhostCartDraft($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) { draftOrder { id invoiceUrl } userErrors { field message } }
      }`,
      {
        input: {
          lineItems: [
            {
              variantId: `gid://shopify/ProductVariant/${variantId}`,
              quantity: 1,
              appliedDiscount: { valueType: "FIXED_AMOUNT", value: Number(discountInr.toFixed(2)), amount: Number(discountInr.toFixed(2)), title: `GhostCart ${code}` },
            },
          ],
          tags: ["GhostCart", code],
          note: `Price agreed with the GhostCart agent (${code}). Valid until ${expiresAt.toISOString()}.`,
          customAttributes: [{ key: "ghostcart_code", value: code }],
          reserveInventoryUntil: expiresAt.toISOString(),
        },
      },
    );
    return { checkoutUrl: out.draftOrderCreate.draftOrder.invoiceUrl, kind: "draft_order", ref: out.draftOrderCreate.draftOrder.id };
  },
  async revoke({ store, ref }) {
    const conn = await connectionForStore(store.id);
    if (!conn) return;
    await shopifyGraphql(conn.externalId, tokenOf(conn), `mutation GhostCartDraftDelete($input: DraftOrderDeleteInput!) {
        draftOrderDelete(input: $input) { deletedId userErrors { field message } }
      }`, { input: { id: ref } });
  },
});
