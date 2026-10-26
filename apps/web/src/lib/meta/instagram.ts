import { schema } from "@ghostcart/db";
import { and, eq, isNull } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { registerChatTransport } from "../chat/engine";
import { decryptSecret, encryptSecret } from "../crypto";
import { getDb } from "../db";
import { store as kv } from "../store";
import { graph, metaConfig } from "@ghostcart/channels";

const { platformConnections } = schema;

/**
 * Instagram DMs through the Messenger Platform: the seller's Instagram professional account is linked
 * to a Facebook Page; we message as the Page using its access token. Written from Meta's Instagram
 * Messaging documentation; needs the instagram_manage_messages permission approved before it runs live.
 */
export const INSTAGRAM_SCOPES = ["instagram_basic", "instagram_manage_messages", "pages_show_list", "pages_manage_metadata", "pages_messaging", "business_management"];

export function instagramLoginUrl(state: string) {
  const c = metaConfig();
  const u = new URL(`${c.dialogBase}/${c.version}/dialog/oauth`);
  u.searchParams.set("client_id", c.appId);
  u.searchParams.set("redirect_uri", `${c.appUrl}/api/instagram/callback`);
  u.searchParams.set("state", state);
  u.searchParams.set("scope", INSTAGRAM_SCOPES.join(","));
  u.searchParams.set("response_type", "code");
  return u.toString();
}

export async function instagramConnection(igUserId: string) {
  const db = await getDb();
  const [row] = await db.select().from(platformConnections).where(and(eq(platformConnections.platform, "instagram"), eq(platformConnections.externalId, igUserId), isNull(platformConnections.uninstalledAt)));
  return row;
}

export async function sendInstagramText(pageId: string, pageToken: string, recipientId: string, text: string) {
  await graph(`${pageId}/messages`, { token: pageToken, body: { recipient: { id: recipientId }, messaging_type: "RESPONSE", message: { text: text.slice(0, 1000) } } });
}

registerChatTransport("instagram", async (deal, text) => {
  const [igUserId, recipient] = deal.chat!.threadKey.split(":");
  const conn = await instagramConnection(igUserId);
  if (conn) await sendInstagramText(String(conn.meta.pageId), decryptSecret(conn.accessTokenEncrypted), recipient, text);
});

/** After Facebook Login: find the Page with an Instagram professional account, subscribe it, remember it. */
export async function connectInstagram(input: { storeId: string; code: string }) {
  const c = metaConfig();
  const short = await graph<{ access_token: string }>("oauth/access_token", { query: { client_id: c.appId, client_secret: c.appSecret, redirect_uri: `${c.appUrl}/api/instagram/callback`, code: input.code } });
  const long = await graph<{ access_token: string }>("oauth/access_token", { query: { grant_type: "fb_exchange_token", client_id: c.appId, client_secret: c.appSecret, fb_exchange_token: short.access_token } });
  const pages = await graph<{ data: { id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } }[] }>("me/accounts", {
    token: long.access_token,
    query: { fields: "id,name,access_token,instagram_business_account{id,username}" },
  });
  const page = pages.data.find((p) => p.instagram_business_account);
  if (!page) throw new Error("None of your Facebook Pages has an Instagram professional account linked. Link one in Instagram settings, then try again.");
  await graph(`${page.id}/subscribed_apps`, { method: "POST", token: page.access_token, query: { subscribed_fields: "messages" } });
  const ig = page.instagram_business_account!;
  const db = await getDb();
  await db
    .insert(platformConnections)
    .values({ id: `pcn_${randomBytes(8).toString("base64url")}`, storeId: input.storeId, platform: "instagram", externalId: ig.id, accessTokenEncrypted: encryptSecret(page.access_token), scopes: INSTAGRAM_SCOPES.join(","), meta: { pageId: page.id, pageName: page.name, username: ig.username } })
    .onConflictDoUpdate({ target: [platformConnections.platform, platformConnections.externalId], set: { storeId: input.storeId, accessTokenEncrypted: encryptSecret(page.access_token), uninstalledAt: null, meta: { pageId: page.id, pageName: page.name, username: ig.username } } });
  return { username: ig.username ?? ig.id };
}

interface IgWebhook {
  object?: string;
  entry?: { id: string; messaging?: { sender: { id: string }; recipient: { id: string }; message?: { mid: string; text?: string; is_echo?: boolean } }[] }[];
}

/** DMs to sellers' Instagram accounts. Our own replies come back as echoes and are skipped. */
export async function handleInstagramWebhook(body: IgWebhook, handle: (msg: { igUserId: string; sender: string; text: string; storeId: string }) => Promise<void>) {
  for (const entry of body.entry ?? []) {
    for (const m of entry.messaging ?? []) {
      if (!m.message?.text || m.message.is_echo) continue;
      const igUserId = m.recipient.id;
      const conn = await instagramConnection(igUserId);
      if (!conn?.storeId) continue;
      if (!(await kv.claimOnce(`ig:msg:${m.message.mid}`, 7 * 24 * 60 * 60))) continue;
      await handle({ igUserId, sender: m.sender.id, text: m.message.text, storeId: conn.storeId });
    }
  }
}

export async function instagramSender(igUserId: string) {
  const conn = await instagramConnection(igUserId);
  return conn ? { pageId: String(conn.meta.pageId), token: decryptSecret(conn.accessTokenEncrypted) } : null;
}
