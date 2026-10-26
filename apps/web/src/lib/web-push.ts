import { schema } from "@ghostcart/db";
import { inArray } from "drizzle-orm";
import webpush from "web-push";
import { getDb } from "./db";

const { webPushSubscriptions } = schema;

/**
 * Browser notifications for sellers on the web dashboard (the app uses Expo push, lib/push.ts). Off
 * until the VAPID keys are set (`npx web-push generate-vapid-keys`). web-push builds the encrypted,
 * signed request; we send it with fetch so it's traced and testable.
 */
export const webPushEnabled = () => !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

export class WebPushError extends Error {}

export interface BrowserSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function saveSubscription(phone: string, sub: BrowserSubscription) {
  let url: URL;
  try {
    url = new URL(sub.endpoint);
  } catch {
    throw new WebPushError("That isn't a push subscription.");
  }
  if (url.protocol !== "https:" || !sub.keys?.p256dh || !sub.keys?.auth) throw new WebPushError("That isn't a push subscription.");
  const db = await getDb();
  await db
    .insert(webPushSubscriptions)
    .values({ endpoint: sub.endpoint, phone, p256dh: sub.keys.p256dh, auth: sub.keys.auth })
    .onConflictDoUpdate({ target: webPushSubscriptions.endpoint, set: { phone, p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
}

export async function removeSubscription(endpoint: string) {
  const db = await getDb();
  await db.delete(webPushSubscriptions).where(inArray(webPushSubscriptions.endpoint, [endpoint]));
}

/** Notify these members' browsers. Never throws; forgets subscriptions the push service says are gone. */
export async function sendWebPush(phones: string[], msg: { title: string; body: string; url: string; tag?: string }) {
  if (!webPushEnabled() || !phones.length) return 0;
  try {
    const db = await getDb();
    const subs = await db.select().from(webPushSubscriptions).where(inArray(webPushSubscriptions.phone, phones));
    const gone: string[] = [];
    let sent = 0;
    for (const s of subs) {
      const req = webpush.generateRequestDetails({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg), {
        vapidDetails: { subject: process.env.VAPID_SUBJECT ?? "mailto:support@ghostcart.app", publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, privateKey: process.env.VAPID_PRIVATE_KEY! },
        TTL: 60 * 60,
        urgency: "high",
      });
      try {
        const res = await fetch(req.endpoint, { method: req.method, headers: req.headers as Record<string, string>, body: req.body as BodyInit, signal: AbortSignal.timeout(5000) });
        if (res.status === 404 || res.status === 410) gone.push(s.endpoint);
        else if (res.ok) sent++;
      } catch (err) {
        console.error("web push failed", err);
      }
    }
    if (gone.length) await db.delete(webPushSubscriptions).where(inArray(webPushSubscriptions.endpoint, gone));
    return sent;
  } catch (err) {
    console.error("web push failed", err);
    return 0;
  }
}
