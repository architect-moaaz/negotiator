/**
 * Rotate the key-encryption key for stored secrets (see src/lib/crypto.ts):
 *   1. Add a new key in front of SECRETS_KEYS (keep the old ones) and set SECRETS_KEY_ID to it; deploy.
 *   2. pnpm --filter @ghostcart/web db:rotate-secrets            # dry run: counts per key
 *      pnpm --filter @ghostcart/web db:rotate-secrets --confirm  # re-wrap every stored secret
 *   3. Once the dry run shows nothing left on the old key, remove it from SECRETS_KEYS.
 * Needs DATABASE_URL and the same SECRETS_KEYS / SECRETS_KEY / SECRETS_KEY_ID as the deployment.
 */
import { createDb } from "@ghostcart/db";
import { rotateStoredSecrets } from "../src/lib/secrets-rotation";

if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL (and the deployment's SECRETS_* keys).");
  process.exit(1);
}
const write = process.argv.includes("--confirm");
const out = await rotateStoredSecrets(createDb(process.env.DATABASE_URL), { write });
console.log(`Secrets by key before: ${JSON.stringify(out.byKey)}; ${out.changed} ${write ? "re-wrapped" : "would be re-wrapped"} onto the current key.`);
process.exit(0);
