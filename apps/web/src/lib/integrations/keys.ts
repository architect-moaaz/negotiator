import { schema } from "@ghostcart/db";
import { and, eq, isNull } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { getDb } from "../db";
import { getStore, type Store } from "../shop/stores";

const { apiKeys } = schema;
export type ApiKeyKind = "publishable" | "secret";

const hash = (key: string) => createHash("sha256").update(key).digest("hex");

/** "https://www.Shop.in/" → "https://www.shop.in"; null if it isn't an https (or localhost) origin. */
export function normalizeOrigin(raw: string) {
  try {
    const u = new URL(raw.trim());
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return null;
    return `${u.protocol}//${u.host.toLowerCase()}`;
  } catch {
    return null;
  }
}

/** A new key; the full value is returned once and never stored. */
export async function createApiKey(store: Store, kind: ApiKeyKind, createdBy: string, origins: string[] = []) {
  const allowed = [...new Set(origins.map(normalizeOrigin).filter((o): o is string => !!o))];
  if (kind === "publishable" && !allowed.length && store.domain) allowed.push(`https://${store.domain}`, `https://www.${store.domain}`);
  if (kind === "publishable" && !allowed.length) throw new Error("Add the website address the widget will run on.");
  const value = `gc_${kind === "publishable" ? "pk" : "sk"}_${randomBytes(24).toString("base64url")}`;
  const db = await getDb();
  const [row] = await db
    .insert(apiKeys)
    .values({ id: `key_${randomBytes(8).toString("base64url")}`, storeId: store.id, kind, keyHash: hash(value), prefix: value.slice(0, 12), allowedOrigins: allowed, createdBy })
    .returning();
  return { value, key: row };
}

export async function listApiKeys(storeId: string) {
  const db = await getDb();
  return (await db.select().from(apiKeys).where(eq(apiKeys.storeId, storeId))).map((k) => ({ ...k, keyHash: undefined }));
}

export async function revokeApiKey(storeId: string, keyId: string) {
  const db = await getDb();
  const [row] = await db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.id, keyId), eq(apiKeys.storeId, storeId))).returning();
  return !!row;
}

/** The store behind a key, if the key is live (and, for publishable keys, used from an allowed origin). */
export async function storeForKey(value: string | null | undefined, kind: ApiKeyKind, origin?: string | null) {
  if (!value || !value.startsWith(kind === "publishable" ? "gc_pk_" : "gc_sk_")) return null;
  const db = await getDb();
  const [row] = await db.select().from(apiKeys).where(and(eq(apiKeys.keyHash, hash(value)), eq(apiKeys.kind, kind), isNull(apiKeys.revokedAt)));
  if (!row) return null;
  if (kind === "publishable" && origin !== undefined) {
    const o = origin ? normalizeOrigin(origin) : null;
    if (!o || !row.allowedOrigins.includes(o)) return null;
  }
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
  const store = await getStore(row.storeId);
  return store ? { store, key: row } : null;
}

/** Secret key from "Authorization: Bearer gc_sk_…". */
export const bearer = (request: Request) => request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;

/** A return URL is safe only if it's on one of the store's widget origins (stops open redirects). */
export async function allowedReturnUrl(storeId: string, raw: string | null | undefined) {
  if (!raw) return null;
  const origin = normalizeOrigin(raw);
  if (!origin) return null;
  const db = await getDb();
  const keys = await db.select({ allowedOrigins: apiKeys.allowedOrigins }).from(apiKeys).where(and(eq(apiKeys.storeId, storeId), eq(apiKeys.kind, "publishable"), isNull(apiKeys.revokedAt)));
  return keys.some((k) => k.allowedOrigins.includes(origin)) ? new URL(raw).toString() : null;
}
