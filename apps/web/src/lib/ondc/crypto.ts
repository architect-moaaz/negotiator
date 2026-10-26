import { createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";

/**
 * ONDC (Beckn) message signing: every request carries an Authorization header with an Ed25519 signature
 * over "(created) (expires) digest", where digest is BLAKE2b-512 of the exact body bytes.
 * Keys are exchanged in the formats ONDC's key utility produces: Ed25519 as base64 raw keys (a private
 * key may be the 32-byte seed or libsodium's 64-byte seed+public), X25519 as base64 DER (PKCS#8 / SPKI).
 */

const ED25519_PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");

export function ed25519PrivateKey(b64: string): KeyObject {
  const raw = Buffer.from(b64, "base64");
  if (raw.length !== 32 && raw.length !== 64) throw new Error("ONDC signing key must be a base64 Ed25519 seed (32 bytes) or seed+public (64 bytes).");
  return createPrivateKey({ key: Buffer.concat([ED25519_PKCS8, raw.subarray(0, 32)]), format: "der", type: "pkcs8" });
}

export function ed25519PublicKey(b64: string): KeyObject {
  const raw = Buffer.from(b64, "base64");
  if (raw.length !== 32) throw new Error("ONDC signing public key must be a base64 Ed25519 key (32 bytes).");
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI, raw]), format: "der", type: "spki" });
}

/** The base64 raw public key for a base64 signing key. */
export const signingPublicKeyFor = (privateKey: string) => createPublicKey(ed25519PrivateKey(privateKey)).export({ format: "der", type: "spki" }).subarray(-32).toString("base64");

/** A new signing key pair in ONDC's format (for the registry form and for tests). */
export function generateSigningKeys() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { privateKey: seed.toString("base64"), publicKey: pub.toString("base64") };
}

export const blake512 = (body: string | Uint8Array) => createHash("blake2b512").update(body).digest("base64");

const signingString = (created: number, expires: number, digest: string) => `(created): ${created}\n(expires): ${expires}\ndigest: BLAKE-512=${digest}`;

/** The Authorization header for a request body we send. Valid for an hour, like ONDC's reference SDKs. */
export function authorizationHeader(body: string, key: { subscriberId: string; ukId: string; privateKey: string }, now = Date.now()) {
  const created = Math.floor(now / 1000);
  const expires = created + 3600;
  const signature = sign(null, Buffer.from(signingString(created, expires, blake512(body))), ed25519PrivateKey(key.privateKey)).toString("base64");
  return `Signature keyId="${key.subscriberId}|${key.ukId}|ed25519",algorithm="ed25519",created="${created}",expires="${expires}",headers="(created) (expires) digest",signature="${signature}"`;
}

export interface ParsedAuth {
  subscriberId: string;
  ukId: string;
  created: number;
  expires: number;
  signature: string;
}

export function parseAuthorization(header: string | null): ParsedAuth | null {
  if (!header?.startsWith("Signature ")) return null;
  const fields = Object.fromEntries([...header.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const [subscriberId, ukId, algo] = (fields.keyId ?? "").split("|");
  if (!subscriberId || !ukId || algo !== "ed25519" || !fields.signature) return null;
  return { subscriberId, ukId, created: Number(fields.created), expires: Number(fields.expires), signature: fields.signature };
}

/** Whether an inbound body was signed by the holder of this public key, inside its validity window. */
export function verifyAuthorization(body: string, auth: ParsedAuth, publicKey: string, now = Date.now()) {
  const t = Math.floor(now / 1000);
  if (!Number.isFinite(auth.created) || !Number.isFinite(auth.expires) || auth.created > t + 60 || auth.expires < t) return false;
  try {
    return verify(null, Buffer.from(signingString(auth.created, auth.expires, blake512(body))), ed25519PublicKey(publicKey), Buffer.from(auth.signature, "base64"));
  } catch {
    return false;
  }
}

/**
 * Registry onboarding: the registry encrypts a challenge with AES-256-ECB under the X25519 shared secret of
 * its key and ours; /on_subscribe answers with the plaintext.
 */
export function decryptChallenge(challengeB64: string, ourEncryptionPrivateDer: string, registryEncryptionPublicDer: string) {
  const secret = diffieHellman({
    privateKey: createPrivateKey({ key: Buffer.from(ourEncryptionPrivateDer, "base64"), format: "der", type: "pkcs8" }),
    publicKey: createPublicKey({ key: Buffer.from(registryEncryptionPublicDer, "base64"), format: "der", type: "spki" }),
  });
  const decipher = createDecipheriv("aes-256-ecb", secret, null);
  return Buffer.concat([decipher.update(Buffer.from(challengeB64, "base64")), decipher.final()]).toString("utf8");
}

/** The signed request_id ONDC's registry looks for in /ondc-site-verification.html. */
export const signRequestId = (requestId: string, privateKey: string) => sign(null, Buffer.from(requestId), ed25519PrivateKey(privateKey)).toString("base64");
