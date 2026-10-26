import { schema } from "@ghostcart/db";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { ACK, logMessage, nack } from "./client";
import { ondcConfig } from "./config";
import { parseAuthorization, verifyAuthorization } from "./crypto";
import { lookupSigningKey } from "./registry";

const { ondcMessages } = schema;

export const CALLBACKS = new Set(["on_search", "on_select", "on_init", "on_confirm", "on_status", "on_cancel", "on_update", "on_track", "on_support", "on_issue", "on_issue_status"]);

/**
 * A seller app's callback. Accepted only if it's signed by the seller app named in its context (key from
 * the registry), addressed to us, and answers a transaction we started. Returns the Beckn reply and status.
 */
export async function receiveCallback(action: string, rawBody: string, authorization: string | null): Promise<{ status: number; body: unknown }> {
  if (!CALLBACKS.has(action)) return { status: 404, body: nack("10000", `Unknown action ${action}.`) };
  let payload: { context?: Record<string, unknown>; message?: unknown; error?: unknown };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: nack("10000", "Body isn't JSON.", "JSON-SCHEMA-ERROR") };
  }
  const ctx = payload.context ?? {};
  const c = ondcConfig();
  if (ctx.action !== action || ctx.bap_id !== c.subscriberId || typeof ctx.transaction_id !== "string" || typeof ctx.bpp_id !== "string")
    return { status: 400, body: nack("10000", "Context doesn't match this buyer app or action.") };

  const auth = parseAuthorization(authorization);
  if (!auth || auth.subscriberId !== ctx.bpp_id) return { status: 401, body: nack("10001", "Missing or mismatched signature.", "POLICY-ERROR") };
  let key = await lookupSigningKey(auth.subscriberId, auth.ukId);
  let valid = !!key && verifyAuthorization(rawBody, auth, key);
  if (!valid) {
    key = await lookupSigningKey(auth.subscriberId, auth.ukId, { fresh: true }); // the seller app may have rotated keys
    valid = !!key && verifyAuthorization(rawBody, auth, key);
  }
  if (!valid) return { status: 401, body: nack("10001", "Signature didn't verify.", "POLICY-ERROR") };

  const db = await getDb();
  const [started] = await db
    .select({ userId: ondcMessages.userId })
    .from(ondcMessages)
    .where(and(eq(ondcMessages.transactionId, ctx.transaction_id), eq(ondcMessages.direction, "out")))
    .limit(1);
  if (!started) return { status: 400, body: nack("10002", "Unknown transaction.") };

  await logMessage({ transactionId: ctx.transaction_id, messageId: String(ctx.message_id ?? ""), action, direction: "in", counterparty: ctx.bpp_id, userId: started.userId, payload: payload as Record<string, unknown> });
  return { status: 200, body: ACK };
}
