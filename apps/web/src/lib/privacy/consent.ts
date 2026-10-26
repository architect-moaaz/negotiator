import { schema } from "@ghostcart/db";
import { asc, eq } from "drizzle-orm";
import { getDb } from "../db";

const { consents } = schema;

export type ConsentPurpose = "deal_contact" | "marketing" | "recovery_offers";
export type Consent = typeof consents.$inferSelect;

/** The exact words shown next to the signup checkbox. Change them here and in the form together. */
export const DEAL_CONTACT_WORDING = "GhostCart and this seller can contact me on this number about this deal. No marketing.";
/** Shown next to the checkout box that lets a store's GhostCart send a private offer on an unfinished cart. */
export const RECOVERY_OFFER_WORDING = "If I don't finish checking out, this store can send me one private offer on my cart through GhostCart (email, WhatsApp or a call). I can stop it any time.";
/** Chat shoppers write to the seller first; that message is the request to be answered about the deal. */
export const CHAT_CONTACT_WORDING = "Started a haggle by messaging the seller, asking to be answered about the deal in this chat.";

/**
 * Consent records are append-only: what the person agreed to (or withdrew), in which words, where and
 * when. The current state is the latest record per purpose.
 */
export async function recordConsent(subject: string, purpose: ConsentPurpose, action: "granted" | "withdrawn", wording: string, source: string) {
  const db = await getDb();
  await db.insert(consents).values({ subject, purpose, action, wording, source });
}

export async function consentHistory(subject: string) {
  const db = await getDb();
  return db.select().from(consents).where(eq(consents.subject, subject)).orderBy(asc(consents.createdAt), asc(consents.id));
}

/** Latest action per purpose: { deal_contact: "granted", marketing: undefined } */
export async function currentConsents(subject: string) {
  const state: Partial<Record<ConsentPurpose, "granted" | "withdrawn">> = {};
  for (const c of await consentHistory(subject)) state[c.purpose as ConsentPurpose] = c.action as "granted" | "withdrawn";
  return state;
}

/**
 * Whether we may call or message this shopper about their deals right now. Accounts from before consent
 * records existed fall back to the timestamp on the account.
 */
export async function mayContact(user: { id: string; consentAt?: number }) {
  const state = (await currentConsents(user.id)).deal_contact;
  return state ? state === "granted" : !!user.consentAt;
}
