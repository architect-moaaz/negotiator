/**
 * Flipkart Marketplace Seller APIs: OAuth 2.0 (the seller authorises GhostCart from Seller Hub) and the
 * Listings API v3 (look up the seller's own SKUs for price, MRP, stock and status). Written from
 * Flipkart's seller API documentation; the app needs Flipkart's approval before it works live. Base URLs
 * point at the in-repo mock (/api/mock-flipkart) in development and tests.
 */
export const flipkartConfig = () => ({
  appId: process.env.FLIPKART_APP_ID ?? (process.env.VERCEL_ENV ? "" : "zz-dev-flipkart-app"),
  appSecret: process.env.FLIPKART_APP_SECRET ?? (process.env.VERCEL_ENV ? "" : "zz-dev-flipkart-secret"),
  authBase: devOverride(process.env.FLIPKART_AUTH_BASE) ?? "https://api.flipkart.net/oauth-service",
  apiBase: devOverride(process.env.FLIPKART_API_BASE) ?? "https://api.flipkart.net/sellers",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
});

function devOverride(v: string | undefined) {
  return v && process.env.VERCEL_ENV !== "production" ? v.replace(/\/$/, "") : undefined;
}

export const flipkartConfigured = () => Boolean(flipkartConfig().appId && flipkartConfig().appSecret);

export class FlipkartError extends Error {}

export function authorizeUrl(state: string) {
  const c = flipkartConfig();
  const u = new URL(`${c.authBase}/oauth/authorize`);
  u.searchParams.set("client_id", c.appId);
  u.searchParams.set("redirect_uri", `${c.appUrl}/api/flipkart/callback`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "Seller_Api");
  u.searchParams.set("state", state);
  return u.toString();
}

interface Tokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

async function token(params: Record<string, string>): Promise<Tokens> {
  const c = flipkartConfig();
  const u = new URL(`${c.authBase}/oauth/token`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u, { headers: { Authorization: `Basic ${Buffer.from(`${c.appId}:${c.appSecret}`).toString("base64")}`, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new FlipkartError(`Flipkart token ${res.status}`);
  return (await res.json()) as Tokens;
}

export const exchangeCode = (code: string) => token({ grant_type: "authorization_code", code, redirect_uri: `${flipkartConfig().appUrl}/api/flipkart/callback` });
export const refreshAccess = (refreshToken: string) => token({ grant_type: "refresh_token", refresh_token: refreshToken });

export interface FlipkartListing {
  sku: string;
  price: number;
  mrp?: number;
  stock?: number;
  active: boolean;
}

/** Up to 10 SKUs per call (the API's limit). SKUs Flipkart doesn't know are simply absent. */
export async function listingsFor(accessToken: string, skus: string[]): Promise<FlipkartListing[]> {
  if (!skus.length) return [];
  if (skus.length > 10) throw new FlipkartError("Up to 10 SKUs per listings call.");
  const res = await fetch(`${flipkartConfig().apiBase}/listings/v3/${skus.map(encodeURIComponent).join(",")}`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 401) throw new FlipkartError("Flipkart access was revoked. Connect again.");
  if (!res.ok) throw new FlipkartError(`Flipkart listings ${res.status}`);
  const body = (await res.json()) as {
    available?: Record<string, { price?: { mrp?: number; selling_price?: number }; listing_status?: string; inventory?: number; locations?: { inventory?: number }[] }>;
  };
  return Object.entries(body.available ?? {}).map(([sku, l]) => ({
    sku,
    price: Math.round(Number(l.price?.selling_price ?? 0)),
    mrp: l.price?.mrp ? Math.round(Number(l.price.mrp)) : undefined,
    stock: l.inventory ?? l.locations?.reduce((s, x) => s + (x.inventory ?? 0), 0),
    active: (l.listing_status ?? "ACTIVE").toUpperCase() === "ACTIVE",
  }));
}
