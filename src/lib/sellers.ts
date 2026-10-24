import { createHash, randomBytes } from "node:crypto";
import { store } from "./store";
import type { ListingSeller, Seller } from "./types";

const NOISE = new Set(["private", "pvt", "limited", "ltd", "llp", "inc", "co", "company", "the", "official", "store", "india", "online"]);

/** "Clicktech Retail Private Ltd." → "clicktechretail", so marketplace names match what sellers type. */
export function normalizeSellerName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !NOISE.has(w))
    .join("");
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSeller(input: {
  storeName: string;
  aliases: string[];
  contactName: string;
  phone: string;
  budgetPct: number;
  autoApproveShare: number;
}) {
  const aliases = [...new Set([input.storeName, ...input.aliases].map(normalizeSellerName).filter(Boolean))];
  const seller: Seller = { id: crypto.randomUUID(), ...input, aliases, createdAt: Date.now() };
  const token = randomBytes(18).toString("base64url");
  await store.saveSeller(seller, hashToken(token));
  await store.log({
    type: "seller_signup",
    actor: "seller",
    detail: `${seller.storeName} joined GhostCart (funds up to ${(seller.budgetPct * 100).toFixed(0)}% off, agent auto-approves ${(seller.autoApproveShare * 100).toFixed(0)}% of that); matches ${aliases.join(", ")}`,
  });
  return { seller, token };
}

export const SELLER_SESSION_COOKIE = "gc_sid";
const SELLER_SESSION_TTL_S = 7 * 24 * 60 * 60;

/** Start a seller session (after phone login or signup); returns the cookie value. */
export async function createSellerSession(sellerId: string) {
  const sid = randomBytes(24).toString("base64url");
  await store.kvSet(`sellerSession:${hashToken(sid)}`, sellerId, SELLER_SESSION_TTL_S);
  return { sid, maxAge: SELLER_SESSION_TTL_S };
}

export async function endSellerSession(sid: string | undefined) {
  if (sid) await store.kvDel(`sellerSession:${hashToken(sid)}`);
}

/** Seller from a session cookie (phone login) or a Bearer seller key. */
export async function sellerFromRequest(request: Request) {
  const cookie = request.headers.get("cookie")?.match(new RegExp(`(?:^|; )${SELLER_SESSION_COOKIE}=([^;]+)`))?.[1];
  if (cookie) {
    const id = await store.kvGet<string>(`sellerSession:${hashToken(decodeURIComponent(cookie))}`);
    if (id) return store.getSeller(id);
  }
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return undefined;
  const id = await store.sellerIdForToken(hashToken(token));
  return id ? store.getSeller(id) : undefined;
}

/** Find the GhostCart seller behind a marketplace listing, and count the demand either way. */
export async function matchListingSeller(soldBy: ListingSeller) {
  const key = normalizeSellerName(soldBy.name);
  if (!key) return undefined;
  await store.recordDemand(key, soldBy.name, soldBy.marketplace);
  const id = await store.sellerIdForAlias(key);
  return id ? store.getSeller(id) : undefined;
}
