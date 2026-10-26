import { schema } from "@ghostcart/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import { identityHash } from "../verification/identity-hash";

const { deviceLinks, riskEvents } = schema;

/** A device is the browser's long-lived visitor cookie, hashed. A signal, not proof: cookies can be cleared. */
export function deviceHash(request: Request) {
  const vid = request.headers.get("cookie")?.match(/(?:^|; )gc_vid=([^;]+)/)?.[1];
  return vid ? identityHash("device", decodeURIComponent(vid)) : undefined;
}

export async function recordRisk(kind: string, action: "blocked" | "flagged" | "info", subjectType: string, subjectId: string, details: Record<string, unknown> = {}) {
  const db = await getDb();
  await db.insert(riskEvents).values({ kind, action, subjectType, subjectId, details });
}

/** Remember that this account used this device; flags one device behind many shopper accounts. */
export async function linkDevice(request: Request, actorType: "buyer" | "member", actorId: string) {
  const device = deviceHash(request);
  if (!device) return;
  try {
    const db = await getDb();
    await db
      .insert(deviceLinks)
      .values({ deviceHash: device, actorType, actorId })
      .onConflictDoUpdate({ target: [deviceLinks.deviceHash, deviceLinks.actorType, deviceLinks.actorId], set: { lastSeen: new Date() } });
    if (actorType === "buyer") {
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(deviceLinks)
        .where(and(eq(deviceLinks.deviceHash, device), eq(deviceLinks.actorType, "buyer")));
      if (n > 3) await recordRisk("multi_account", "flagged", "device", device, { buyerAccounts: n, latest: actorId });
    }
  } catch (err) {
    console.error("device link failed", err); // never block sign-in over a fraud signal
  }
}

/** Members of an org who have used this device. */
export async function deviceUsedByMembers(device: string | undefined, memberPhones: string[]) {
  if (!device || !memberPhones.length) return false;
  const db = await getDb();
  const rows = await db
    .select({ actorId: deviceLinks.actorId })
    .from(deviceLinks)
    .where(and(eq(deviceLinks.deviceHash, device), eq(deviceLinks.actorType, "member"), inArray(deviceLinks.actorId, memberPhones)))
    .limit(1);
  return rows.length > 0;
}
