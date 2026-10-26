import { schema } from "@ghostcart/db";
import { eq } from "drizzle-orm";
import { createECDH, randomBytes } from "node:crypto";
import webpush from "web-push";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "./db";
import { notifyApprovers } from "./push";
import { createOrg } from "./shop/orgs";
import { saveSubscription, sendWebPush } from "./web-push";

/** A subscription like a browser's: a P-256 public key and a 16-byte auth secret. */
function browserSub(endpoint: string) {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { endpoint, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } };
}

let calls: { url: string; headers: Record<string, string>; bytes: number }[] = [];
beforeEach(() => {
  const vapid = webpush.generateVAPIDKeys();
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = vapid.publicKey;
  process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
  calls = [];
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (!url.startsWith("https://push.test/")) return real(input, init);
    calls.push({ url, headers: init?.headers as Record<string, string>, bytes: (init?.body as Buffer).length });
    return new Response(null, { status: url.includes("gone") ? 410 : 201 });
  });
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  vi.restoreAllMocks();
});

describe("browser push", () => {
  it("sends an encrypted, VAPID-signed push and forgets subscriptions the push service says are gone", async () => {
    const phone = "+919000009801";
    await saveSubscription(phone, browserSub("https://push.test/live-1"));
    await saveSubscription(phone, browserSub("https://push.test/gone-1"));
    expect(await sendWebPush([phone], { title: "Offer: ₹4,600", body: "Approve or reject.", url: "/seller?tab=approvals" })).toBe(1);
    expect(calls).toHaveLength(2);
    const live = calls.find((c) => c.url.endsWith("live-1"))!;
    expect(live.headers.Authorization).toMatch(/^vapid t=.+, k=.+/);
    expect(live.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(live.bytes).toBeGreaterThan(100); // encrypted payload, not the plain JSON
    const db = await getDb();
    expect(await db.select().from(schema.webPushSubscriptions).where(eq(schema.webPushSubscriptions.endpoint, "https://push.test/gone-1"))).toEqual([]);
  });

  it("goes to a store's approvers when an offer escalates, alongside the app", async () => {
    const owner = "+919000009802";
    const org = await createOrg({ name: "ZZ Web Push", ownerPhone: owner, ownerName: "ZZ" });
    await saveSubscription(owner, browserSub("https://push.test/owner-1"));
    await notifyApprovers(org.id, { title: "Offer", body: "x", data: { type: "approval", storeId: "st_x", dealId: "d1" } });
    expect(calls.map((c) => c.url)).toEqual(["https://push.test/owner-1"]);
  });

  it("refuses things that aren't push subscriptions, and does nothing without VAPID keys", async () => {
    await expect(saveSubscription("+919000009803", { endpoint: "http://insecure.test/x", keys: { p256dh: "a", auth: "b" } })).rejects.toThrow();
    delete process.env.VAPID_PRIVATE_KEY;
    expect(await sendWebPush(["+919000009801"], { title: "t", body: "b", url: "/" })).toBe(0);
  });
});
