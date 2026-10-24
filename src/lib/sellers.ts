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

export async function sellerFromRequest(request: Request) {
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
