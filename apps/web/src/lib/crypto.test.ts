import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { schema } from "@ghostcart/db";
import { createTestDb } from "@ghostcart/db/testing";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, newKekBase64, rewrapSecret, secretKeyId } from "./crypto";
import { rotateStoredSecrets } from "./secrets-rotation";

const env = { ...process.env };
afterEach(() => {
  for (const k of ["SECRETS_KEYS", "SECRETS_KEY_ID", "SECRETS_KEY"]) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
});

/** A value sealed the old way (v1: AES-GCM straight under sha256(SECRETS_KEY)). */
function legacyV1(plain: string, raw: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", createHash("sha256").update(raw).digest(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

describe("envelope encryption", () => {
  it("seals each secret under its own data key, wrapped by the named key-encryption key", () => {
    process.env.SECRETS_KEYS = `k2:${newKekBase64()}`;
    const a = encryptSecret("shpat_zz_token");
    const b = encryptSecret("shpat_zz_token");
    expect(a.split(".")).toHaveLength(8);
    expect(secretKeyId(a)).toBe("k2");
    expect(a).not.toBe(b); // fresh data key and IVs every time
    expect(decryptSecret(a)).toBe("shpat_zz_token");
  });

  it("rejects tampering and values whose key isn't configured", () => {
    process.env.SECRETS_KEYS = `k2:${newKekBase64()}`;
    const v = encryptSecret("zz-secret").split(".");
    v[7] = Buffer.from("zz-forged").toString("base64url");
    expect(() => decryptSecret(v.join("."))).toThrow();
    const other = encryptSecret("zz").replace("v2.k2.", "v2.k9.");
    expect(() => decryptSecret(other)).toThrow('no key-encryption key "k9"');
    process.env.SECRETS_KEYS = "bad";
    expect(() => encryptSecret("x")).toThrow("SECRETS_KEYS");
  });

  it("still opens v1 values sealed under the old SECRETS_KEY, and rotates everything onto a new key", async () => {
    process.env.SECRETS_KEY = "zz-old-single-key";
    delete process.env.SECRETS_KEYS;
    const old = legacyV1("zz-woo-secret", "zz-old-single-key");
    expect(decryptSecret(old)).toBe("zz-woo-secret");
    const k0 = encryptSecret("zz-webhook-secret");
    expect(secretKeyId(k0)).toBe("k0");

    const db = await createTestDb();
    const [store] = await db.insert(schema.orgs).values({ id: "org_zzrot", name: "ZZ Rot" }).returning();
    await db.insert(schema.stores).values({ id: "st_zzrot", orgId: store.id, name: "ZZ Rot", slug: "zz-rot", platform: "woocommerce" });
    await db.insert(schema.platformConnections).values({ id: "pcn_zzrot", storeId: "st_zzrot", platform: "woocommerce", externalId: "zz-rot.test", accessTokenEncrypted: old, scopes: "x", meta: { pinEncrypted: k0 } });

    // A new key goes in front; the old one stays until rotation is done.
    process.env.SECRETS_KEYS = `k1:${newKekBase64()}`;
    process.env.SECRETS_KEY_ID = "k1";
    const dry = await rotateStoredSecrets(db);
    expect(dry).toMatchObject({ byKey: { k0: 2 }, changed: 2, written: false });
    await rotateStoredSecrets(db, { write: true });
    const [row] = await db.select().from(schema.platformConnections).where(eq(schema.platformConnections.id, "pcn_zzrot"));
    expect(secretKeyId(row.accessTokenEncrypted)).toBe("k1");
    expect(secretKeyId(row.meta.pinEncrypted as string)).toBe("k1");
    // With the old key removed, everything still opens.
    delete process.env.SECRETS_KEY;
    expect(decryptSecret(row.accessTokenEncrypted)).toBe("zz-woo-secret");
    expect(decryptSecret(row.meta.pinEncrypted as string)).toBe("zz-webhook-secret");
    expect((await rotateStoredSecrets(db)).changed).toBe(0);
  });

  it("re-wraps only the data key, leaving the ciphertext untouched", () => {
    const k1 = newKekBase64();
    process.env.SECRETS_KEYS = `k1:${k1}`;
    const v = encryptSecret("zz");
    process.env.SECRETS_KEYS = `k2:${newKekBase64()},k1:${k1}`;
    const r = rewrapSecret(v);
    expect(r.split(".").slice(5)).toEqual(v.split(".").slice(5));
    expect(secretKeyId(r)).toBe("k2");
    expect(decryptSecret(r)).toBe("zz");
  });
});
