import { schema } from "@ghostcart/db";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { mayContact } from "./privacy/consent";
import { approverPhones } from "./shop/orgs";
import { store as kv } from "./store";
import { sendWebPush } from "./web-push";

const { pushTokens } = schema;

export type PushActor = "buyer" | "member";
export interface PushMessage {
  title: string;
  body: string;
  /** What the app opens when the notification is tapped. */
  data: { type: "approval"; storeId: string; dealId: string } | { type: "deal"; dealId: string } | { type: "order"; dealId: string };
}

const EXPO_TOKEN = /^Expo(nent)?PushToken\[[\w-]+\]$/;
const pushUrl = () => process.env.EXPO_PUSH_URL ?? "https://exp.host/--/api/v2/push/send";

export class PushError extends Error {}

export async function registerPushToken(actorType: PushActor, actorId: string, token: string, platform: string) {
  if (!EXPO_TOKEN.test(token)) throw new PushError("That isn't an Expo push token.");
  if (platform !== "ios" && platform !== "android") throw new PushError("Platform must be ios or android.");
  const db = await getDb();
  // One row per phone per role: if someone else signs in on this phone, that role's notifications go to them.
  await db
    .insert(pushTokens)
    .values({ token, actorType, actorId, platform })
    .onConflictDoUpdate({ target: [pushTokens.token, pushTokens.actorType], set: { actorId, platform, lastSeen: new Date() } });
}

export async function unregisterPushToken(actorType: PushActor, actorId: string, token: string) {
  const db = await getDb();
  await db.delete(pushTokens).where(and(eq(pushTokens.token, token), eq(pushTokens.actorType, actorType), eq(pushTokens.actorId, actorId)));
}

/** Send to every phone these accounts are signed in on. Never throws: a notification must not break a deal. */
async function send(actorType: PushActor, actorIds: string[], msg: PushMessage) {
  if (!actorIds.length) return 0;
  try {
    const db = await getDb();
    const rows = await db.select().from(pushTokens).where(and(eq(pushTokens.actorType, actorType), inArray(pushTokens.actorId, actorIds)));
    if (!rows.length) return 0;
    const res = await fetch(pushUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...(process.env.EXPO_ACCESS_TOKEN && { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }) },
      body: JSON.stringify(rows.map((r) => ({ to: r.token, title: msg.title, body: msg.body, data: msg.data, sound: "default", priority: "high" }))),
    });
    const out = (await res.json().catch(() => ({}))) as { data?: { status: string; details?: { error?: string } }[] };
    // Expo says which tokens are dead (app uninstalled): stop sending to them.
    const dead = rows.filter((_, i) => out.data?.[i]?.details?.error === "DeviceNotRegistered").map((r) => r.token);
    if (dead.length) await db.delete(pushTokens).where(inArray(pushTokens.token, dead));
    return rows.length - dead.length;
  } catch (err) {
    console.error("push failed", err);
    return 0;
  }
}

/** The store's owner, admins and approvers: an offer needs their decision. */
export async function notifyApprovers(orgId: string, msg: PushMessage) {
  const phones = (await approverPhones(orgId)).map((p) => p.phone);
  // Phones (the app) and browsers (the web dashboard), whichever they use.
  const url = msg.data.type === "approval" ? `/seller?store=${msg.data.storeId}&tab=approvals` : "/seller";
  const [app, web] = await Promise.all([send("member", phones, msg), sendWebPush(phones, { title: msg.title, body: msg.body, url, tag: `deal-${msg.data.dealId}` })]);
  return app + web;
}

/** The shopper, if they still allow contact about their deals. */
export async function notifyBuyer(userId: string | undefined, msg: PushMessage) {
  const user = userId ? await kv.getUser(userId) : undefined;
  if (!user || !(await mayContact(user))) return 0;
  return send("buyer", [user.id], msg);
}
