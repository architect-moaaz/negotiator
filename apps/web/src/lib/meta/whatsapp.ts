import { schema } from "@ghostcart/db";
import { and, eq, isNull } from "drizzle-orm";
import { randomBytes, randomInt } from "node:crypto";
import { registerChatTransport } from "../chat/engine";
import { decryptSecret, encryptSecret } from "../crypto";
import { getDb } from "../db";
import { CHAT_CONTACT_WORDING, recordConsent } from "../privacy/consent";
import { normalizePhone } from "../users";
import { store as kv } from "../store";
import { graph, metaConfig } from "@ghostcart/channels";

const { platformConnections } = schema;

/** Send a WhatsApp text from the seller's number (inside the 24-hour window the shopper opened). */
export async function sendWhatsAppText(phoneNumberId: string, token: string, to: string, body: string) {
  await graph(`${phoneNumberId}/messages`, { token, body: { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: true, body: body.slice(0, 4000) } } });
}

export async function whatsappConnection(phoneNumberId: string) {
  const db = await getDb();
  const [row] = await db.select().from(platformConnections).where(and(eq(platformConnections.platform, "whatsapp"), eq(platformConnections.externalId, phoneNumberId), isNull(platformConnections.uninstalledAt)));
  return row;
}

registerChatTransport("whatsapp", async (deal, text) => {
  const [phoneNumberId, to] = deal.chat!.threadKey.split(":");
  const conn = await whatsappConnection(phoneNumberId);
  if (conn) await sendWhatsAppText(phoneNumberId, decryptSecret(conn.accessTokenEncrypted), to, text);
});

/**
 * Embedded Signup finished in the seller's browser: exchange the code for a business token, subscribe
 * GhostCart's app to their WhatsApp Business Account, register the number, and remember it.
 */
export async function connectWhatsApp(input: { storeId: string; code: string; phoneNumberId: string; wabaId: string }) {
  const c = metaConfig();
  const { access_token } = await graph<{ access_token: string }>("oauth/access_token", { query: { client_id: c.appId, client_secret: c.appSecret, code: input.code } });
  await graph(`${input.wabaId}/subscribed_apps`, { method: "POST", token: access_token });
  const pin = String(randomInt(100000, 1000000)); // two-step verification PIN for the number
  await graph(`${input.phoneNumberId}/register`, { token: access_token, body: { messaging_product: "whatsapp", pin } });
  const info = await graph<{ display_phone_number?: string; verified_name?: string }>(input.phoneNumberId, { token: access_token, query: { fields: "display_phone_number,verified_name" } });
  const db = await getDb();
  await db
    .insert(platformConnections)
    .values({
      id: `pcn_${randomBytes(8).toString("base64url")}`,
      storeId: input.storeId,
      platform: "whatsapp",
      externalId: input.phoneNumberId,
      accessTokenEncrypted: encryptSecret(access_token),
      scopes: "whatsapp_business_messaging",
      meta: { wabaId: input.wabaId, pinEncrypted: encryptSecret(pin), displayPhone: info.display_phone_number, verifiedName: info.verified_name },
    })
    .onConflictDoUpdate({ target: [platformConnections.platform, platformConnections.externalId], set: { storeId: input.storeId, accessTokenEncrypted: encryptSecret(access_token), uninstalledAt: null } });
  return { displayPhone: info.display_phone_number ?? input.phoneNumberId };
}

interface WaWebhook {
  object?: string;
  entry?: {
    changes?: {
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: { wa_id: string; profile?: { name?: string } }[];
        messages?: { from: string; id: string; type: string; text?: { body: string }; interactive?: { button_reply?: { title: string }; list_reply?: { title: string } } }[];
      };
    }[];
  }[];
}

/** Messages that arrived on sellers' WhatsApp numbers. Each message id is handled once (Meta retries). */
export async function handleWhatsAppWebhook(body: WaWebhook, handle: (msg: { phoneNumberId: string; from: string; name?: string; text: string; storeId: string; token: string }) => Promise<void>) {
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value;
      const phoneNumberId = v?.metadata?.phone_number_id;
      if (!phoneNumberId || !v?.messages?.length) continue;
      const conn = await whatsappConnection(phoneNumberId);
      if (!conn?.storeId) continue;
      for (const m of v.messages) {
        if (!(await kv.claimOnce(`wa:msg:${m.id}`, 7 * 24 * 60 * 60))) continue;
        const text = m.text?.body ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "";
        if (!text) continue;
        const name = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name;
        await handle({ phoneNumberId, from: m.from, name, text, storeId: conn.storeId, token: decryptSecret(conn.accessTokenEncrypted) });
      }
    }
  }
}

/** The shopper's WhatsApp number as a GhostCart account (they messaged the seller, so contact about this deal is consented). */
export async function whatsappShopper(from: string, name?: string) {
  const phone = normalizePhone(from);
  if (!phone) return null;
  const { user, created } = await kv.upsertUser({ id: crypto.randomUUID(), name: name?.slice(0, 80) || "WhatsApp shopper", phone, channel: "whatsapp", createdAt: Date.now(), consentAt: Date.now() });
  if (created) await recordConsent(user.id, "deal_contact", "granted", CHAT_CONTACT_WORDING, "whatsapp");
  return user;
}
