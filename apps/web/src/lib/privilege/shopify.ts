import { captureCart, CartError, completeCart } from "./carts";

/** The parts of Shopify's checkouts/create and checkouts/update payloads we read. */
export interface ShopifyCheckout {
  token?: string;
  completed_at?: string | null;
  line_items?: { product_id?: number | null; quantity?: number }[];
  email?: string | null;
  phone?: string | null;
  buyer_accepts_marketing?: boolean;
  abandoned_checkout_url?: string;
  customer?: { first_name?: string | null; last_name?: string | null } | null;
}

/**
 * Whether checkout contact details may be kept. Shopify checkouts can't show GhostCart's own consent box,
 * so the only consent there is the shopper accepting the store's marketing. Off until Shopify approves our
 * Protected Customer Data request and legal confirms that consent covers a private offer
 * (docs/plans/ghostcart-privilege.md, open items).
 */
const contactAllowed = () => process.env.SHOPIFY_CHECKOUT_CONTACT === "1";

/**
 * A Shopify checkout became a GhostCart cart (GhostCart Privilege). Completed checkouts close their cart.
 * Without consent the cart is kept without any shopper details: it still counts in the seller's stats.
 */
export async function captureShopifyCheckout(storeId: string, storeName: string, body: ShopifyCheckout) {
  if (!body.token) return null;
  if (body.completed_at) {
    await completeCart(storeId, "shopify_checkout", body.token);
    return null;
  }
  const items = (body.line_items ?? []).filter((l) => l.product_id).map((l) => ({ ref: `shopify-${l.product_id}`, quantity: l.quantity ?? 1 }));
  if (!items.length) return null;
  const consent = contactAllowed() && body.buyer_accepts_marketing === true;
  try {
    return await captureCart({
      storeId,
      source: "shopify_checkout",
      externalRef: body.token,
      items,
      contact: consent
        ? { email: body.email ?? undefined, phone: body.phone ?? undefined, name: [body.customer?.first_name, body.customer?.last_name].filter(Boolean).join(" ") || undefined }
        : undefined,
      consent,
      consentWording: consent ? `Accepted marketing from ${storeName} at Shopify checkout` : undefined,
      returnUrl: body.abandoned_checkout_url,
    });
  } catch (err) {
    if (err instanceof CartError) return null; // none of these products are on GhostCart
    throw err;
  }
}
