import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { schema } from "@ghostcart/db";
import { and, eq, isNull } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "../crypto";
import { getDb } from "../db";
import { isPublicDomain } from "../verification/ownership";

const { platformConnections } = schema;

/**
 * GhostCart ↔ WooCommerce plugin. The plugin calls GhostCart with the store's secret API key; GhostCart
 * calls the plugin's REST routes signed with a per-site secret ("X-GhostCart-Signature: t=…,v1=hmac").
 */
export class WooError extends Error {}

/** "https://Shop.in/" → "https://shop.in"; https and a public host only (http allowed for localhost in dev). */
export function normalizeSiteUrl(raw: string) {
  try {
    const u = new URL(raw.trim());
    const devLocal = process.env.VERCEL_ENV !== "production" && (u.hostname === "localhost" || u.hostname.endsWith(".test"));
    if (!(u.protocol === "https:" || (devLocal && u.protocol === "http:"))) return null;
    if (!devLocal && !isPublicDomain(u.hostname)) return null;
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

export function signWoo(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

export async function saveWooConnection(storeId: string, siteUrl: string) {
  const secret = `wcsec_${randomBytes(24).toString("base64url")}`;
  const db = await getDb();
  await db
    .insert(platformConnections)
    .values({ id: `pcn_${randomBytes(8).toString("base64url")}`, storeId, platform: "woocommerce", externalId: siteUrl, accessTokenEncrypted: encryptSecret(secret), scopes: "coupons,orders" })
    .onConflictDoUpdate({ target: [platformConnections.platform, platformConnections.externalId], set: { storeId, accessTokenEncrypted: encryptSecret(secret), installedAt: new Date(), uninstalledAt: null } });
  return secret;
}

export async function wooConnectionForStore(storeId: string) {
  const db = await getDb();
  const [row] = await db.select().from(platformConnections).where(and(eq(platformConnections.storeId, storeId), eq(platformConnections.platform, "woocommerce"), isNull(platformConnections.uninstalledAt)));
  return row;
}

/** Call a GhostCart route on the seller's WordPress site, signed. */
export async function callPlugin<T>(siteUrl: string, sealedSecret: string, route: string, payload: unknown): Promise<T> {
  const body = JSON.stringify(payload);
  const res = await fetch(`${siteUrl}/wp-json/ghostcart/v1/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-GhostCart-Signature": signWoo(decryptSecret(sealedSecret), body) },
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  if (!res.ok) throw new WooError(`The store's GhostCart plugin answered ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

/** The plugin proves it holds the site secret by signing our nonce: proof the seller controls the site. */
export async function verifyPluginOwnership(siteUrl: string, sealedSecret: string) {
  const nonce = randomBytes(16).toString("hex");
  const { signature } = await callPlugin<{ signature: string }>(siteUrl, sealedSecret, "verify", { nonce });
  const expected = createHmac("sha256", decryptSecret(sealedSecret)).update(nonce).digest("hex");
  return typeof signature === "string" && signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
