import { schema, type Db } from "@ghostcart/db";
import { eq } from "drizzle-orm";
import { rewrapSecret, secretKeyId } from "./crypto";

const { platformConnections, webhookEndpoints } = schema;

/**
 * Every stored secret, re-wrapped onto the current key-encryption key: platform access tokens, the
 * WhatsApp number PIN in connection meta, and webhook signing secrets. Dry run by default (counts what
 * would change); with write=true each row is updated. Safe to re-run: current values are left alone.
 */
export async function rotateStoredSecrets(db: Db, { write = false } = {}) {
  const byKey: Record<string, number> = {};
  let changed = 0;
  const note = (v: string | undefined | null) => {
    if (!v) return v;
    const kid = secretKeyId(v) ?? "unknown";
    byKey[kid] = (byKey[kid] ?? 0) + 1;
    const next = rewrapSecret(v);
    if (next !== v) changed++;
    return next;
  };

  for (const c of await db.select().from(platformConnections)) {
    const token = note(c.accessTokenEncrypted)!;
    const pin = note(c.meta.pinEncrypted as string | undefined);
    if (write && (token !== c.accessTokenEncrypted || pin !== c.meta.pinEncrypted))
      await db.update(platformConnections).set({ accessTokenEncrypted: token, meta: pin ? { ...c.meta, pinEncrypted: pin } : c.meta }).where(eq(platformConnections.id, c.id));
  }
  for (const w of await db.select().from(webhookEndpoints)) {
    const secret = note(w.secretEncrypted)!;
    if (write && secret !== w.secretEncrypted) await db.update(webhookEndpoints).set({ secretEncrypted: secret }).where(eq(webhookEndpoints.id, w.id));
  }
  return { byKey, changed, written: write };
}
