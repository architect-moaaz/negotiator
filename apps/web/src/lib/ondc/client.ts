import { schema } from "@ghostcart/db";
import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import { authorizationHeader } from "./crypto";
import { ondcConfig } from "./config";

const { ondcMessages } = schema;

export interface Context {
  domain: string;
  country: string;
  city: string;
  action: string;
  core_version: string;
  bap_id: string;
  bap_uri: string;
  bpp_id?: string;
  bpp_uri?: string;
  transaction_id: string;
  message_id: string;
  timestamp: string;
  ttl: string;
}

export const ACK = { message: { ack: { status: "ACK" } } };
export const nack = (code: string, message: string, type = "CONTEXT-ERROR") => ({ message: { ack: { status: "NACK" } }, error: { type, code, message } });

export function context(action: string, transactionId: string, bpp?: { id: string; uri: string }, coreVersion?: string): Context {
  const c = ondcConfig();
  return {
    domain: c.domain,
    country: "IND",
    city: c.city,
    action,
    core_version: coreVersion ?? c.coreVersion,
    bap_id: c.subscriberId,
    bap_uri: c.bapUri,
    ...(bpp && { bpp_id: bpp.id, bpp_uri: bpp.uri }),
    transaction_id: transactionId,
    message_id: randomUUID(),
    timestamp: new Date().toISOString(),
    ttl: "PT30S",
  };
}

export async function logMessage(row: { transactionId: string; messageId: string; action: string; direction: "in" | "out"; counterparty: string; userId?: string | null; payload: Record<string, unknown> }) {
  const db = await getDb();
  await db.insert(ondcMessages).values({ ...row, userId: row.userId ?? null });
}

export class OndcError extends Error {}

/** Sign and send one Beckn request, log it, and return the participant's ACK (or throw on NACK). */
export async function send(url: string, ctx: Context, message: Record<string, unknown>, userId?: string) {
  const c = ondcConfig();
  const body = JSON.stringify({ context: ctx, message });
  await logMessage({ transactionId: ctx.transaction_id, messageId: ctx.message_id, action: ctx.action, direction: "out", counterparty: ctx.bpp_id ?? "gateway", userId, payload: JSON.parse(body) });
  const res = await fetch(`${url.replace(/\/$/, "")}/${ctx.action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authorizationHeader(body, { subscriberId: c.subscriberId, ukId: c.ukId, privateKey: c.signingPrivateKey }) },
    body,
  });
  const reply = (await res.json().catch(() => null)) as { message?: { ack?: { status?: string } }; error?: { message?: string } } | null;
  if (!res.ok || reply?.message?.ack?.status !== "ACK") throw new OndcError(reply?.error?.message ?? `The seller app didn't accept the ${ctx.action} (HTTP ${res.status}).`);
  return ctx;
}
