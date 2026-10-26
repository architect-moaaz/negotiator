import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Secrets GhostCart must be able to read back (platform access tokens, webhook signing secrets, a
 * WhatsApp number's PIN) use envelope encryption: each secret gets its own random data key (DEK), the
 * secret is sealed with it (AES-256-GCM), and the DEK is wrapped by a key-encryption key (KEK) named by
 * an id. Rotating the KEK only re-wraps the 32-byte DEKs (see rewrapSecret, scripts/rotate-secrets.mts).
 *
 * KEKs come from SECRETS_KEYS ("k2:<base64 32 bytes>,k1:<…>"); SECRETS_KEY_ID picks the one new secrets
 * use (default: the first). The older single SECRETS_KEY still works as kid "k0", so existing deployments
 * keep running, and values sealed before envelopes existed ("v1.") still decrypt.
 */

type Kek = { id: string; key: Buffer };

const sha = (raw: string) => createHash("sha256").update(raw).digest(); // 32 bytes from any input

function keks(): Kek[] {
  const list: Kek[] = [];
  for (const part of (process.env.SECRETS_KEYS ?? "").split(",").map((p) => p.trim()).filter(Boolean)) {
    const [id, b64] = part.split(":");
    const key = Buffer.from(b64 ?? "", "base64");
    if (!/^[\w-]{1,16}$/.test(id ?? "") || key.length !== 32) throw new Error("SECRETS_KEYS entries are id:<base64 of 32 bytes>");
    list.push({ id, key });
  }
  const legacy = process.env.SECRETS_KEY ?? (process.env.VERCEL_ENV || list.length ? "" : "ghostcart-dev-secrets-key");
  if (legacy) list.push({ id: "k0", key: sha(legacy) });
  if (!list.length) throw new Error("SECRETS_KEYS (or SECRETS_KEY) is not set");
  return list;
}

function currentKek() {
  const all = keks();
  const wanted = process.env.SECRETS_KEY_ID;
  const kek = wanted ? all.find((k) => k.id === wanted) : all[0];
  if (!kek) throw new Error(`SECRETS_KEY_ID ${wanted} isn't in SECRETS_KEYS`);
  return kek;
}

function kekById(id: string) {
  const kek = keks().find((k) => k.id === id);
  if (!kek) throw new Error(`no key-encryption key "${id}" configured`);
  return kek;
}

const b64 = (b: Buffer) => b.toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url");

function seal(key: Buffer, plain: Buffer, aad: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return { iv, tag: c.getAuthTag(), body };
}

function open(key: Buffer, iv: Buffer, tag: Buffer, body: Buffer, aad: string) {
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]);
}

/** "v2.<kid>.<wrap iv>.<wrap tag>.<wrapped DEK>.<iv>.<tag>.<ciphertext>" */
export function encryptSecret(plain: string) {
  const kek = currentKek();
  const dek = randomBytes(32);
  const wrapped = seal(kek.key, dek, `ghostcart:dek:${kek.id}`);
  const sealed = seal(dek, Buffer.from(plain, "utf8"), "ghostcart:secret:v2");
  return ["v2", kek.id, b64(wrapped.iv), b64(wrapped.tag), b64(wrapped.body), b64(sealed.iv), b64(sealed.tag), b64(sealed.body)].join(".");
}

export function decryptSecret(value: string) {
  const parts = value.split(".");
  if (parts[0] === "v2" && parts.length === 8) {
    const [, kid, wiv, wtag, wdek, iv, tag, body] = parts;
    const dek = open(kekById(kid).key, unb64(wiv), unb64(wtag), unb64(wdek), `ghostcart:dek:${kid}`);
    return open(dek, unb64(iv), unb64(tag), unb64(body), "ghostcart:secret:v2").toString("utf8");
  }
  if (parts[0] === "v1" && parts.length === 4) {
    // Before envelopes: sealed directly under the single SECRETS_KEY (kid k0), without AAD.
    const [, iv, tag, body] = parts;
    const d = createDecipheriv("aes-256-gcm", kekById("k0").key, unb64(iv));
    d.setAuthTag(unb64(tag));
    return Buffer.concat([d.update(unb64(body)), d.final()]).toString("utf8");
  }
  throw new Error("unknown secret format");
}

/** Which key-encryption key protects a stored value ("v1" values count as k0). */
export const secretKeyId = (value: string) => (value.startsWith("v2.") ? value.split(".")[1] : value.startsWith("v1.") ? "k0" : null);

/**
 * Move a stored value onto the current KEK. v2 values only have their DEK re-wrapped (the ciphertext is
 * untouched); v1 values are re-sealed as v2. Already-current values come back unchanged.
 */
export function rewrapSecret(value: string) {
  const kek = currentKek();
  if (secretKeyId(value) === kek.id && value.startsWith("v2.")) return value;
  if (value.startsWith("v1.")) return encryptSecret(decryptSecret(value));
  const [, kid, wiv, wtag, wdek, iv, tag, body] = value.split(".");
  const dek = open(kekById(kid).key, unb64(wiv), unb64(wtag), unb64(wdek), `ghostcart:dek:${kid}`);
  const wrapped = seal(kek.key, dek, `ghostcart:dek:${kek.id}`);
  return ["v2", kek.id, b64(wrapped.iv), b64(wrapped.tag), b64(wrapped.body), iv, tag, body].join(".");
}

/** A fresh KEK for SECRETS_KEYS: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. */
export const newKekBase64 = () => randomBytes(32).toString("base64");
