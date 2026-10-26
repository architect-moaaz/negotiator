import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Secrets GhostCart must be able to read back (webhook signing secrets, later a seller's own gateway
 * credentials) are encrypted with AES-256-GCM under SECRETS_KEY. Required in deployments.
 */
function key() {
  const raw = process.env.SECRETS_KEY ?? (process.env.VERCEL_ENV ? "" : "ghostcart-dev-secrets-key");
  if (!raw) throw new Error("SECRETS_KEY is not set");
  return createHash("sha256").update(raw).digest(); // 32 bytes from any length of input
}

export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function decryptSecret(sealed: string) {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1") throw new Error("unknown secret format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}
