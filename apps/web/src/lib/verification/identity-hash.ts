import { createHmac } from "node:crypto";

/**
 * Keyed hash of a PAN or bank account, so the same identity reused across seller accounts can be
 * spotted without keeping the number. IDENTITY_HASH_SECRET must be set in deployments.
 */
export function identityHash(kind: "pan" | "bank", value: string) {
  const secret = process.env.IDENTITY_HASH_SECRET ?? (process.env.VERCEL_ENV ? "" : "ghostcart-dev-identity-secret");
  if (!secret) throw new Error("IDENTITY_HASH_SECRET is not set");
  return createHmac("sha256", secret).update(`${kind}:${value.toUpperCase().replace(/\s/g, "")}`).digest("hex");
}
