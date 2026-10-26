import { schema } from "@ghostcart/db";
import { and, eq, isNull } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "../crypto";
import { getDb } from "../db";
import { store as kv } from "../store";
import { normalizePhone } from "../users";

const { platformConnections } = schema;

/**
 * WhatsApp through a BSP (Gupshup) while Meta Tech Provider approval is pending, behind the same chat
 * engine and transport as the Meta Cloud API. The seller brings their Gupshup app (name, API key,
 * WhatsApp number). Gupshup doesn't sign callbacks, so each connection gets a secret inbound URL;
 * only its hash is stored. GUPSHUP_API_BASE points at the in-repo mock in development and tests.
 */
export const gupshupBase = () => (process.env.VERCEL_ENV !== "production" && process.env.GUPSHUP_API_BASE ? process.env.GUPSHUP_API_BASE.replace(/\/$/, "") : "https://api.gupshup.io");

export class GupshupError extends Error {}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const digits = (e164: string) => e164.replace(/^\+/, "");

export async function connectGupshup(storeId: string, input: { appName?: string; apiKey?: string; phone?: string }) {
  const appName = String(input.appName ?? "").trim();
  const apiKey = String(input.apiKey ?? "").trim();
  const phone = normalizePhone(String(input.phone ?? ""));
  if (!/^[\w-]{2,64}$/.test(appName)) throw new GupshupError("Add your Gupshup app name (letters, digits, - and _).");
  if (apiKey.length < 16) throw new GupshupError("Paste the API key from your Gupshup app's settings.");
  if (!phone) throw new GupshupError("Add the WhatsApp number on your Gupshup app (a 10-digit Indian mobile number).");
  const token = randomBytes(24).toString("base64url");
  const db = await getDb();
  await db
    .insert(platformConnections)
    .values({ id: `pcn_${randomBytes(8).toString("base64url")}`, storeId, platform: "gupshup", externalId: digits(phone), accessTokenEncrypted: encryptSecret(apiKey), scopes: "whatsapp", meta: { appName, webhookTokenHash: tokenHash(token), displayPhone: phone } })
    .onConflictDoUpdate({ target: [platformConnections.platform, platformConnections.externalId], set: { storeId, accessTokenEncrypted: encryptSecret(apiKey), meta: { appName, webhookTokenHash: tokenHash(token), displayPhone: phone }, uninstalledAt: null, installedAt: new Date() } });
  // Shown once: the seller pastes it into Gupshup as the inbound message callback.
  return { webhookUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/gupshup/webhook/${token}`, phone };
}

export async function gupshupByToken(token: string) {
  const db = await getDb();
  const rows = await db.select().from(platformConnections).where(and(eq(platformConnections.platform, "gupshup"), isNull(platformConnections.uninstalledAt)));
  const hash = tokenHash(token);
  return rows.find((r) => r.meta.webhookTokenHash === hash);
}

export async function gupshupConnection(source: string) {
  const db = await getDb();
  const [row] = await db.select().from(platformConnections).where(and(eq(platformConnections.platform, "gupshup"), eq(platformConnections.externalId, source), isNull(platformConnections.uninstalledAt)));
  return row;
}

/** Send a WhatsApp text from the seller's Gupshup number. */
export async function sendGupshupText(source: string, to: string, text: string) {
  const conn = await gupshupConnection(source);
  if (!conn) throw new GupshupError("This store's Gupshup connection is gone.");
  const res = await fetch(`${gupshupBase()}/wa/api/v1/msg`, {
    method: "POST",
    headers: { apikey: decryptSecret(conn.accessTokenEncrypted), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ channel: "whatsapp", source, destination: to, "src.name": String(conn.meta.appName ?? ""), message: JSON.stringify({ type: "text", text: text.slice(0, 4000) }) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new GupshupError(`Gupshup ${res.status}`);
}

interface GupshupInbound {
  type?: string;
  payload?: { id?: string; source?: string; type?: string; payload?: { text?: string; title?: string }; sender?: { phone?: string; name?: string } };
}

/** An inbound callback: shopper text messages only (delivery receipts and other events are ignored), each once. */
export async function readGupshupInbound(body: GupshupInbound) {
  if (body.type !== "message") return null;
  const p = body.payload;
  const from = p?.sender?.phone ?? p?.source;
  const text = p?.payload?.text ?? p?.payload?.title ?? "";
  if (!p?.id || !from || !text || !(await kv.claimOnce(`gs:msg:${p.id}`, 7 * 24 * 60 * 60))) return null;
  return { from, name: p.sender?.name, text };
}
