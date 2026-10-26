import { createHmac, timingSafeEqual } from "node:crypto";
import { adminBase, shopifyConfig } from "./config";

const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** OAuth redirect and app-proxy requests: hex HMAC-SHA256 over the sorted query string without `hmac`. */
export function verifyQueryHmac(params: URLSearchParams, secret = shopifyConfig().apiSecret) {
  const hmac = params.get("hmac");
  if (!hmac || !secret) return false;
  const message = [...params.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return safeEqual(createHmac("sha256", secret).update(message).digest("hex"), hmac);
}

/** Webhooks: base64 HMAC-SHA256 of the raw body in X-Shopify-Hmac-Sha256. */
export function verifyWebhookHmac(rawBody: string, header: string | null, secret = shopifyConfig().apiSecret) {
  if (!header || !secret) return false;
  return safeEqual(createHmac("sha256", secret).update(rawBody, "utf8").digest("base64"), header);
}

export function authorizeUrl(shop: string, state: string) {
  const c = shopifyConfig();
  const u = new URL(`${adminBase(shop)}/admin/oauth/authorize`);
  u.searchParams.set("client_id", c.apiKey);
  u.searchParams.set("scope", c.scopes);
  u.searchParams.set("redirect_uri", `${c.appUrl}/api/shopify/callback`);
  u.searchParams.set("state", state);
  return u.toString();
}

/** Exchange the OAuth code for an offline access token. */
export async function exchangeCode(shop: string, code: string) {
  const c = shopifyConfig();
  const res = await fetch(`${adminBase(shop)}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: c.apiKey, client_secret: c.apiSecret, code }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Shopify token exchange failed: ${res.status}`);
  return (await res.json()) as { access_token: string; scope: string };
}
