import { schema } from "@ghostcart/db";
import { and, eq, lte } from "drizzle-orm";
import { createHmac, randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "../crypto";
import { getDb } from "../db";
import { isPublicDomain } from "../verification/ownership";

const { webhookDeliveries, webhookEndpoints } = schema;

export const WEBHOOK_EVENTS = ["order.placed", "order.shipped", "order.delivered", "order.completed", "order.refunded", "order.cancelled", "order.return_requested"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
const MAX_ATTEMPTS = 8;

export class WebhookError extends Error {}

/** Signature header: "t=<unix seconds>,v1=<hex HMAC-SHA256 of `${t}.${body}`>". Sellers verify with their secret. */
export function signPayload(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

export async function addWebhookEndpoint(storeId: string, url: string, events: string[] = [...WEBHOOK_EVENTS]) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new WebhookError("That isn't a valid URL.");
  }
  if (u.protocol !== "https:" || !isPublicDomain(u.hostname)) throw new WebhookError("Webhooks need a public https:// address.");
  const picked = events.filter((e): e is WebhookEvent => (WEBHOOK_EVENTS as readonly string[]).includes(e));
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  const db = await getDb();
  const [row] = await db
    .insert(webhookEndpoints)
    .values({ id: `whe_${randomBytes(8).toString("base64url")}`, storeId, url: u.toString(), secretEncrypted: encryptSecret(secret), events: picked.length ? picked : [...WEBHOOK_EVENTS] })
    .returning();
  return { secret, endpoint: { id: row.id, url: row.url, events: row.events } };
}

export async function listWebhookEndpoints(storeId: string) {
  const db = await getDb();
  const rows = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.storeId, storeId));
  const recent = await db.select().from(webhookDeliveries).orderBy(webhookDeliveries.createdAt).limit(500);
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    events: r.events,
    active: r.active,
    recent: recent.filter((d) => d.endpointId === r.id).slice(-10).reverse().map((d) => ({ event: d.event, status: d.status, attempts: d.attempts, responseCode: d.responseCode, createdAt: d.createdAt })),
  }));
}

export async function removeWebhookEndpoint(storeId: string, endpointId: string) {
  const db = await getDb();
  await db.update(webhookEndpoints).set({ active: false }).where(and(eq(webhookEndpoints.id, endpointId), eq(webhookEndpoints.storeId, storeId)));
}

async function attempt(deliveryId: string, fetcher: typeof fetch = fetch) {
  const db = await getDb();
  const [d] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, deliveryId));
  if (!d || d.status === "delivered") return d;
  const [endpoint] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, d.endpointId));
  if (!endpoint?.active) return d;
  const body = JSON.stringify({ id: d.id, event: d.event, createdAt: d.createdAt, data: d.payload });
  let code: number | null = null;
  try {
    const res = await fetcher(endpoint.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "GhostCart-Signature": signPayload(decryptSecret(endpoint.secretEncrypted), body), "GhostCart-Event": d.event, "User-Agent": "GhostCart-Webhooks/1.0" },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    code = res.status;
  } catch {
    code = null;
  }
  const ok = code !== null && code >= 200 && code < 300;
  const attempts = d.attempts + 1;
  const [updated] = await db
    .update(webhookDeliveries)
    .set({
      status: ok ? "delivered" : attempts >= MAX_ATTEMPTS ? "failed" : "pending",
      attempts,
      responseCode: code,
      // Back off 1, 2, 4 … minutes between retries.
      nextAttemptAt: ok || attempts >= MAX_ATTEMPTS ? null : new Date(Date.now() + 2 ** (attempts - 1) * 60_000),
    })
    .where(eq(webhookDeliveries.id, d.id))
    .returning();
  return updated;
}

/** Queue an event for every endpoint of the store that wants it, and try delivering right away. Never throws. */
export async function emitWebhook(storeId: string, event: WebhookEvent, data: Record<string, unknown>, fetcher?: typeof fetch) {
  try {
    const db = await getDb();
    const endpoints = (await db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.storeId, storeId), eq(webhookEndpoints.active, true)))).filter((e) => e.events.includes(event));
    for (const e of endpoints) {
      const [d] = await db.insert(webhookDeliveries).values({ id: `whd_${randomBytes(9).toString("base64url")}`, endpointId: e.id, event, payload: data }).returning();
      await attempt(d.id, fetcher);
    }
  } catch (err) {
    console.error("webhook emit failed", err); // order flow must never fail over a seller's endpoint
  }
}

/** Scheduled: retry deliveries that failed and are due. */
export async function retryWebhooks(fetcher?: typeof fetch) {
  const db = await getDb();
  const due = await db.select({ id: webhookDeliveries.id }).from(webhookDeliveries).where(and(eq(webhookDeliveries.status, "pending"), lte(webhookDeliveries.nextAttemptAt, new Date())));
  for (const d of due) await attempt(d.id, fetcher);
  return due.length;
}

/** Send a signed test event, for the seller's "Send test" button. */
export async function sendTestWebhook(storeId: string, endpointId: string) {
  const db = await getDb();
  const [e] = await db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, endpointId), eq(webhookEndpoints.storeId, storeId)));
  if (!e) throw new WebhookError("Endpoint not found.");
  const [d] = await db.insert(webhookDeliveries).values({ id: `whd_${randomBytes(9).toString("base64url")}`, endpointId: e.id, event: "order.placed", payload: { test: true, orderId: "ord_test" } }).returning();
  return attempt(d.id);
}
