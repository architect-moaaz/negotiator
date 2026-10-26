import { schema } from "@ghostcart/db";
import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/db";
import { bearer, storeForKey } from "@/lib/integrations/keys";
import { verifyPluginOwnership, wooConnectionForStore, WooError } from "@/lib/woocommerce/client";

/** Step 2: GhostCart calls back the site; if the plugin signs our nonce, the seller controls the site. */
export async function POST(request: Request) {
  const found = await storeForKey(bearer(request), "secret");
  if (!found) return Response.json({ error: "Invalid or revoked API key." }, { status: 401 });
  const conn = await wooConnectionForStore(found.store.id);
  if (!conn) return Response.json({ error: "Connect the plugin first." }, { status: 409 });
  let ok = false;
  let reason = "";
  try {
    ok = await verifyPluginOwnership(conn.externalId, conn.accessTokenEncrypted);
  } catch (err) {
    reason = err instanceof WooError ? err.message : "We couldn't reach your site.";
  }
  const db = await getDb();
  await db.insert(schema.kycChecks).values({
    id: `kyc_${randomBytes(9).toString("base64url")}`,
    orgId: found.store.orgId,
    storeId: found.store.id,
    type: "ownership_platform",
    status: ok ? "passed" : "failed",
    provider: "woocommerce",
    masked: conn.externalId,
    details: { reason: ok ? "The GhostCart plugin on the site signed our check." : reason || "The plugin's answer didn't match." },
  });
  return Response.json({ verified: ok, reason: reason || undefined }, { status: ok ? 200 : 409 });
}
