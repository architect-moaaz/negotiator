/**
 * Shopify app settings. The app is registered in the Shopify Partner dashboard (apps/shopify/shopify.app.toml);
 * these come from there. SHOPIFY_ADMIN_BASE points at the in-repo mock in development.
 */
export const shopifyConfig = () => ({
  apiKey: process.env.SHOPIFY_API_KEY ?? (process.env.VERCEL_ENV ? "" : "zz-dev-shopify-key"),
  apiSecret: process.env.SHOPIFY_API_SECRET ?? (process.env.VERCEL_ENV ? "" : "zz-dev-shopify-secret"),
  scopes: process.env.SHOPIFY_SCOPES ?? "read_products,write_discounts,read_orders",
  apiVersion: process.env.SHOPIFY_API_VERSION ?? "2026-07",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  billing: process.env.SHOPIFY_BILLING === "on",
});

export const shopifyConfigured = () => Boolean(shopifyConfig().apiKey && shopifyConfig().apiSecret);

/** Base URL for a shop's Admin API: the shop itself, or the dev mock (never in production). */
export function adminBase(shop: string) {
  const mock = process.env.SHOPIFY_ADMIN_BASE;
  if (mock && process.env.VERCEL_ENV !== "production") return `${mock.replace(/\/$/, "")}/${shop}`;
  return `https://${shop}`;
}

/** zz-store.myshopify.com only: Shopify's own domain, lowercase letters, digits and hyphens. */
export const isShopDomain = (shop: string | null | undefined): shop is string => !!shop && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop);
