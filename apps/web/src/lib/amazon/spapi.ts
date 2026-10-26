import { gunzipSync } from "node:zlib";

/**
 * Amazon Selling Partner API for India (marketplace A21TJRUUN4KGV, served from the EU endpoint).
 * Sellers authorise GhostCart from Seller Central; we only read their own listings. Written from the
 * SP-API documentation; the app must be registered (and approved for public use) before it works live.
 * The *_BASE variables point at the in-repo mock in development and tests.
 */
export const INDIA_MARKETPLACE = "A21TJRUUN4KGV";

export const amazonConfig = () => ({
  appId: process.env.AMAZON_SPAPI_APP_ID ?? (process.env.VERCEL_ENV ? "" : "amzn1.sp.solution.zz-dev"),
  clientId: process.env.AMAZON_LWA_CLIENT_ID ?? (process.env.VERCEL_ENV ? "" : "zz-dev-lwa-client"),
  clientSecret: process.env.AMAZON_LWA_CLIENT_SECRET ?? (process.env.VERCEL_ENV ? "" : "zz-dev-lwa-secret"),
  draft: process.env.AMAZON_SPAPI_DRAFT !== "off", // draft apps add version=beta to the consent URL
  consentBase: devOverride(process.env.AMAZON_CONSENT_BASE) ?? "https://sellercentral.amazon.in",
  lwaBase: devOverride(process.env.AMAZON_LWA_BASE) ?? "https://api.amazon.com",
  apiBase: devOverride(process.env.AMAZON_SPAPI_BASE) ?? "https://sellingpartnerapi-eu.amazon.com",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
});

function devOverride(v: string | undefined) {
  return v && process.env.VERCEL_ENV !== "production" ? v.replace(/\/$/, "") : undefined;
}

export const amazonConfigured = () => {
  const c = amazonConfig();
  return Boolean(c.appId && c.clientId && c.clientSecret);
};

export function consentUrl(state: string) {
  const c = amazonConfig();
  const u = new URL(`${c.consentBase}/apps/authorize/consent`);
  u.searchParams.set("application_id", c.appId);
  u.searchParams.set("state", state);
  u.searchParams.set("redirect_uri", `${c.appUrl}/api/amazon/callback`);
  if (c.draft) u.searchParams.set("version", "beta");
  return u.toString();
}

async function lwa(params: Record<string, string>) {
  const c = amazonConfig();
  const res = await fetch(`${c.lwaBase}/auth/o2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, client_id: c.clientId, client_secret: c.clientSecret }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Login with Amazon failed: ${res.status}`);
  return (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
}

export const exchangeAuthCode = (code: string) => lwa({ grant_type: "authorization_code", code, redirect_uri: `${amazonConfig().appUrl}/api/amazon/callback` });
export const accessTokenFor = async (refreshToken: string) => (await lwa({ grant_type: "refresh_token", refresh_token: refreshToken })).access_token;

async function spapi<T>(accessToken: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${amazonConfig().apiBase}${path}`, {
    method: init.method ?? "GET",
    headers: { "x-amz-access-token": accessToken, "Content-Type": "application/json", "User-Agent": "GhostCart/1.0 (Language=TypeScript)" },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`SP-API ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

/** Ask Amazon to build the "all listings" report for India. Returns the report id to poll. */
export async function requestListingsReport(accessToken: string) {
  const { reportId } = await spapi<{ reportId: string }>(accessToken, "/reports/2021-06-30/reports", {
    method: "POST",
    body: { reportType: "GET_MERCHANT_LISTINGS_ALL_DATA", marketplaceIds: [INDIA_MARKETPLACE] },
  });
  return reportId;
}

/** null while Amazon is still building it; the report's TSV text when done; throws if it failed. */
export async function fetchReportIfReady(accessToken: string, reportId: string): Promise<string | null> {
  const report = await spapi<{ processingStatus: string; reportDocumentId?: string }>(accessToken, `/reports/2021-06-30/reports/${reportId}`);
  if (report.processingStatus === "CANCELLED" || report.processingStatus === "FATAL") throw new Error(`Amazon couldn't build the listings report (${report.processingStatus}).`);
  if (report.processingStatus !== "DONE" || !report.reportDocumentId) return null;
  const doc = await spapi<{ url: string; compressionAlgorithm?: string }>(accessToken, `/reports/2021-06-30/documents/${report.reportDocumentId}`);
  const file = await fetch(doc.url, { signal: AbortSignal.timeout(30_000) });
  const bytes = Buffer.from(await file.arrayBuffer());
  return (doc.compressionAlgorithm === "GZIP" ? gunzipSync(bytes) : bytes).toString("utf8");
}

/** The listings report is tab-separated; turn it into the CSV our importer reads (columns are aliased there). */
export function listingsTsvToCsv(tsv: string) {
  const quote = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return tsv
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => l.split("\t").map((v) => quote(v.trim())).join(","))
    .join("\n");
}
