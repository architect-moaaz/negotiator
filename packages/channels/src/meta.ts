import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Meta app (WhatsApp Cloud API, Instagram Messaging). Values from the Meta developer dashboard.
 * META_GRAPH_BASE points at the in-repo mock in development and tests.
 */
export const metaConfig = () => ({
  appId: process.env.META_APP_ID ?? (process.env.VERCEL_ENV ? "" : "zz-dev-meta-app"),
  appSecret: process.env.META_APP_SECRET ?? (process.env.VERCEL_ENV ? "" : "zz-dev-meta-secret"),
  verifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN ?? (process.env.VERCEL_ENV ? "" : "zz-dev-verify"),
  /** Embedded Signup configuration id (WhatsApp) from Facebook Login for Business. */
  waConfigId: process.env.META_WA_CONFIG_ID ?? "",
  version: process.env.META_GRAPH_VERSION ?? "v24.0",
  graphBase: (process.env.META_GRAPH_BASE && process.env.VERCEL_ENV !== "production" ? process.env.META_GRAPH_BASE : "https://graph.facebook.com").replace(/\/$/, ""),
  /** Where the Facebook Login dialog lives (the mock in development). */
  dialogBase: (process.env.META_GRAPH_BASE && process.env.VERCEL_ENV !== "production" ? process.env.META_GRAPH_BASE : "https://www.facebook.com").replace(/\/$/, ""),
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
});

export const metaConfigured = () => Boolean(metaConfig().appId && metaConfig().appSecret);

/** X-Hub-Signature-256: "sha256=" + hex HMAC of the raw body with the app secret. */
export function verifyMetaSignature(rawBody: string, header: string | null) {
  const secret = metaConfig().appSecret;
  if (!header?.startsWith("sha256=") || !secret) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
  return expected.length === header.length && timingSafeEqual(Buffer.from(expected), Buffer.from(header));
}

export async function graph<T>(path: string, init: { method?: string; token?: string; body?: unknown; query?: Record<string, string> } = {}): Promise<T> {
  const c = metaConfig();
  const url = new URL(`${c.graphBase}/${c.version}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init.body ? { "Content-Type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message: string } };
  if (!res.ok || data.error) throw new Error(`Meta Graph ${path}: ${data.error?.message ?? res.status}`);
  return data;
}
