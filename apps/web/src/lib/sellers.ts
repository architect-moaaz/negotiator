import { createHash, randomBytes } from "node:crypto";
import { sessionSubject, sessionTokenFromRequest } from "./session";
import { store } from "./store";
import type { Seller } from "./types";

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

/** Seller from a session cookie (phone login) or a Bearer seller key. */
export async function sellerFromRequest(request: Request) {
  const id = await sessionSubject("seller", sessionTokenFromRequest("seller", request));
  if (id) return store.getSeller(id);
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return undefined;
  const tokenOwner = await store.sellerIdForToken(hashToken(token));
  return tokenOwner ? store.getSeller(tokenOwner) : undefined;
}
